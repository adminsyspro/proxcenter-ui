import { NextResponse } from "next/server"

import type { PveConn } from "@/lib/connections/getConnection"
import { assertNodeName } from "@/lib/ssh/validate"
import { getCurrentTenantId } from "@/lib/tenant"
import { getTenantInfrastructureScope, type InfraScope } from "@/lib/tenant/infraScope"

import { checkTenantGuestsScope, EVERY_GUEST, tenantGuestVisibility, type GuestVisibility } from "./guestScope"

export type { GuestVisibility }

/**
 * Session-side guest guard for the routes that act on ONE guest.
 *
 * API tokens are confined centrally (writeGuards.ts, step 5): a vDC token
 * never reaches a handler with a guest outside its pools. A browser session
 * has no such layer: tenant role assignments resolve to the global scope, so
 * checkPermission(..., "vm", id) alone lets a vDC operator act on any guest
 * of the shared cluster. Every guest route calls guardSessionGuest after its
 * permission check; the token path runs it too, as config/route.ts already
 * did, which costs one more scope lookup but keeps a single code path.
 *
 * The same helper validates the identifiers that end up in a Proxmox API
 * path: a crafted `vmid` or `type` segment must never change the endpoint
 * that is called.
 */

export type GuestType = "qemu" | "lxc"

/** A guest named by its URL, or by the composite key connId:type:node:vmid. */
export type GuestTarget = { type: GuestType; node: string; vmid: string }

// FLAT on purpose (repo constraint): tsconfig strict:false breaks
// discriminated-union narrowing, so callers test `ok` and read `response`
// or the fields without the compiler having to narrow a union.
export type ParsedGuest<T> = { ok: boolean; response?: NextResponse } & T

// A refusal carries no target fields; callers return `response` before reading any.
const refuse = <T,>(response: NextResponse) => ({ ok: false, response }) as ParsedGuest<T>

// Proxmox vmids are positive integers; a leading zero is refused by PVE
// anyway, so the plain digit class is enough to keep the path shape intact.
const VMID_RE = /^\d+$/

// Connection ids are cuids; anything else is not a row we would ever find.
const CONNECTION_ID_RE = /^[A-Za-z0-9_.-]{1,64}$/

const invalid = (message: string) => NextResponse.json({ error: message }, { status: 400 })
const unverifiable = () => NextResponse.json({ error: "Unable to verify guest vDC scope" }, { status: 503 })

export function isGuestType(raw: unknown): raw is GuestType {
  return raw === "qemu" || raw === "lxc"
}

export function isVmid(raw: unknown): raw is string {
  return typeof raw === "string" && VMID_RE.test(raw)
}

export function isNodeName(raw: unknown): raw is string {
  try {
    assertNodeName(raw)
    return true
  } catch {
    return false
  }
}

/** Strict check of the three guest URL segments; 400 names the first bad one. */
export function parseGuestTarget(raw: { type?: unknown; node?: unknown; vmid?: unknown }): ParsedGuest<GuestTarget> {
  if (!isGuestType(raw.type)) return refuse(invalid("Invalid type"))
  if (!isNodeName(raw.node)) return refuse(invalid("Invalid node name"))
  if (!isVmid(raw.vmid)) return refuse(invalid("Invalid vmid"))
  return { ok: true, type: raw.type, node: raw.node, vmid: raw.vmid }
}

/**
 * The composite key of the /api/v1/guests/{vmid} routes, validated field by
 * field. The messages keep the "Invalid vmKey" wording clients already match.
 */
export function parseGuestKey(vmKey: unknown): ParsedGuest<GuestTarget & { connId: string }> {
  const parts = typeof vmKey === "string" ? vmKey.split(":") : []
  if (parts.length !== 4) {
    return refuse(invalid("Invalid vmKey format. Expected connId:type:node:vmid"))
  }
  const [connId, type, node, vmid] = parts
  if (!CONNECTION_ID_RE.test(connId)) return refuse(invalid("Invalid vmKey: connection id"))
  if (!isGuestType(type)) return refuse(invalid("Invalid vmKey: type"))
  if (!isNodeName(node)) return refuse(invalid("Invalid vmKey: node name"))
  if (!isVmid(vmid)) return refuse(invalid("Invalid vmKey: vmid"))
  return { ok: true, connId, type, node, vmid }
}

/** The guest a Proxmox HA service id names (vm:100, ct:101), or null when malformed. */
export function haSidGuest(sid: unknown): { type: GuestType; vmid: string } | null {
  const match = typeof sid === "string" ? /^(vm|ct):(\d+)$/.exec(sid) : null
  return match ? { type: match[1] === "vm" ? "qemu" : "lxc", vmid: match[2] } : null
}

/** The vmid a Proxmox replication job id names (<vmid>-<n>), or null when malformed. */
export function replicationJobVmid(jobId: unknown): string | null {
  const match = typeof jobId === "string" ? /^(\d+)-\d+$/.exec(jobId) : null
  return match ? match[1] : null
}

/** The session tenant and its infrastructure scope, or null when either lookup fails. */
async function sessionScope(): Promise<{ tenantId: string; infra: InfraScope } | null> {
  try {
    const tenantId = await getCurrentTenantId()
    return { tenantId, infra: await getTenantInfrastructureScope(tenantId, { ignoreVdcContext: true }) }
  } catch {
    return null
  }
}

export type SessionGuestGuardInput = {
  connectionId: string
  /**
   * The resolved connection, or a thunk resolving it. The thunk is only
   * called for a vDC tenant, so routes that normally never load the
   * connection (orchestrator proxies) keep that behaviour for everyone else.
   */
  conn: PveConn | (() => Promise<PveConn>)
  /** null = any guest type (a vmid carried in a request body). */
  type: string | null
  /** null = any node of the vDC (the route does not know the node). */
  node: string | null
  vmid: string
  /** The guest may run on another vDC node than the one in the URL (stale URL after a migration). */
  allowMovedNode?: boolean
}

/**
 * Validates the guest identifiers (400), resolves the session tenant and
 * refuses a vDC tenant whose guest is outside its pools (403). Any lookup
 * that fails answers 503: the guard never passes on an unverified guest.
 * A provider or MSP tenant pays one infrastructure-scope lookup, nothing more.
 */
export async function guardSessionGuest(input: SessionGuestGuardInput): Promise<NextResponse | null> {
  const { connectionId, type, node, vmid, allowMovedNode = false } = input
  if (type !== null && !isGuestType(type)) return invalid("Invalid type")
  if (node !== null && !isNodeName(node)) return invalid("Invalid node name")
  if (!isVmid(vmid)) return invalid("Invalid vmid")

  const scope = await sessionScope()
  if (!scope) return unverifiable()
  if (scope.infra.kind !== "iaas") return null

  let conn: PveConn
  try {
    conn = typeof input.conn === "function" ? await input.conn() : input.conn
  } catch {
    return unverifiable()
  }
  try {
    return await checkTenantGuestsScope(scope.tenantId, conn, connectionId, type, node, [vmid], allowMovedNode, scope.infra)
  } catch {
    return unverifiable()
  }
}

/**
 * Which guests of the connection the session may see, for the routes that
 * list per-guest rows cluster-wide (snapshots, HA, replication, local VMs).
 * Same resolution as guardSessionGuest: a provider or MSP session sees every
 * guest without the connection being touched, a vDC session gets the guests
 * of its pools, and a failed lookup answers 503 rather than an unmasked list.
 */
export async function sessionGuestVisibility(input: {
  connectionId: string
  conn: PveConn | (() => Promise<PveConn>)
  /** A /cluster/resources listing the route already holds, so none is read again. */
  resources?: unknown
}): Promise<{ ok: boolean; visibility?: GuestVisibility; response?: NextResponse }> {
  const scope = await sessionScope()
  if (!scope) return { ok: false, response: unverifiable() }
  if (scope.infra.kind !== "iaas") return { ok: true, visibility: EVERY_GUEST }

  let conn: PveConn
  try {
    conn = typeof input.conn === "function" ? await input.conn() : input.conn
  } catch {
    return { ok: false, response: unverifiable() }
  }
  let visibility: GuestVisibility | NextResponse
  try {
    visibility = await tenantGuestVisibility(scope.tenantId, conn, input.connectionId, { infra: scope.infra, resources: input.resources })
  } catch {
    return { ok: false, response: unverifiable() }
  }
  return visibility instanceof NextResponse ? { ok: false, response: visibility } : { ok: true, visibility }
}
