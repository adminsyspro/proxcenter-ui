// src/lib/guestFileRestore/guestAddresses.ts
//
// The SSH host of a restore. A provider super admin already reaches the whole
// infrastructure (node consoles, node SSH), so any host is accepted (NAT, jump
// tunnels). Anyone else (other provider users, MSP / vDC tenants, API tokens)
// is bound to the guest they are authorised on: the host must be one of the
// addresses the guest reports (QEMU guest agent, container interfaces), AND
// must not be an address of the infrastructure ProxCenter knows (PVE/PBS and
// other connections, managed nodes, ProxCenter's own interfaces). The second
// check matters because a tenant is root in its guest and can make the agent
// report any address, e.g. a PVE node's, to probe the management network
// from ProxCenter.

import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { networkInterfaces } from 'node:os'

import { NextResponse } from 'next/server'

import type { Principal } from '@/lib/auth/principal'
import type { PveConn } from '@/lib/connections/getConnection'
import { prisma } from '@/lib/db/prisma'
import { pveFetch } from '@/lib/proxmox/client'

import type { GuestRestoreTarget } from './types'

export const SSH_HOST_NOT_GUEST_MESSAGE = "SSH host must be one of the guest's addresses"

/** Indirection for tests. */
export const _impl = {
  pveFetch,
  /** Hosts (name or IP) of every connection and managed node in the database. */
  infrastructureHosts: async (): Promise<string[]> => {
    const [connections, hosts] = await Promise.all([
      prisma.connection.findMany({ select: { baseUrl: true } }),
      prisma.managedHost.findMany({ where: { ip: { not: null } }, select: { ip: true } }),
    ])
    const out: string[] = []
    for (const c of connections) {
      try {
        out.push(new URL(c.baseUrl).hostname)
      } catch {
        // malformed URL: nothing to add
      }
    }
    for (const h of hosts) if (h.ip) out.push(h.ip)
    for (const url of [process.env.ORCHESTRATOR_URL, process.env.DATABASE_URL]) {
      try {
        if (url) out.push(new URL(url).hostname)
      } catch {
        // not a URL
      }
    }
    return out
  },
  /** ProxCenter's own interface addresses. */
  localAddresses: (): string[] => Object.values(networkInterfaces()).flat().map(a => a?.address ?? '').filter(Boolean),
  /** Every address a host name resolves to; empty when it does not resolve. */
  resolve: async (name: string): Promise<string[]> => {
    try {
      const answers = await Promise.race([
        lookup(name, { all: true }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('dns timeout')), 3_000)),
      ])
      return answers.map(a => a.address)
    } catch {
      return []
    }
  },
}

/** Canonical addresses of the infrastructure, host names resolved. */
export async function infrastructureAddresses(): Promise<Set<string>> {
  const hosts = [...(await _impl.infrastructureHosts()), ..._impl.localAddresses()]
  const out = new Set<string>()
  await Promise.all(hosts.map(async h => {
    const direct = canonicalIp(h)
    if (direct) {
      out.add(direct)
      return
    }
    for (const a of await _impl.resolve(h.replace(/^\[|\]$/g, ''))) {
      const c = canonicalIp(a)
      if (c) out.add(c)
    }
  }))
  return out
}

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
  return groups.map(g => (g ? Number.parseInt(g, 16).toString(16) : '0')).join(':')
}

/** Comparable form of an address: trimmed, no brackets or zone, IPv6 expanded. Null when it is not an IP. */
export function canonicalIp(value: string): string | null {
  const v = value.trim().replace(/^\[|\]$/g, '').replace(/%.*$/, '').toLowerCase()
  const kind = isIP(v)
  if (kind === 4) return v
  if (kind === 6) {
    const expanded = expandIpv6(v)
    // An IPv4-mapped address reaches the IPv4 host: compare it as that host,
    // or `::ffff:10.0.0.1` would slip past a refusal of `10.0.0.1`.
    const mapped = /^0:0:0:0:0:ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(expanded)
    if (mapped) {
      const hi = Number.parseInt(mapped[1], 16)
      const lo = Number.parseInt(mapped[2], 16)
      return [hi >> 8, hi & 255, lo >> 8, lo & 255].join('.')
    }
    return expanded
  }
  return null
}

/** Addresses a restore may be sent to: no loopback, link-local or unspecified. */
export function isRoutableGuestAddress(canonical: string): boolean {
  if (canonical.includes('.') && !canonical.includes(':')) {
    return !(canonical.startsWith('127.') || canonical.startsWith('169.254.') || canonical === '0.0.0.0')
  }
  if (canonical === '0:0:0:0:0:0:0:1' || canonical === '0:0:0:0:0:0:0:0') return false
  if (/^fe[89ab][0-9a-f]?:/.test(canonical)) return false
  // IPv4-mapped addresses come out of canonicalIp in dotted form, checked above.
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
 * Refuse an SSH host a non-provider caller may not reach: not one of the
 * guest's addresses, or an infrastructure address. Same answer for both, so
 * the refusal says nothing about the infrastructure. Returns the 400 to
 * send, or null.
 */
export async function assertSshHostAllowed(opts: {
  conn: PveConn
  target: GuestRestoreTarget
  host: string
  principal: Principal
  /** Provider super admin (raw session claim), see isProviderCaller in guard.ts. */
  providerCaller: boolean
}): Promise<Response | null> {
  if (opts.providerCaller && opts.principal.kind !== 'token') return null
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
  const infrastructure = await infrastructureAddresses()
  if (infrastructure.has(canonicalIp(opts.host)!)) {
    console.warn(`[guest-file-restore] SSH host ${opts.host} refused for vm ${opts.target.vmid}: it is an infrastructure address the guest reports as its own`)
    return NextResponse.json({ error: SSH_HOST_NOT_GUEST_MESSAGE, addresses: addresses.filter(a => !infrastructure.has(a)) }, { status: 400 })
  }
  return null
}

/**
 * What a non-provider caller learns when an SSH connection fails: "could not
 * connect" whatever the cause (refused, timeout, unreachable), so the test
 * button cannot be used to scan ports. Authentication and host key answers
 * stay precise: they only come from a host that speaks SSH.
 */
export const SSH_CONNECT_FAILED_MESSAGE = 'Could not connect to the SSH host'

export function opaqueSshErrorClass(errorClass: string | undefined): boolean {
  return errorClass === 'unreachable' || errorClass === 'timeout' || errorClass === 'error'
}
