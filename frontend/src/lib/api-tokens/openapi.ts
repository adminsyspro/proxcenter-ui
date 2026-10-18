// The allowlist is the SINGLE source of truth for authorization, the contract
// tests and this generated documentation (spec D8).
import { PUBLIC_API_ALLOWLIST, type AllowlistEntry, type ApiTag, type HttpMethod } from "./allowlist"
import { REQUEST_SCHEMAS, RESPONSE_SCHEMAS } from "./openapiSchemas"
import { SCOPE_DEFINITIONS } from "./scopes"

// Same order as the ApiTag union.
const API_TAGS: ApiTag[] = [
  "Monitoring", "VMs", "Snapshots", "Backups", "Storage", "HA", "Pools", "Network", "Firewall", "Tasks",
]

const REFUSAL_METHODS: HttpMethod[] = ["POST", "DELETE", "PUT", "PATCH", "GET"]

function jsonError(description: string, example: Record<string, unknown>) {
  return { description, content: { "application/json": { example } } }
}

function jsonErrorExamples(description: string, examples: Record<string, Record<string, unknown>>) {
  const named = Object.fromEntries(Object.entries(examples).map(([name, value]) => [name, { value }]))
  return { description, content: { "application/json": { examples: named } } }
}

function forbiddenResponse(entry: AllowlistEntry) {
  const scopeBody = { error: "Route not available to API tokens", route: entry.pattern }
  const examples: Record<string, Record<string, unknown>> = { scope: scopeBody }
  if (entry.connectionSegment || entry.vmKeySegment || entry.connectionField) {
    examples.perimeter = { error: "Connection not in token scope", connection: "conn-1" }
  }
  if (entry.clusterObject) {
    examples.clusterObject = { error: "Cluster-level object not available to a vDC tenant token" }
  }
  if (entry.guestScope) examples.guestScope = { error: "Guest outside your vDC scope" }
  if (Object.keys(examples).length === 1) {
    return jsonError("Token holds none of the required scopes", scopeBody)
  }
  return jsonErrorExamples("Token holds none of the required scopes, or the target is outside the token perimeter", examples)
}

type SchemaSets = { request: Record<string, Record<string, unknown>>; response: Record<string, Record<string, unknown>> }

function successResponse(entry: AllowlistEntry, schemas: SchemaSets) {
  const schema = schemas.response[entry.responseSchemaRef]
  if (!schema) throw new Error(`Unknown responseSchemaRef ${entry.responseSchemaRef} for ${entry.id}`)
  const mediaType = entry.responseSchemaRef === "PrometheusExposition" ? "text/plain" : "application/json"
  return {
    description: entry.responseSchemaRef === "TaskStartedResponse"
      ? "Proxmox task started; poll GET /api/v1/tasks/{connectionId}/{node}/{upid} with the returned UPID"
      : "Success",
    headers: {
      "RateLimit-Limit": { description: "Requests allowed per minute", schema: { type: "integer" } },
      "RateLimit-Remaining": { description: "Requests left in the window", schema: { type: "integer" } },
      "RateLimit-Reset": { description: "Seconds until the window resets", schema: { type: "integer" } },
    },
    content: { [mediaType]: { schema } },
  }
}

function parameters(entry: AllowlistEntry) {
  const params: Array<Record<string, unknown>> = []
  for (const segment of entry.pattern.split("/")) {
    if (segment.startsWith("{") && segment.endsWith("}")) {
      const name = segment.slice(1, -1)
      const allowed = entry.segmentEnum?.[name]
      let description = "Path parameter."
      if (entry.connectionSegment === name) {
        description = "Raw connection id; must be inside the token connection perimeter."
      } else if (entry.vmKeySegment === name) {
        description = "Composite guest key connId:type:node:vmid; the connection must be inside the token connection perimeter."
      } else if (entry.segmentExclude?.[name]) {
        description = "Path parameter, sent unencoded: a percent-encoded character in it is refused (401)."
      }
      params.push({
        name,
        in: "path",
        required: true,
        schema: allowed ? { type: "string", enum: [...allowed] } : { type: "string" },
        description,
      })
    }
  }
  for (const query of entry.queryParams ?? []) {
    params.push({
      name: query.name,
      in: "query",
      required: query.required === true,
      schema: { type: "string" },
      description: query.description,
    })
  }
  return params
}

// Scalar renders no custom extension, so x-required-scopes alone stays
// invisible in the reference: the description says it too. Any one of the
// listed scopes is enough; an entry without scopes takes any valid token.
function requiredScopesLine(scopes: readonly string[]): string {
  if (scopes.length === 0) return "Required scope: any valid token"
  return `Required scope: ${scopes.map((scope) => `\`${scope}\``).join(" or ")}`
}

function operation(entry: AllowlistEntry, refusedMethod: HttpMethod, schemas: SchemaSets) {
  const line = requiredScopesLine(entry.requiredScopes)
  const op: Record<string, unknown> = {
    operationId: entry.id,
    summary: entry.summary,
    description: entry.description ? `${entry.description}\n\n${line}` : line,
    tags: [entry.tag],
    "x-required-scopes": entry.requiredScopes,
    parameters: parameters(entry),
  }
  if (entry.requestSchemaRef) {
    const requestSchema = schemas.request[entry.requestSchemaRef]
    if (!requestSchema) throw new Error(`Unknown requestSchemaRef ${entry.requestSchemaRef} for ${entry.id}`)
    op.requestBody = { required: true, content: { "application/json": { schema: requestSchema } } }
  }
  op.responses = {
    "200": successResponse(entry, schemas),
    "401": jsonError("Unknown, invalid, revoked or expired token", {
      error: "Invalid or expired API token",
    }),
    "403": forbiddenResponse(entry),
    "405": jsonError("Method not allowed for this API token route", {
      error: "Method not allowed for this API token route",
      method: refusedMethod,
    }),
    "429": jsonError("Per-token quota exhausted", {
      error: "Rate limit exceeded",
      retryAfter: 42,
    }),
  }
  return op
}

export function buildOpenApiDocument(
  entries: AllowlistEntry[] = PUBLIC_API_ALLOWLIST,
  schemas: SchemaSets = { request: REQUEST_SCHEMAS, response: RESPONSE_SCHEMAS },
): Record<string, unknown> {
  const declared = new Map<string, Set<HttpMethod>>()
  for (const entry of entries) {
    const methods = declared.get(entry.pattern) ?? new Set<HttpMethod>()
    methods.add(entry.method)
    declared.set(entry.pattern, methods)
  }

  const paths: Record<string, Record<string, unknown>> = {}
  for (const entry of entries) {
    const methods = declared.get(entry.pattern)!
    const refusedMethod = REFUSAL_METHODS.find((m) => !methods.has(m)) ?? "PATCH"
    paths[entry.pattern] ??= {}
    paths[entry.pattern][entry.method.toLowerCase()] = operation(entry, refusedMethod, schemas)
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "ProxCenter public API",
      version: "1",
      description:
        "API for external tooling, authenticated by a pxc_ service-account token. Reading and writing depend on the scopes granted to the token. Write operations act on the real infrastructure immediately. Server to server: no CORS header is emitted.",
    },
    servers: [{ url: "{proxcenterBaseUrl}", variables: { proxcenterBaseUrl: { default: "https://proxcenter.example.com" } } }],
    security: [{ bearerAuth: [] }],
    tags: API_TAGS.map((name) => ({ name })),
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          description: "Send the full secret as `Authorization: Bearer pxc_...`.",
        },
      },
      schemas: { ...schemas.request, ...schemas.response },
      "x-scopes": SCOPE_DEFINITIONS,
    },
    paths,
  }
}
