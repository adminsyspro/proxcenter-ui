// PURE data modules: imported by BOTH the proxy (D7) and
// principal.ts (D8). NO DB access, ever.
import type { AllowlistEntry } from "./types"

// ── Multi-tenant layer, read only (issue #1360) ─────────────────────────────
const PROVIDER_NOTE = "Provider tenant only: another tenant's token gets 403."
const PERIMETER_NOTE = "A token restricted to some connections only sees the vDCs on those connections (404 for another one)."

type Entry = Omit<AllowlistEntry, "method" | "routeFile"> & { file: string }

/** A GET route; `file` is its directory under src/app/api/v1. */
function getEntry({ file, ...entry }: Entry): AllowlistEntry {
  return { ...entry, method: "GET", routeFile: `src/app/api/v1/${file}/route.ts` }
}

export const TENANT_ENTRIES: AllowlistEntry[] = [
  getEntry({
    id: "tenants-list",
    file: "tenants",
    pattern: "/api/v1/tenants",
    requiredScopes: ["tenants:read"],
    tag: "Tenants",
    summary: "Tenants",
    description: `Every tenant with its operating model, VMID range and settings. Needs admin.tenants.view (scope tenants:read). ${PROVIDER_NOTE}`,
    responseSchemaRef: "TenantListResponse",
  }),
  getEntry({
    id: "tenant-get",
    file: "tenants/[id]",
    pattern: "/api/v1/tenants/{id}",
    requiredScopes: ["tenants:read"],
    tag: "Tenants",
    summary: "Tenant",
    description: `The tenant {id}; 404 when it does not exist. Needs admin.tenants.view (scope tenants:read). ${PROVIDER_NOTE}`,
    responseSchemaRef: "TenantResponse",
  }),
  getEntry({
    id: "tenant-users-list",
    file: "tenants/[id]/users",
    pattern: "/api/v1/tenants/{id}/users",
    requiredScopes: ["tenants:read"],
    tag: "Tenants",
    summary: "Members of a tenant",
    description: `The users who belong to the tenant {id}. Needs admin.tenants.view (scope tenants:read). ${PROVIDER_NOTE}`,
    responseSchemaRef: "TenantUsersResponse",
  }),
]

export const VDC_ENTRIES: AllowlistEntry[] = [
  getEntry({
    id: "vdcs-list",
    file: "vdcs",
    pattern: "/api/v1/vdcs",
    requiredScopes: ["vms:read", "vdcs:read"],
    perimeter: "handler",
    tag: "vDCs",
    summary: "vDCs of the token's tenant",
    description:
      `The vDCs of the token's tenant with their quotas and usage; a usage older than 15 seconds is refreshed from Proxmox first (one usage read per stale vDC). Needs vm.view (scope vms:read or vdcs:read). ${PERIMETER_NOTE}`,
    responseSchemaRef: "VdcListResponse",
  }),
  getEntry({
    id: "admin-vdcs-list",
    file: "admin/vdcs",
    pattern: "/api/v1/admin/vdcs",
    requiredScopes: ["vdcs:read"],
    perimeter: "handler",
    tag: "vDCs",
    summary: "Every vDC",
    description:
      `The vDCs of every tenant, or of one with \`tenantId\`: pool, nodes, storages, bridges, quotas and usage. Needs admin.settings.view (scope vdcs:read). ${PROVIDER_NOTE} ${PERIMETER_NOTE}`,
    queryParams: [{ name: "tenantId", description: "Only the vDCs of this tenant", required: false }],
    responseSchemaRef: "VdcListResponse",
  }),
  getEntry({
    id: "admin-vdc-get",
    file: "admin/vdcs/[id]",
    pattern: "/api/v1/admin/vdcs/{id}",
    requiredScopes: ["vdcs:read"],
    perimeter: "handler",
    tag: "vDCs",
    summary: "vDC",
    description: `The vDC {id}; 404 when it does not exist. Needs admin.settings.view (scope vdcs:read). ${PROVIDER_NOTE} ${PERIMETER_NOTE}`,
    responseSchemaRef: "VdcResponse",
  }),
  getEntry({
    id: "vdc-evpn-networks",
    file: "vdcs/[id]/evpn-networks",
    pattern: "/api/v1/vdcs/{id}/evpn-networks",
    requiredScopes: ["vdcs:read", "network:write"],
    perimeter: "handler",
    tag: "vDCs",
    summary: "EVPN networks of a vDC",
    description:
      "Whether the vDC is attached to a shared EVPN zone, the vDCs of its tenant attached to the same zone, and the networks it holds there. Needs sdn.vnet.view (scope vdcs:read or network:write). The vDC must belong to the token's tenant (404 otherwise) and sit on a connection inside the token perimeter.",
    responseSchemaRef: "VdcEvpnNetworksResponse",
  }),
  getEntry({
    id: "evpn-zones-list",
    file: "admin/evpn-zones",
    pattern: "/api/v1/admin/evpn-zones",
    requiredScopes: ["vdcs:read"],
    perimeter: "handler",
    tag: "vDCs",
    summary: "Shared EVPN zones",
    description:
      `The EVPN zones shared between clusters, with their member clusters. Needs admin.settings.view (scope vdcs:read). ${PROVIDER_NOTE} A token restricted to some connections only sees the zones whose every member cluster is inside its perimeter.`,
    responseSchemaRef: "EvpnZoneListResponse",
  }),
  getEntry({
    id: "evpn-zone-get",
    file: "admin/evpn-zones/[id]",
    pattern: "/api/v1/admin/evpn-zones/{id}",
    requiredScopes: ["vdcs:read"],
    perimeter: "handler",
    segmentExclude: { id: ["collisions", "discover"] },
    tag: "vDCs",
    summary: "Shared EVPN zone",
    description:
      `The EVPN zone {id} and how each member cluster runs it (read from Proxmox, three reads per member cluster). Needs admin.settings.view (scope vdcs:read). ${PROVIDER_NOTE} A zone with a member cluster outside the token perimeter answers 404.`,
    responseSchemaRef: "EvpnZoneResponse",
  }),
  getEntry({
    id: "storage-policies-list",
    file: "admin/connections/[id]/storage-policies",
    pattern: "/api/v1/admin/connections/{id}/storage-policies",
    requiredScopes: ["vdcs:read"],
    connectionSegment: "id",
    clusterObject: true,
    tag: "vDCs",
    summary: "Storage policies of a connection",
    description: `The storage policies the vDCs of the connection {id} can be given. Needs admin.settings.view (scope vdcs:read). ${PROVIDER_NOTE}`,
    responseSchemaRef: "StoragePolicyListResponse",
  }),
  getEntry({
    id: "vdc-moves-list",
    file: "vdc/moves",
    pattern: "/api/v1/vdc/moves",
    requiredScopes: ["vms:read", "vdcs:read"],
    perimeter: "handler",
    tag: "vDCs",
    summary: "Moves of guests between vDCs",
    description:
      `The moves of guests between the vDCs of the token's tenant (every tenant for the provider), newest first; \`active=1\` keeps the running ones. Needs vm.view (scope vms:read or vdcs:read). ${PERIMETER_NOTE}`,
    queryParams: [{ name: "active", description: "1 to list the running moves only", required: false }],
    responseSchemaRef: "VdcMoveListResponse",
  }),
  getEntry({
    id: "vdc-move-get",
    file: "vdc/moves/[moveId]",
    pattern: "/api/v1/vdc/moves/{moveId}",
    requiredScopes: ["vms:read", "vdcs:read"],
    perimeter: "handler",
    tag: "vDCs",
    summary: "Move of a guest between vDCs",
    description: `The move {moveId}, to poll until it ends; another tenant's move answers 404. Needs vm.view (scope vms:read or vdcs:read). ${PERIMETER_NOTE}`,
    responseSchemaRef: "VdcMoveResponse",
  }),
]

const RBAC_NOTE = "Needs admin.rbac.view (scope rbac:read). Scoped to the token's tenant; provider-level roles and their holders stay hidden from a token."
const USERS_NOTE = "Needs admin.users.view (scope users:read). The provider tenant lists every user, another tenant its own members; provider operators stay hidden from a token."

export const ACCESS_ENTRIES: AllowlistEntry[] = [
  getEntry({
    id: "rbac-roles-list",
    file: "rbac/roles",
    pattern: "/api/v1/rbac/roles",
    requiredScopes: ["rbac:read"],
    tag: "RBAC",
    summary: "Roles",
    description: `The system roles, the tenant's custom roles and, outside the provider tenant, the catalogue roles published to it, each with its permissions and audience. ${RBAC_NOTE}`,
    responseSchemaRef: "RbacRoleListResponse",
  }),
  getEntry({
    id: "rbac-role-get",
    file: "rbac/roles/[id]",
    pattern: "/api/v1/rbac/roles/{id}",
    requiredScopes: ["rbac:read"],
    tag: "RBAC",
    summary: "Role",
    description: `The role {id} with its permissions; 404 when the token's tenant cannot see it. ${RBAC_NOTE}`,
    responseSchemaRef: "RbacRoleResponse",
  }),
  getEntry({
    id: "rbac-permissions-list",
    file: "rbac/permissions",
    pattern: "/api/v1/rbac/permissions",
    requiredScopes: ["rbac:read"],
    tag: "RBAC",
    summary: "Permissions",
    description: "Every permission a role can carry, flat and grouped by category. Needs admin.rbac.view (scope rbac:read).",
    responseSchemaRef: "RbacPermissionListResponse",
  }),
  getEntry({
    id: "rbac-assignments-list",
    file: "rbac/assignments",
    pattern: "/api/v1/rbac/assignments",
    requiredScopes: ["rbac:read"],
    tag: "RBAC",
    summary: "Role assignments",
    description: `Who holds which role, on which scope, until when. ${RBAC_NOTE}`,
    responseSchemaRef: "RbacAssignmentListResponse",
  }),
  getEntry({
    id: "rbac-assignment-get",
    file: "rbac/assignments/[id]",
    pattern: "/api/v1/rbac/assignments/{id}",
    requiredScopes: ["rbac:read"],
    tag: "RBAC",
    summary: "Role assignment",
    description: `The assignment {id}; 404 when the token's tenant cannot see it. ${RBAC_NOTE}`,
    responseSchemaRef: "RbacAssignmentResponse",
  }),
  getEntry({
    id: "users-list",
    file: "users",
    pattern: "/api/v1/users",
    requiredScopes: ["users:read"],
    tag: "Users",
    summary: "Users",
    description: `The users with their authentication source, state and tenant memberships. ${USERS_NOTE}`,
    responseSchemaRef: "UserListResponse",
  }),
  getEntry({
    id: "user-get",
    file: "users/[id]",
    pattern: "/api/v1/users/{id}",
    requiredScopes: ["users:read"],
    tag: "Users",
    summary: "User",
    description: `The user {id}; 404 when the token's tenant cannot see it. ${USERS_NOTE}`,
    responseSchemaRef: "UserResponse",
  }),
]
