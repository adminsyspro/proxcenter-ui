// Request and response schemas of the service account entries (issue #1404).
import { STRINGS } from "./shared"

const ROLE = {
  type: "object",
  properties: {
    id: { type: "string", description: "The role assignment id" },
    roleId: { type: "string" },
    roleName: { type: "string" },
    color: { type: ["string", "null"] },
    scopeType: { type: "string" },
    scopeTarget: { type: ["string", "null"] },
  },
}

const SERVICE_ACCOUNT = {
  type: "object",
  properties: {
    id: { type: "string", description: "Also the user_id its role assignments name" },
    tenantId: { type: "string" },
    tenantName: { type: "string" },
    name: { type: "string" },
    description: { type: ["string", "null"] },
    enabled: { type: "boolean" },
    createdAt: { type: "string", format: "date-time" },
    roles: { type: "array", items: ROLE },
    tokenCount: { type: "integer" },
    lastUsedAt: { type: ["string", "null"], format: "date-time", description: "Last use of any of its tokens" },
  },
}

const TOKEN = {
  type: "object",
  description: "Never the secret, nor its hash",
  properties: {
    id: { type: "string" },
    tenantId: { type: "string" },
    name: { type: "string" },
    description: { type: ["string", "null"] },
    tokenPrefix: { type: "string" },
    scopes: STRINGS,
    connectionIds: { type: ["array", "null"], items: { type: "string" } },
    expiresAt: { type: ["string", "null"], format: "date-time" },
    lastUsedAt: { type: ["string", "null"], format: "date-time" },
    rateLimitPerMin: { type: "integer" },
    writeRateLimitPerMin: { type: "integer" },
    createdByEmail: { type: ["string", "null"] },
    createdAt: { type: "string", format: "date-time" },
  },
}

const OIDC_SETTINGS = {
  enabled: { type: "boolean" },
  provider_name: { type: "string", description: "Label of the sign-in button" },
  issuer_url: { type: "string", description: "OpenID Connect issuer; discovery is read from it" },
  client_id: { type: "string" },
  scopes: { type: "string", description: "Space separated" },
  authorization_url: { type: "string", description: "Override of the discovered endpoint" },
  token_url: { type: "string", description: "Override of the discovered endpoint" },
  userinfo_url: { type: "string", description: "Override of the discovered endpoint" },
  claim_email: { type: "string" },
  claim_name: { type: "string" },
  claim_groups: { type: "string" },
  auto_provision: { type: "boolean", description: "Create the account on first sign-in" },
  default_role: { type: "string", description: "A role assignable in the tenant" },
  require_group: { type: "boolean", description: "Refuse the sign-in of a user no group mapping row matches; needs at least one row" },
  show_local_login: { type: "boolean" },
  force_sso_redirect: { type: "boolean" },
  group_mapping_strategy: { type: "string" },
  allowed_domains: { type: "string", description: "Comma separated e-mail domains; empty = any" },
  self_service: { type: "boolean", description: "Lets the tenant's own admins manage this connection" },
  proxy_url: { type: "string" },
  proxy_username: { type: "string" },
  proxy_bypass: { type: "string" },
}

export const IDENTITY_REQUEST_SCHEMAS: Record<string, Record<string, unknown>> = {
  TenantOidcConnectionUpdateRequest: {
    type: "object",
    properties: {
      ...OIDC_SETTINGS,
      client_secret: { type: "string", description: "Omitted: the stored secret is kept" },
      proxy_password: { type: "string", description: "Omitted: the stored one is kept" },
      group_role_mapping: {
        type: "array",
        items: {
          type: "object",
          properties: { group: { type: "string" }, tenant: { type: "string" }, vdc: { type: "string" }, role: { type: "string" } },
        },
        description: "IdP group to role, within this tenant",
      },
      trusted_endpoints: { type: "boolean", description: "Session only: a token cannot turn it on (403)" },
    },
  },
  ServiceAccountCreateRequest: {
    type: "object",
    required: ["name"],
    properties: {
      name: { type: "string", maxLength: 64, description: "Unique in its tenant" },
      description: { type: "string", maxLength: 500 },
      tenantId: { type: "string", description: "Provider tenant only: the tenant of the account; the token's own tenant by default" },
    },
  },
  ServiceAccountUpdateRequest: {
    type: "object",
    description: "Only the given fields change.",
    properties: {
      name: { type: "string", maxLength: 64 },
      description: { type: ["string", "null"], maxLength: 500 },
      enabled: { type: "boolean", description: "false stops every token of the account at once" },
    },
  },
  ServiceAccountTokenCreateRequest: {
    type: "object",
    required: ["name", "scopes"],
    properties: {
      name: { type: "string" },
      description: { type: "string" },
      scopes: { ...STRINGS, description: "Scope ids, each held by the service account" },
      connectionIds: { type: ["array", "null"], items: { type: "string" }, description: "Connections of the account's tenant the token is restricted to; null = all" },
      expiresInDays: { type: ["number", "null"], description: "Days until expiry; null = no expiry" },
      rateLimitPerMin: { type: "integer" },
      writeRateLimitPerMin: { type: "integer" },
    },
  },
}

export const IDENTITY_RESPONSE_SCHEMAS: Record<string, Record<string, unknown>> = {
  TenantOidcConnectionResponse: {
    type: "object",
    properties: {
      data: {
        type: "object",
        additionalProperties: true,
        properties: {
          tenant_id: { type: "string" },
          configured: { type: "boolean" },
          trusted_endpoints: { type: "boolean" },
          ...OIDC_SETTINGS,
          group_role_mapping: { type: "string", description: "JSON array of { group, tenant, vdc, role }" },
          hasClientSecret: { type: "boolean", description: "Whether a secret is stored; never the secret" },
          callback_url: { type: "string", description: "Redirect URI to register at the IdP" },
          login_url: { type: "string" },
        },
      },
    },
  },
  ServiceAccountListResponse: { type: "object", properties: { data: { type: "array", items: SERVICE_ACCOUNT } } },
  ServiceAccountResponse: { type: "object", properties: { data: SERVICE_ACCOUNT } },
  ServiceAccountDeleteResponse: {
    type: "object",
    properties: { data: { type: "object", properties: { id: { type: "string" }, deleted: { type: "boolean" } } } },
  },
  ServiceAccountTokenListResponse: { type: "object", properties: { data: { type: "array", items: TOKEN } } },
  ServiceAccountTokenCreateResponse: {
    type: "object",
    properties: {
      data: {
        type: "object",
        properties: {
          token: TOKEN,
          secret: { type: "string", description: "The pxc_ secret, returned once and never again" },
        },
      },
    },
  },
}
