// src/lib/audit/withAudit.ts
//
// Safety net of the audit log (issue #1105): every mutating API route is
// exported through this wrapper, so an action that reaches ProxCenter leaves
// a row even when nobody wrote an audit() call for it, and a refused or
// failed action leaves a failure row instead of nothing.
//
// A route that calls audit() itself keeps its richer row: audit() flips the
// request's scope (lib/audit/scope.ts) and the wrapper then writes nothing.
// The wrapper never alters the response and never throws on its own; an
// audit write that fails is logged and the response goes out unchanged.

import { redactReplacer } from "@/lib/syslog/format"

import { audit, type AuditAction, type AuditCategory, type AuditStatus } from "./index"
import { auditScope, type AuditScope } from "./scope"

export interface AuditRouteSpec {
  category: AuditCategory
  /** Defaults from the HTTP method: POST→create, PUT/PATCH→update, DELETE→delete. */
  action?: AuditAction
  resourceType?: string
  /** Route param holding the resource id (e.g. 'vmid', 'node', 'id'). */
  resourceParam?: string
  /** Route param whose value names the resource type (the guest `[type]`: qemu or lxc), over `resourceType`. */
  resourceTypeParam?: string
  /** JSON body field holding the resource id when the route creates it (e.g. 'vmid' on guest create). */
  resourceBodyField?: string
  /** JSON body field holding a human name (e.g. 'name'). */
  resourceNameBodyField?: string
}

// Loose on purpose: routes take NextRequest, a required ctx, and a few return synchronously.
type RouteHandler = (...args: any[]) => Response | Promise<Response>
type RouteParams = Record<string, string | string[]> | undefined

/** Largest JSON body the wrapper is willing to clone; ISO uploads and multipart are never touched. */
export const MAX_CAPTURED_BODY_BYTES = 65_536
/** Largest redacted request kept in `details.request`; beyond it only `requestTruncated` is stored. */
export const MAX_REQUEST_DETAIL_CHARS = 8_192
export const MAX_ERROR_MESSAGE_CHARS = 500

interface Captured {
  req: Request
  spec: AuditRouteSpec
  params: RouteParams
  body: unknown
}

interface Outcome {
  status: AuditStatus
  httpStatus: number
  errorMessage?: string
}

/**
 * Wrap a route handler so that its outcome is audited unless the handler
 * audited itself. The returned function keeps the handler's exact type, so a
 * wrapped export still satisfies the `{ params }` contract Next checks.
 */
export function withAudit<H extends RouteHandler>(spec: AuditRouteSpec, handler: H): H {
  const wrapped = async (req: Request, ctx?: any): Promise<Response> => {
    const scope: AuditScope = { explicit: false }

    return auditScope.run(scope, async () => {
      // Both read before the handler runs: it consumes the body, and the
      // params come as a Promise from Next 16.
      const captured: Captured = {
        req,
        spec,
        params: await resolveParams(ctx),
        body: await captureJsonBody(req),
      }

      let res: Response
      try {
        res = await handler(req, ctx)
      } catch (err) {
        // Next answers an unhandled route error with a 500; the row says so.
        if (!scope.explicit) {
          await writeRow(captured, { status: "failure", httpStatus: 500, errorMessage: errorText(err) })
        }
        throw err
      }

      // No actor behind a 401, and a redirect is not an outcome.
      if (scope.explicit || res.status === 401 || (res.status >= 300 && res.status < 400)) return res

      const failed = res.status >= 400
      await writeRow(captured, {
        status: failed ? "failure" : "success",
        httpStatus: res.status,
        errorMessage: failed ? await responseError(res) : undefined,
      })
      return res
    })
  }

  return wrapped as unknown as H
}

// ---- helpers --------------------------------------------------------------

function defaultAction(method: string): AuditAction {
  switch (method) {
    case "POST":
      return "create"
    case "PUT":
    case "PATCH":
      return "update"
    case "DELETE":
      return "delete"
    default:
      return "read"
  }
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) : text
}

function errorText(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  return truncate(message, MAX_ERROR_MESSAGE_CHARS)
}

async function resolveParams(ctx: unknown): Promise<RouteParams> {
  try {
    const params = await Promise.resolve((ctx as { params?: unknown } | undefined)?.params)
    return params && typeof params === "object" ? (params as RouteParams) : undefined
  } catch {
    return undefined
  }
}

/**
 * Clone and parse the request body only when it is declared as JSON and its
 * size is known and small. Anything else (multipart, octet-stream, chunked or
 * oversized) is left to the handler untouched: an ISO upload is gigabytes.
 */
async function captureJsonBody(req: Request): Promise<unknown> {
  if (req.method === "GET" || req.method === "HEAD" || req.bodyUsed) return undefined
  const contentType = req.headers.get("content-type") ?? ""
  if (!contentType.toLowerCase().includes("application/json")) return undefined
  const declared = req.headers.get("content-length")
  if (declared === null) return undefined
  const length = Number(declared)
  if (!Number.isFinite(length) || length <= 0 || length > MAX_CAPTURED_BODY_BYTES) return undefined
  try {
    return await req.clone().json()
  } catch {
    return undefined
  }
}

/** The `error` (or `message`) string of a JSON error response, read from a clone. */
async function responseError(res: Response): Promise<string | undefined> {
  const contentType = res.headers.get("content-type") ?? ""
  if (res.body === null || !contentType.toLowerCase().includes("application/json")) return undefined
  try {
    const payload = (await res.clone().json()) as { error?: unknown; message?: unknown } | null
    const text = [payload?.error, payload?.message].find((v): v is string => typeof v === "string")
    return text === undefined ? undefined : truncate(text, MAX_ERROR_MESSAGE_CHARS)
  } catch {
    return undefined
  }
}

function bodyField(body: unknown, field: string | undefined): unknown {
  if (!field || body === null || typeof body !== "object" || Array.isArray(body)) return undefined
  return (body as Record<string, unknown>)[field]
}

function asId(value: unknown): string | undefined {
  if (typeof value === "string" && value !== "") return value
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  if (Array.isArray(value)) return value.map(String).join("/")
  return undefined
}

/**
 * Serialising through redactReplacer drops credentials under their usual key
 * names and copies the body, so a caller-controlled key never lands on an
 * object of ours.
 */
function requestDetail(body: unknown): { request?: unknown; requestTruncated?: true } {
  if (body === undefined) return {}
  let text: string | undefined
  try {
    text = JSON.stringify(body, redactReplacer)
  } catch {
    return {}
  }
  if (text === undefined) return {}
  if (text.length > MAX_REQUEST_DETAIL_CHARS) return { requestTruncated: true }
  return { request: JSON.parse(text) }
}

async function writeRow(captured: Captured, outcome: Outcome): Promise<void> {
  const { req, spec, params, body } = captured
  try {
    const url = new URL(req.url)
    const resourceId = asId(params?.[spec.resourceParam ?? ""]) ?? asId(bodyField(body, spec.resourceBodyField))
    const name = bodyField(body, spec.resourceNameBodyField)
    const resourceType = asId(params?.[spec.resourceTypeParam ?? ""]) ?? spec.resourceType

    await audit({
      // Same split as the routes that audit themselves: a container is not a VM.
      category: spec.category === "vms" && resourceType === "lxc" ? "containers" : spec.category,
      action: spec.action ?? defaultAction(req.method),
      resourceType,
      resourceId,
      resourceName: typeof name === "string" ? name : undefined,
      status: outcome.status,
      errorMessage: outcome.errorMessage,
      details: {
        route: url.pathname,
        method: req.method,
        httpStatus: outcome.httpStatus,
        params: params ?? {},
        query: JSON.parse(JSON.stringify(Object.fromEntries(url.searchParams), redactReplacer)),
        ...requestDetail(body),
      },
    })
  } catch (err) {
    // The response is already decided; a lost safety-net row is logged, never surfaced.
    console.error("[audit] withAudit could not write the audit row:", err instanceof Error ? err.message : err)
  }
}
