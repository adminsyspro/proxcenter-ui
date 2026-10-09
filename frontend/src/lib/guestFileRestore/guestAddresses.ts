// src/lib/guestFileRestore/guestAddresses.ts
//
// The SSH host of a restore is bound to the guest the caller is authorised
// on: it must be one of the addresses the guest itself reports (QEMU guest
// agent, or the container's interfaces), so the route can never be used to
// reach an arbitrary host with the caller's credentials. A super admin may
// target any host (NAT, jump tunnels).

import { isIP } from 'node:net'

import { NextResponse } from 'next/server'

import type { Principal } from '@/lib/auth/principal'
import type { PveConn } from '@/lib/connections/getConnection'
import { pveFetch } from '@/lib/proxmox/client'
import { isUserSuperAdmin } from '@/lib/rbac'

import type { GuestRestoreTarget } from './types'

export const SSH_HOST_NOT_GUEST_MESSAGE = "SSH host must be one of the guest's addresses"

/** Indirection for tests. */
export const _impl = { pveFetch, isUserSuperAdmin }

function expandIpv6(ip: string): string {
  let v = ip
  // IPv4-mapped / embedded tail: turn the dotted quad into two hex groups.
  const dot = v.lastIndexOf('.')
  if (dot >= 0) {
    const colon = v.lastIndexOf(':')
    const quad = v.slice(colon + 1).split('.').map(Number)
    if (quad.length === 4 && quad.every(n => Number.isInteger(n) && n >= 0 && n <= 255)) {
      v = `${v.slice(0, colon + 1)}${((quad[0] << 8) | quad[1]).toString(16)}:${((quad[2] << 8) | quad[3]).toString(16)}`
    }
  }
  const [head, tail = ''] = v.split('::')
  const headGroups = head ? head.split(':') : []
  const tailGroups = tail ? tail.split(':') : []
  const missing = v.includes('::') ? 8 - headGroups.length - tailGroups.length : 0
  const groups = [...headGroups, ...Array.from({ length: Math.max(0, missing) }, () => '0'), ...tailGroups]
  return groups.map(g => (g ? parseInt(g, 16).toString(16) : '0')).join(':')
}

/** Comparable form of an address: trimmed, no brackets or zone, IPv6 expanded. Null when it is not an IP. */
export function canonicalIp(value: string): string | null {
  const v = value.trim().replace(/^\[|\]$/g, '').replace(/%.*$/, '').toLowerCase()
  const kind = isIP(v)
  if (kind === 4) return v
  if (kind === 6) return expandIpv6(v)
  return null
}

/** Addresses a restore may be sent to: no loopback, link-local or unspecified. */
export function isRoutableGuestAddress(canonical: string): boolean {
  if (canonical.includes('.') && !canonical.includes(':')) {
    return !(canonical.startsWith('127.') || canonical.startsWith('169.254.') || canonical === '0.0.0.0')
  }
  if (canonical === '0:0:0:0:0:0:0:1' || canonical === '0:0:0:0:0:0:0:0') return false
  if (/^fe[89ab][0-9a-f]?:/.test(canonical)) return false
  // IPv4-mapped loopback / link-local (::ffff:127.x, ::ffff:169.254.x)
  if (/^0:0:0:0:0:ffff:7f[0-9a-f]{2}:/.test(canonical) || /^0:0:0:0:0:ffff:a9fe:/.test(canonical)) return false
  return true
}

function collect(values: Iterable<string>): string[] {
  const out = new Set<string>()
  for (const raw of values) {
    const canonical = canonicalIp(raw.replace(/\/\d+$/, ''))
    if (canonical && isRoutableGuestAddress(canonical)) out.add(canonical)
  }
  return [...out]
}

/** Addresses from `agent/network-get-interfaces` (`{ result: [...] }` or the array itself). */
export function guestAddressesFromAgent(data: unknown): string[] {
  const interfaces = Array.isArray(data) ? data : Array.isArray((data as any)?.result) ? (data as any).result : []
  const values: string[] = []
  for (const iface of interfaces) {
    for (const addr of iface?.['ip-addresses'] ?? []) {
      if (typeof addr?.['ip-address'] === 'string') values.push(addr['ip-address'])
    }
  }
  return collect(values)
}

/** Addresses from `GET /nodes/{node}/lxc/{vmid}/interfaces` (`inet` / `inet6` in CIDR form). */
export function guestAddressesFromLxc(data: unknown): string[] {
  const interfaces = Array.isArray(data) ? data : []
  const values: string[] = []
  for (const iface of interfaces) {
    for (const key of ['inet', 'inet6']) {
      const v = iface?.[key]
      if (typeof v === 'string' && v) values.push(v)
    }
  }
  return collect(values)
}

export async function listGuestAddresses(conn: PveConn, target: GuestRestoreTarget): Promise<string[]> {
  const base = `/nodes/${encodeURIComponent(target.node)}/${target.type}/${encodeURIComponent(String(target.vmid))}`
  if (target.type === 'qemu') {
    const data = await _impl.pveFetch<unknown>(conn, `${base}/agent/network-get-interfaces`, {}, { timeoutMs: 15_000 })
    return guestAddressesFromAgent(data)
  }
  const data = await _impl.pveFetch<unknown>(conn, `${base}/interfaces`, {}, { timeoutMs: 15_000 })
  return guestAddressesFromLxc(data)
}

export function isAllowedSshHost(host: string, addresses: string[]): boolean {
  const canonical = canonicalIp(host)
  return canonical !== null && addresses.includes(canonical)
}

/**
 * Refuse an SSH host that is not one of the guest's addresses, unless the
 * caller is a super admin. Returns the 400 to send, or null.
 */
export async function assertSshHostAllowed(opts: {
  conn: PveConn
  target: GuestRestoreTarget
  host: string
  principal: Principal
}): Promise<Response | null> {
  const { principal } = opts
  if (principal.kind !== 'token' && principal.userId && (await _impl.isUserSuperAdmin(principal.userId))) {
    return null
  }
  let addresses: string[]
  try {
    addresses = await listGuestAddresses(opts.conn, opts.target)
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    return NextResponse.json(
      { error: `${SSH_HOST_NOT_GUEST_MESSAGE} (they could not be resolved: ${reason.slice(0, 200)})`, addresses: [] },
      { status: 400 },
    )
  }
  if (!isAllowedSshHost(opts.host, addresses)) {
    return NextResponse.json({ error: SSH_HOST_NOT_GUEST_MESSAGE, addresses }, { status: 400 })
  }
  return null
}
