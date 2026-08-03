// The allowlist is the SINGLE source of truth for authorization, the contract
// tests and this generated documentation (spec D8).
import { PUBLIC_API_ALLOWLIST, type AllowlistEntry } from "./allowlist"
import { RESPONSE_SCHEMAS } from "./openapiSchemas"
import { SCOPE_DEFINITIONS } from "./scopes"

function jsonError(description: string, example: Record<string, unknown>) {
  return { description, content: { "application/json": { example } } }
}

function successResponse(entry: AllowlistEntry) {
  const schema = RESPONSE_SCHEMAS[entry.responseSchemaRef]
  const mediaType = entry.responseSchemaRef === "PrometheusExposition" ? "text/plain" : "application/json"
  return {
    description: "Success",
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
      params.push({
        name,
        in: "path",
        required: true,
        schema: { type: "string" },
        description:
          entry.connectionSegment === name
            ? "Raw connection id; must be inside the token connection perimeter."
            : "Path parameter.",
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

export function buildOpenApiDocument(): Record<string, unknown> {
  const paths: Record<string, unknown> = {}
  for (const entry of PUBLIC_API_ALLOWLIST) {
    paths[entry.pattern] = {
      get: {
        operationId: entry.id,
        summary: entry.summary,
        description: entry.description,
        "x-required-scopes": entry.requiredScopes,
        parameters: parameters(entry),
        responses: {
          "200": successResponse(entry),
          "401": jsonError("Unknown, invalid, revoked or expired token", {
            error: "Invalid or expired API token",
          }),
          "403": jsonError("Token holds none of the required scopes", {
            error: "Route not available to API tokens",
            route: entry.pattern,
          }),
          "405": jsonError("API tokens are read-only", {
            error: "API tokens are read-only",
            method: "POST",
          }),
          "429": jsonError("Per-token quota exhausted", {
            error: "Rate limit exceeded",
            retryAfter: 42,
          }),
        },
      },
    }
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "ProxCenter public read-only API",
      version: "1",
      description:
        "Read-only API for external monitoring tooling, authenticated by a pxc_ service-account token. GET and HEAD only. Server to server: no CORS header is emitted.",
    },
    servers: [{ url: "{proxcenterBaseUrl}", variables: { proxcenterBaseUrl: { default: "https://proxcenter.example.com" } } }],
    security: [{ bearerAuth: [] }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          description: "Send the full secret as `Authorization: Bearer pxc_...`.",
        },
      },
      schemas: RESPONSE_SCHEMAS,
      "x-scopes": SCOPE_DEFINITIONS,
    },
    paths,
  }
}
