// PURE data modules: imported by BOTH the proxy (D7) and
// principal.ts (D8). NO DB access, ever.
import type { AllowlistEntry, HttpMethod } from "./types"

// ── Multi-tenant layer, writes (issue #1360, lot 2) ──────────────────────────
// Scope vdcs:write (admin.settings.vdcs, global grant), provider tenant only.
// Every write reaches clusters beyond one connection (fleet-wide VNI scan,
// stretched networks, PBS storages), so it needs a token not restricted to
// connections (perimeter "fleet").
const ADMIN_NOTE = "Needs admin.settings.vdcs (scope vdcs:write). Provider tenant only: another tenant's token gets 403. A token restricted to some connections gets 403."

/** [id, method, file under src/app/api/v1, summary, request schema, response schema, description, extra]. */
type WriteRow = [string, HttpMethod, string, string, string | null, string, string, Partial<AllowlistEntry>?]

/** Entries sharing `shared` (scope, tag, perimeter); the pattern follows the file (`[id]` becomes `{id}`). */
function writeEntries(shared: Pick<AllowlistEntry, "requiredScopes" | "tag"> & Partial<AllowlistEntry>, rows: WriteRow[]): AllowlistEntry[] {
  return rows.map(([id, method, file, summary, requestSchemaRef, responseSchemaRef, description, own]) => ({
    id,
    method,
    pattern: `/api/v1/${file.replaceAll(/\[(\w+)\]/g, "{$1}")}`,
    perimeter: "fleet",
    routeFile: `src/app/api/v1/${file}/route.ts`,
    summary,
    description,
    ...(requestSchemaRef ? { requestSchemaRef } : {}),
    responseSchemaRef,
    ...shared,
    ...own,
  }))
}

/** vdcs:write entries sharing `extra`. */
function vdcWriteEntries(extra: Partial<AllowlistEntry>, rows: WriteRow[]): AllowlistEntry[] {
  return writeEntries({ requiredScopes: ["vdcs:write"], tag: "vDCs", ...extra }, rows)
}

export const VDC_WRITE_ENTRIES: AllowlistEntry[] = [
  ...vdcWriteEntries({}, [
    ["admin-vdc-create", "POST", "admin/vdcs", "Create a vDC", "AdminVdcCreateRequest", "VdcWriteResponse",
      `Creates the vDC of a tenant on a provider cluster: its Proxmox pool, its own VXLAN zone unless it joins a shared EVPN zone (\`evpnZoneId\` with \`ownVxlanZone: false\`), and applies the SDN configuration. Synchronous; answers 201. ${ADMIN_NOTE}`],
    ["admin-vdc-update", "PUT", "admin/vdcs/[id]", "Update a vDC", "AdminVdcUpdateRequest", "VdcWriteResponse",
      `Changes the given fields of the vDC {id}: nodes, storages, bridges, quotas, transport, EVPN zone. A transport change re-applies the SDN configuration and re-syncs the networks the vDC stretches to other clusters. 404 when it does not exist. ${ADMIN_NOTE}`],
    ["admin-vdc-delete", "DELETE", "admin/vdcs/[id]", "Delete a vDC", null, "VdcDeleteResponse",
      `Deletes the vDC {id}: its VNets, its zone and its Proxmox pool, after unbinding its PBS storages (the PBS namespace and its backups are kept). 409 while the pool still holds guests. ${ADMIN_NOTE}`],
    ["vdc-gpu-quota-update", "PUT", "vdcs/[id]/gpu/quota", "Replace the GPU quota of a vDC", "VdcGpuQuotaUpdateRequest", "VdcGpuQuotaResponse",
      `Replaces the whole GPU contingent of the vDC {id}, per card model and vGPU profile. A line lowered under what the vDC holds is kept and flagged overCommitted: nothing is detached. Needs the GPU management feature (Enterprise). ${ADMIN_NOTE}`],
    ["evpn-zone-create", "POST", "admin/evpn-zones", "Create a shared EVPN zone", "EvpnZoneCreateRequest", "EvpnZoneWriteResponse",
      `Declares an EVPN zone on its member clusters: created, or adopted where Proxmox already runs it, with an EVPN controller chosen or created per cluster, then applies the SDN configuration on each. The VNI range is checked against every cluster. \`applyErrors\` lists the clusters where the apply failed. Answers 201. ${ADMIN_NOTE}`],
  ]),
  ...vdcWriteEntries({ connectionSegment: "id", clusterObject: true }, [
    ["storage-policy-create", "POST", "admin/connections/[id]/storage-policies", "Create a storage policy", "StoragePolicyCreateRequest", "StoragePolicyResponse",
      `Creates a storage policy on the connection {id}: a shared storage and optional IOPS and bandwidth limits the vDCs of that cluster can be given. Answers 201. ${ADMIN_NOTE}`],
    ["storage-policy-update", "PUT", "admin/connections/[id]/storage-policies/[policyId]", "Update a storage policy", "StoragePolicyUpdateRequest", "StoragePolicyResponse",
      `Replaces the storage policy {policyId} of the connection {id}; 404 when it belongs to another connection. Disks already placed are not moved. ${ADMIN_NOTE}`],
    ["storage-policy-delete", "DELETE", "admin/connections/[id]/storage-policies/[policyId]", "Delete a storage policy", null, "SuccessResponse",
      `Deletes the storage policy {policyId} of the connection {id}; 404 when it belongs to another connection. ${ADMIN_NOTE}`],
  ]),
  ...vdcWriteEntries({ segmentExclude: { id: ["collisions", "discover"] } }, [
    ["evpn-zone-update", "PUT", "admin/evpn-zones/[id]", "Update a shared EVPN zone", "EvpnZoneUpdateRequest", "EvpnZoneWriteResponse",
      `Changes the name, description or VNI range of the zone {id}. A VNI range that moves is checked against every cluster; an unchanged one is not. ${ADMIN_NOTE}`],
    ["evpn-zone-delete", "DELETE", "admin/evpn-zones/[id]", "Delete a shared EVPN zone", null, "EvpnZoneDeleteResponse",
      `Removes the zone {id} from every cluster where ProxCenter created it, then applies the SDN configuration there. ${ADMIN_NOTE}`],
    ["evpn-zone-member-add", "POST", "admin/evpn-zones/[id]/members", "Extend a shared EVPN zone to a cluster", "EvpnZoneMemberAddRequest", "EvpnZoneWriteResponse",
      `Adds the cluster \`connectionId\` to the zone {id}, with its EVPN controller, and applies the SDN configuration there. Answers 201. ${ADMIN_NOTE}`],
    ["evpn-zone-member-remove", "DELETE", "admin/evpn-zones/[id]/members", "Detach a cluster from a shared EVPN zone", null, "EvpnZoneWriteResponse",
      `Removes the cluster \`connectionId\` from the zone {id}; refused while the zone still holds networks there. ${ADMIN_NOTE}`, { queryParams: [{ name: "connectionId", description: "The member cluster to detach", required: true }] }],
  ]),
]

export const VDC_WRITE_READ_ENTRIES: AllowlistEntry[] = [
  {
    id: "vdc-gpu-quota-get",
    method: "GET",
    pattern: "/api/v1/vdcs/{id}/gpu/quota",
    requiredScopes: ["vdcs:read", "vdcs:write"],
    perimeter: "handler",
    tag: "vDCs",
    routeFile: "src/app/api/v1/vdcs/[id]/gpu/quota/route.ts",
    summary: "GPU quota of a vDC",
    description:
      "The GPU contingent of the vDC {id}, per card model and vGPU profile, with what its guests hold and what the cluster can offer (from a 60-second snapshot of the cluster). Needs admin.settings.view (scope vdcs:read or vdcs:write) and the GPU management feature (Enterprise). Provider tenant only: another tenant's token gets 404. A vDC on a connection outside the token perimeter answers 404.",
    responseSchemaRef: "VdcGpuQuotaResponse",
  },
  {
    id: "vdc-evpn-network-update",
    method: "PUT",
    pattern: "/api/v1/vdcs/{id}/evpn-networks/{networkId}",
    requiredScopes: ["network:write"],
    perimeter: "handler",
    tag: "vDCs",
    routeFile: "src/app/api/v1/vdcs/[id]/evpn-networks/[networkId]/route.ts",
    summary: "Set the vDCs carrying an EVPN network",
    description:
      "Sets the vDCs of the tenant that carry the EVPN network {networkId}: created where newly listed (SDN apply on that cluster), removed where left out. Needs sdn.vnet.edit on the vDC {id}, sdn.vnet.create on each vDC added and sdn.vnet.delete on each vDC removed (scope network:write). Every vDC must belong to the token's tenant (404 otherwise) and sit on a connection inside the token perimeter.",
    requestSchemaRef: "VdcEvpnNetworkUpdateRequest",
    responseSchemaRef: "VdcEvpnNetworkPresenceResponse",
  },
]

// ── Tenants, users and role assignments, writes (issue #1360, lot 3) ─────────
// One scope per admin right (admin.tenants, admin.users, admin.rbac), each
// needing a global grant and a token not restricted to connections. A token is
// never a super admin: roles themselves, provider operators and protected
// roles stay out of reach, and it never acts on its own creator.
const UNRESTRICTED = "A token restricted to some connections gets 403."
const TENANTS_NOTE = `Needs admin.tenants (scope tenants:write). Provider tenant only: another tenant's token gets 403. ${UNRESTRICTED}`
const USERS_WRITE_NOTE = `Needs admin.users (scope users:write). The provider tenant reaches every user, another tenant its own members; provider operators and the token's creator are out of reach. ${UNRESTRICTED}`
const RBAC_WRITE_NOTE = `Needs admin.rbac (scope rbac:write). Scoped to the token's tenant (the provider tenant may name another one). Protected roles, their holders, NIC identity rights and the token's creator are out of reach; roles themselves are not managed through the API. ${UNRESTRICTED}`

export const ACCESS_WRITE_ENTRIES: AllowlistEntry[] = [
  ...writeEntries({ requiredScopes: ["tenants:write"], tag: "Tenants" }, [
    ["tenant-create", "POST", "tenants", "Create a tenant", "TenantCreateRequest", "TenantResponse",
      `Creates a tenant, with an optional VMID range that must not overlap another tenant's (409). Answers 201; 409 when the slug is taken. ${TENANTS_NOTE}`],
    ["tenant-update", "PUT", "tenants/[id]", "Update a tenant", "TenantUpdateRequest", "TenantResponse",
      `Changes the given fields of the tenant {id}. Disabling a tenant signs its users out; the provider tenant cannot be disabled. ${TENANTS_NOTE}`],
    ["tenant-delete", "DELETE", "tenants/[id]", "Delete a tenant", null, "SuccessResponse",
      `Deletes the tenant {id} with its memberships and role assignments. 409 (TENANT_HAS_VDCS) while it still has vDCs; the provider tenant cannot be deleted. ${TENANTS_NOTE}`],
    ["tenant-user-add", "POST", "tenants/[id]/users", "Add a user to a tenant", "TenantUserAddRequest", "SuccessResponse",
      `Makes the user \`userId\` a member of the tenant {id} and, when they hold no role there yet, grants \`roleId\` (the viewer role by default) under the rules of every role assignment. ${TENANTS_NOTE}`],
    ["tenant-user-remove", "DELETE", "tenants/[id]/users", "Remove a user from a tenant", null, "SuccessResponse",
      `Removes the user \`userId\` from the tenant {id}. 409 (LAST_TENANT) when it is their only tenant, 404 when they are not a member. ${TENANTS_NOTE}`,
      { queryParams: [{ name: "userId", description: "The member to remove", required: true }] }],
  ]),
  ...writeEntries({ requiredScopes: ["users:write"], tag: "Users" }, [
    ["user-create", "POST", "users", "Create a user", "UserCreateRequest", "UserWriteResponse",
      `Creates a local account with its first password. From the provider tenant, \`tenantIds\` lists its tenants (the first is its default); otherwise the account joins the token's tenant. It holds no role until one is assigned. ${USERS_WRITE_NOTE}`],
    ["user-update", "PATCH", "users/[id]", "Update a user", "UserUpdateRequest", "UserWriteResponse",
      `Changes the name or the enabled state of the user {id}; from the provider tenant also their tenants (\`tenantIds\`) and one role applied in each of them (\`roleId\`). Disabling signs the user out. A token cannot set a password or emergency access (403). ${USERS_WRITE_NOTE}`],
    ["user-delete", "DELETE", "users/[id]", "Delete a user", null, "UserDeleteResponse",
      `From the provider tenant, deletes the account everywhere; from another tenant, removes its membership and deletes the account once it has no tenant left. \`deleteApiTokens=true\` also deletes the API tokens the user created, which otherwise keep working. ${USERS_WRITE_NOTE}`,
      { queryParams: [{ name: "deleteApiTokens", description: "true to delete the API tokens this user created", required: false }] }],
  ]),
  ...writeEntries({ requiredScopes: ["rbac:write"], tag: "RBAC" }, [
    ["rbac-assignment-create", "POST", "rbac/assignments", "Assign a role", "RbacAssignmentCreateRequest", "RbacAssignmentWriteResponse",
      `Grants the role \`role_id\` to the user \`user_id\`, who must be a member of the target tenant, on the role's default scope unless one is given. Answers 201; 400 when the same grant exists. ${RBAC_WRITE_NOTE}`],
    ["rbac-assignment-update", "PATCH", "rbac/assignments/[id]", "Update a role assignment", "RbacAssignmentUpdateRequest", "RbacAssignmentUpdateResponse",
      `Changes the role, the scope or the expiry of the assignment {id}; 404 when the token's tenant cannot see it. ${RBAC_WRITE_NOTE}`],
    ["rbac-assignment-delete", "DELETE", "rbac/assignments/[id]", "Revoke a role assignment", null, "SuccessResponse",
      `Revokes the assignment {id}; 409 (SERVICE_DESK_MANAGED) for one that follows a service desk assignment. ${RBAC_WRITE_NOTE}`],
  ]),
]
