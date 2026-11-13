// src/lib/firewall/pathParams.ts
// Grammar of the request values the /api/v1/firewall/** routes place in an
// orchestrator or PVE API path. Checked once in the route (400 before any
// call) and again where the PVE path is built (pveDirect.ts).
//
// The grammars are the ones PVE itself enforces (PVE::Firewall): a value PVE
// accepts is never refused here.
import { NextResponse } from 'next/server'

import { assertNodeName } from '@/lib/ssh/validate'

/** A value refused as a firewall path parameter; answered 400. */
export class FirewallParamError extends Error {
  readonly status = 400
  constructor(message: string) {
    super(message)
    this.name = 'FirewallParamError'
  }
}

// A rule position or a guest id: digits only.
const POSITION = /^\d{1,9}$/
const VMID = /^[1-9]\d{0,8}$/

// Alias, IP set and security group names share one pattern in PVE
// (`[A-Za-z][A-Za-z0-9\-\_]+`, 64 characters at most, 18 for a group).
const OBJECT_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/

// An IP set member: an IPv4 or IPv6 address, a CIDR, or an alias name with
// its optional scope (`dc/name`, `guest/name`).
const ADDRESS = /^[A-Za-z0-9:][A-Za-z0-9.:_/-]{0,127}$/

function isAddress(raw: unknown): raw is string {
  return typeof raw === 'string' && ADDRESS.test(raw) && raw.split('/').every(part => part !== '' && part !== '.' && part !== '..')
}

function isNodeName(raw: unknown): boolean {
  try {
    assertNodeName(raw)

    return true
  } catch {
    return false
  }
}

function isGuestType(raw: unknown): boolean {
  return raw === 'qemu' || raw === 'lxc'
}

function isVmid(raw: unknown): boolean {
  return (typeof raw === 'number' && Number.isSafeInteger(raw) && raw > 0 && raw <= 999_999_999) || (typeof raw === 'string' && VMID.test(raw))
}

function isPosition(raw: unknown): boolean {
  return (typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0 && raw <= 999_999_999) || (typeof raw === 'string' && POSITION.test(raw))
}

function isObjectName(raw: unknown): boolean {
  return typeof raw === 'string' && OBJECT_NAME.test(raw)
}

const CHECKS = {
  node: { valid: isNodeName, message: 'Invalid node name' },
  vmType: { valid: isGuestType, message: 'Invalid type' },
  vmid: { valid: isVmid, message: 'Invalid vmid' },
  pos: { valid: isPosition, message: 'Invalid rule position' },
  alias: { valid: isObjectName, message: 'Invalid alias name' },
  ipset: { valid: isObjectName, message: 'Invalid IP set name' },
  group: { valid: isObjectName, message: 'Invalid security group name' },
  address: { valid: isAddress, message: 'Invalid address' },
} as const

export type FirewallParamKind = keyof typeof CHECKS
export type FirewallParams = Partial<Record<FirewallParamKind, unknown>>

/** The first parameter that does not follow its grammar, as an error message. */
function firstInvalid(params: FirewallParams): string | null {
  for (const kind of Object.keys(params) as FirewallParamKind[]) {
    if (!CHECKS[kind].valid(params[kind])) return CHECKS[kind].message
  }

  return null
}

/** The 400 a route answers with, or null when every given parameter is well formed. */
export function firewallParamRefusal(params: FirewallParams): NextResponse | null {
  const message = firstInvalid(params)

  return message ? NextResponse.json({ error: message }, { status: 400 }) : null
}

/**
 * One validated segment of a PVE API path, encoded. Throws FirewallParamError
 * on a value outside its grammar, before anything is sent.
 */
export function pveSegment(kind: FirewallParamKind, value: unknown): string {
  const message = firstInvalid({ [kind]: value })

  if (message) throw new FirewallParamError(message)

  return encodeURIComponent(String(value))
}

/**
 * The sub-resource a `?type=` query selects on the cluster, node and guest
 * routes: `options` (the default) or `rules`. Null for anything else.
 */
export function firewallResourceType(raw: string | null): 'options' | 'rules' | null {
  if (raw === null || raw === '' || raw === 'options') return 'options'

  return raw === 'rules' ? 'rules' : null
}

export function invalidResourceType(): NextResponse {
  return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
}

/**
 * An IP set member as one orchestrator path segment. Every character of the
 * grammar goes as is, apart from the slash of a CIDR or of a scoped alias.
 */
export function orchestratorAddressSegment(address: string): string {
  if (!isAddress(address)) throw new FirewallParamError(CHECKS.address.message)

  return address.replaceAll('/', '%2F')
}
