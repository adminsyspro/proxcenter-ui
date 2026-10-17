// Route-boundary guards every API token request goes through BEFORE its
// handler (spec 4.3/4.4), plus the centralized journal of token writes and
// refusals. Session callers never reach this module (routeGuard passes them
// through). Ids read from the path are the RAW matcher params, decoded here
// exactly once, the same decoding Next applies to the handler's own params.
import { headers } from "next/headers"

import { rejectionToResponse, type Principal, type PrincipalRejection } from "@/lib/auth/principal"
import { getConnectionById } from "@/lib/connections/getConnection"
import { getTenantInfrastructureScope, type InfraScope } from "@/lib/tenant/infraScope"
import { checkTenantGuestScope } from "@/lib/vdc/guestScope"

import { isWriteEntry, type AllowlistEntry, type BodyOrQueryField, type GuestScopeSpec } from "./allowlist"
import { creatorStillHolds } from "./creatorCheck"
import { resolveVisibleConnectionIds } from "./scope"
import { extractTokenPrefix } from "./tokenCrypto"

const NOT_IN_SCOPE = "Connection not in token scope"
const CLUSTER_OBJECT = "Cluster-level object not available to a vDC tenant token"
const GUEST_OUTSIDE = "Guest outside your vDC scope"
const CREATOR_LOST = "Token creator no longer holds this right"

type FieldReader = (field: BodyOrQueryField) => Promise<unknown[]>

/** HEAD rides on GET, as in the matcher and getPrincipal step 4. */
function normalizeMethod(method: string): string {
  const upper = method.toUpperCase()
  return upper === "HEAD" ? "GET" : upper
}

/** Decoded segment value, or null when absent, empty or a malformed escape (fail closed). */
function decodeParam(params: Record<string, string>, name: string): string | null {
  const raw = params[name]
  if (!raw) return null
  try {
    return decodeURIComponent(raw) || null
  } catch {
    return null
  }
}

/** "connId:type:node:vmid", same format as the routes' parseVmKey. */
function parseVmKey(value: string | null): { connection: string; type: string; node: string; vmid: string } | null {
  const parts = value ? value.split(":") : []
  if (parts.length !== 4 || parts.some(p => !p)) return null
  return { connection: parts[0], type: parts[1], node: parts[2], vmid: parts[3] }
}

/**
 * Body fields come from a clone (the handler always gets the body intact),
 * parsed once; a non-JSON or empty body simply yields no value. Query fields
 * return every repeated value. Absent, null and "" all mean "no value".
 */
function fieldReader(req: Request): FieldReader {
  let body: Promise<Record<string, unknown> | null> | null = null
  const query = new URL(req.url).searchParams
  return async field => {
    if (field.source === "query") return query.getAll(field.field).filter(v => v !== "")
    if (!body) {
      body = req.clone().json().then(
        parsed => (parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null),
        () => null,
      )
    }
    const value = (await body)?.[field.field]
    return value === undefined || value === null || value === "" ? [] : [value]
  }
}

/** Connection ids named by the entry's primary location; null = the entry declares none. */
async function primaryConnections(
  entry: AllowlistEntry,
  params: Record<string, string>,
  readField: FieldReader,
): Promise<{ values: unknown[]; malformed: boolean } | null> {
  if (entry.connectionSegment) {
    const id = decodeParam(params, entry.connectionSegment)
    return id ? { values: [id], malformed: false } : { values: [], malformed: true }
  }
  if (entry.vmKeySegment) {
    const key = parseVmKey(decodeParam(params, entry.vmKeySegment))
    return key ? { values: [key.connection], malformed: false } : { values: [], malformed: true }
  }
  if (entry.connectionField) return { values: await readField(entry.connectionField), malformed: false }
  return null
}

/** The guest(s) an entry targets; vmids empty = nothing the guard can confine. Null = malformed path. */
async function guestTargets(
  spec: GuestScopeSpec,
  params: Record<string, string>,
  readField: FieldReader,
): Promise<{ connection: string; type: string | null; node: string | null; vmids: string[] } | null> {
  if ("vmKey" in spec) {
    const key = parseVmKey(decodeParam(params, spec.vmKey))
    return key ? { connection: key.connection, type: key.type, node: key.node, vmids: [key.vmid] } : null
  }
  const connection = decodeParam(params, spec.connection)
  if (!connection) return null
  if ("vmidField" in spec) {
    // PVE accepts a comma-separated vmid list (vzdump): every guest is checked,
    // and anything that is not a plain vmid confines nothing, so it is refused.
    const vmids: string[] = []
    for (const value of await readField(spec.vmidField)) {
      if (typeof value !== "string" && typeof value !== "number") return { connection, type: null, node: null, vmids: [] }
      for (const part of String(value).split(",").map(p => p.trim())) {
        if (!/^\d+$/.test(part)) return { connection, type: null, node: null, vmids: [] }
        vmids.push(part)
      }
    }
    return { connection, type: null, node: null, vmids }
  }
  const type = decodeParam(params, spec.type)
  const node = decodeParam(params, spec.node)
  const vmid = decodeParam(params, spec.vmid)
  return type && node && vmid ? { connection, type, node, vmids: [vmid] } : null
}

/**
 * Token-only guards, in the spec order: (1) forwarded method, (2) primary
 * connection, (3) secondary connections, (4) cluster objects vs vDC tenant,
 * (5) guest vDC scope, (6) live creator check on writes. Null = proceed;
 * otherwise the refusal to send, already journaled as apitoken.denied.
 */
export async function runTokenEntryGuards(
  entry: AllowlistEntry,
  principal: Principal,
  req: Request,
  params: Record<string, string>,
): Promise<Response | null> {
  const deny = async (rejection?: PrincipalRejection): Promise<Response> => {
    await auditTokenDenied(rejection, { tokenId: principal.tokenId, entryId: entry.id })
    return rejectionToResponse(rejection)
  }
  const notInScope = (connection: unknown) =>
    deny({ status: 403, body: { error: NOT_IN_SCOPE, connection: typeof connection === "string" ? connection : null } })

  // (1) The handler serving this request must answer the method the token
  //     was authorized for (getPrincipal step 4 checked the forwarded one).
  const hdrs = await headers()
  const forwarded = hdrs.get("x-pxc-method")
  if (!forwarded || normalizeMethod(forwarded) !== normalizeMethod(req.method)) return deny()

  const readField = fieldReader(req)
  let visible: Set<string> | null = null
  const isVisible = async (id: unknown): Promise<boolean> => {
    if (!visible) visible = await resolveVisibleConnectionIds(principal)
    return typeof id === "string" && visible.has(id)
  }

  // (2) Primary connection, wherever the entry declares it. A declared body or
  //     query field that is absent names nothing the guard can check: refused.
  const primary = await primaryConnections(entry, params, readField)
  if (primary) {
    if (primary.malformed) return deny()
    if (primary.values.length === 0) return notInScope(null)
    for (const id of primary.values) {
      if (!(await isVisible(id))) return notInScope(id)
    }
  }

  // (3) Any other connection the request names (body or query), same perimeter.
  for (const field of entry.secondaryConnections ?? []) {
    for (const id of await readField(field)) {
      if (!(await isVisible(id))) return notInScope(id)
    }
  }

  let infra: InfraScope | null = null
  const isIaas = async (): Promise<boolean> => {
    if (!infra) infra = await getTenantInfrastructureScope(principal.tenantId, { ignoreVdcContext: true })
    return infra.kind === "iaas"
  }

  // (4) A vDC tenant never touches cluster- or node-level objects of a
  //     connection it does not own (an msp tenant owns its connections).
  if (entry.clusterObject && (await isIaas())) {
    return deny({ status: 403, body: { error: CLUSTER_OBJECT } })
  }

  // (5) A vDC tenant only reaches guests inside its own vDC pools.
  if (entry.guestScope && (await isIaas())) {
    const target = await guestTargets(entry.guestScope, params, readField)
    if (!target) return deny()
    if (!(await isVisible(target.connection))) return notInScope(target.connection)
    if (target.vmids.length === 0) return deny({ status: 403, body: { error: GUEST_OUTSIDE } })
    let conn: Awaited<ReturnType<typeof getConnectionById>>
    try {
      conn = await getConnectionById(target.connection, principal.tenantId)
    } catch {
      return deny({ status: 503, body: { error: "Unable to verify guest vDC scope" } })
    }
    for (const vmid of target.vmids) {
      const refused = await checkTenantGuestScope(principal.tenantId, conn, target.connection, target.type, target.node, vmid)
      if (refused) {
        const body = await refused.clone().json().catch(() => ({ error: GUEST_OUTSIDE }))
        await auditTokenDenied({ status: refused.status, body }, { tokenId: principal.tokenId, entryId: entry.id })
        return refused
      }
    }
  }

  // (6) Writes: the creator must still hold the rights of the entry's scope.
  //     A failing check (DB error) is a deny, never a pass nor a 500.
  if (isWriteEntry(entry)) {
    const scope = entry.requiredScopes[0]
    let holds = false
    try {
      holds = !!principal.tokenId && await creatorStillHolds({
        tokenId: principal.tokenId,
        tenantId: principal.tenantId,
        creatorUserId: principal.creatorUserId ?? null,
        connectionIds: principal.connectionIds,
      }, scope)
    } catch (e) {
      console.error("[api-tokens] creator check failed, denying:", (e as Error)?.message ?? e)
    }
    if (!holds) return deny({ status: 403, body: { error: CREATOR_LOST, scope } })
  }

  return null
}

/** `data` of a JSON response when it is a PVE task id. */
async function responseUpid(res: Response): Promise<string | null> {
  if (!(res.headers.get("content-type") || "").includes("application/json")) return null
  try {
    const data = (await res.clone().json())?.data
    return typeof data === "string" && data.startsWith("UPID:") ? data : null
  } catch {
    return null
  }
}

/**
 * One apitoken.write line for every token write that reached its handler
 * (spec 4.3), on top of the handlers' own business audits. Never throws and
 * never alters the response: a failing journal is logged, the answer leaves.
 */
export async function auditTokenWrite(
  entry: AllowlistEntry,
  principal: Principal,
  req: Request,
  res: Response,
): Promise<void> {
  if (!isWriteEntry(entry)) return
  try {
    const { audit } = await import("@/lib/audit")
    const hdrs = await headers()
    await audit({
      action: "apitoken.write",
      category: "api_tokens",
      resourceType: "api_token",
      resourceId: principal.tokenId,
      apiTokenId: principal.tokenId,
      status: res.ok ? "success" : "failure",
      details: {
        entry: entry.id,
        method: req.method,
        path: hdrs.get("x-pxc-path") || new URL(req.url).pathname,
        httpStatus: res.status,
        upid: await responseUpid(res),
      },
    })
  } catch (e) {
    console.error("[api-tokens] write audit failed:", (e as Error)?.message ?? e)
  }
}

// Journals every rejection at the route boundary (D13): a successful call is
// NOT logged (last_used_* already carries that), but a refusal is, with the
// token prefix only (never the secret) in details. Reads the Authorization
// header via headers() (next/headers), the same source getPrincipal itself
// and the guard's entry-pin check already use, rather than a `req` param.
export async function auditTokenDenied(
  rejection?: PrincipalRejection,
  context: { tokenId?: string; entryId?: string } = {},
): Promise<void> {
  try {
    const { audit } = await import("@/lib/audit")
    const hdrs = await headers()
    const authorization = hdrs.get("authorization") || ""
    const prefix = authorization.startsWith("Bearer ")
      ? extractTokenPrefix(authorization.slice("Bearer ".length))
      : null
    await audit({
      action: "apitoken.denied",
      category: "api_tokens",
      status: "failure",
      apiTokenId: context.tokenId,
      details: {
        status: rejection?.status ?? 401,
        reason: (rejection?.body as Record<string, unknown> | undefined)?.error ?? "invalid",
        entry: context.entryId,
        // Prefix ONLY, never the secret (spec section 10).
        tokenPrefix: prefix ?? undefined,
      },
    })
  } catch {
    // Auditing a denial must never mask the denial itself.
  }
}
