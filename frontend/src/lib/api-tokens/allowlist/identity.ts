// PURE data module: imported by BOTH the proxy (D7) and
// principal.ts (D8). NO DB access, ever.
import type { AllowlistEntry, HttpMethod } from "./types"

// ── Service accounts and their tokens (issue #1404) ──────────────────────────
// Scopes identity:read (admin.apitokens.view) and identity:write
// (admin.apitokens), each needing a global grant and, for writes, a token not
// restricted to connections. The provider tenant reaches every tenant's
// accounts, another tenant its own.
const READ_NOTE = "Needs admin.apitokens.view (scope identity:read or identity:write). The provider tenant reaches every tenant's service accounts, another tenant its own; another tenant's account answers 404."
const PROVIDER_NOTE = "Provider tenant only: another tenant's token gets 403; `default` (the provider IdP) answers 400."
const WRITE_NOTE = "Needs admin.apitokens (scope identity:write). The provider tenant reaches every tenant's service accounts, another tenant its own. A token restricted to some connections gets 403."

/** [id, method, file under src/app/api/v1, summary, request schema, response schema, description, extra]. */
type Row = [string, HttpMethod, string, string, string | null, string, string, Partial<AllowlistEntry>?]

function entries(write: boolean, rows: Row[]): AllowlistEntry[] {
  return rows.map(([id, method, file, summary, requestSchemaRef, responseSchemaRef, description, own]) => ({
    id,
    method,
    pattern: `/api/v1/${file.replaceAll(/\[(\w+)\]/g, "{$1}")}`,
    requiredScopes: write ? ["identity:write"] : ["identity:read", "identity:write"],
    ...(write ? { perimeter: "fleet" as const } : {}),
    tag: "Identity",
    routeFile: `src/app/api/v1/${file}/route.ts`,
    summary,
    description,
    ...(requestSchemaRef ? { requestSchemaRef } : {}),
    responseSchemaRef,
    ...own,
  }))
}

export const IDENTITY_ENTRIES: AllowlistEntry[] = [
  ...entries(false, [
    ["service-accounts-list", "GET", "service-accounts", "Service accounts", null, "ServiceAccountListResponse",
      `The service accounts with their tenant, roles, number of tokens and last use. ${READ_NOTE}`],
    ["service-account-get", "GET", "service-accounts/[id]", "Service account", null, "ServiceAccountResponse",
      `The service account {id}. ${READ_NOTE}`],
    ["service-account-tokens-list", "GET", "service-accounts/[id]/tokens", "Tokens of a service account", null, "ServiceAccountTokenListResponse",
      `The API tokens of the service account {id}, never their secret. ${READ_NOTE}`],
  ]),
  ...entries(true, [
    ["service-account-create", "POST", "service-accounts", "Create a service account", "ServiceAccountCreateRequest", "ServiceAccountResponse",
      `Creates a service account: an identity with no password and no interactive login that only authenticates with its API tokens. It holds no role until one is assigned (POST /api/v1/rbac/assignments with its id as \`user_id\`, scope rbac:write). Answers 201; 409 when the name is taken in the tenant. ${WRITE_NOTE}`],
    ["service-account-update", "PATCH", "service-accounts/[id]", "Update a service account", "ServiceAccountUpdateRequest", "ServiceAccountResponse",
      `Changes the name, the description or the enabled state of the service account {id}. A disabled account's tokens are refused at once. A token cannot change the account it acts as (403). ${WRITE_NOTE}`],
    ["service-account-delete", "DELETE", "service-accounts/[id]", "Delete a service account", null, "ServiceAccountDeleteResponse",
      `Deletes the service account {id} with its tokens and role assignments. A token cannot delete the account it acts as (403). ${WRITE_NOTE}`],
    ["service-account-token-create", "POST", "service-accounts/[id]/tokens", "Create a token for a service account", "ServiceAccountTokenCreateRequest", "ServiceAccountTokenCreateResponse",
      `Creates an API token acting as the service account {id}: on every call it is bound by the account's roles, never by its creator's, and it stops when the account is disabled or deleted. The secret is returned once. Refused when the account is disabled (409), when it does not hold one of the scopes (400), when the caller could not grant one (403), and, for a token, when it does not carry one itself (403). ${WRITE_NOTE}`],
    ["service-account-token-delete", "DELETE", "service-accounts/[id]/tokens/[tokenId]", "Revoke a token of a service account", null, "ServiceAccountDeleteResponse",
      `Deletes the token {tokenId} of the service account {id}; 404 when it belongs to another account. ${WRITE_NOTE}`],
    ["service-account-token-rotate", "POST", "service-accounts/[id]/tokens/[tokenId]/rotate", "Rotate a token of a service account", null, "ServiceAccountTokenCreateResponse",
      `Gives the token {tokenId} of the service account {id} a new secret, returned once: its id, name, scopes, connections, expiry and rate limits stay, and the old secret stops authenticating at once. Follows the rules of creation: refused when the account is disabled (409), when it no longer holds one of the token's scopes (400), when the caller could not grant one (403), and, for a token, when it does not carry one itself (403). A token may rotate itself. ${WRITE_NOTE}`],
  ]),
  // The IdP connection of a customer tenant (issue #1289), provider tenant only.
  ...entries(false, [
    ["tenant-oidc-connection-get", "GET", "auth/oidc/connections/[tenantId]", "OIDC connection of a tenant", null, "TenantOidcConnectionResponse",
      `The OIDC connection of the customer tenant {tenantId}: issuer, client id, scopes, claims, default role, allowed domains and group mapping; \`has_client_secret\` says whether a secret is stored, never the secret. Needs admin.settings.view (scope identity:read or identity:write). ${PROVIDER_NOTE}`],
  ]),
  ...entries(true, [
    ["tenant-oidc-connection-update", "PUT", "auth/oidc/connections/[tenantId]", "Configure the OIDC connection of a tenant", "TenantOidcConnectionUpdateRequest", "SuccessResponse",
      `Creates or replaces the OIDC connection of the customer tenant {tenantId}. An omitted \`client_secret\` keeps the stored one. The issuer is checked against private and internal addresses unless the provider trusts the tenant's endpoints. Needs admin.settings.identity (scope identity:write). ${PROVIDER_NOTE} A token restricted to some connections gets 403.`],
    ["tenant-oidc-connection-delete", "DELETE", "auth/oidc/connections/[tenantId]", "Remove the OIDC connection of a tenant", null, "SuccessResponse",
      `Removes the OIDC connection of the customer tenant {tenantId}; its users keep their accounts. Needs admin.settings.identity (scope identity:write). ${PROVIDER_NOTE} A token restricted to some connections gets 403.`],
  ]),
]
