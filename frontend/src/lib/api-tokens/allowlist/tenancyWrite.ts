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

/** vdcs:write entries sharing `extra`; the pattern follows the file (`[id]` becomes `{id}`). */
function vdcWriteEntries(extra: Partial<AllowlistEntry>, rows: WriteRow[]): AllowlistEntry[] {
  return rows.map(([id, method, file, summary, requestSchemaRef, responseSchemaRef, description, own]) => ({
    id,
    method,
    pattern: `/api/v1/${file.replaceAll(/\[(\w+)\]/g, "{$1}")}`,
    requiredScopes: ["vdcs:write"],
    perimeter: "fleet",
    tag: "vDCs",
    routeFile: `src/app/api/v1/${file}/route.ts`,
    summary,
    description,
    ...(requestSchemaRef ? { requestSchemaRef } : {}),
    responseSchemaRef,
    ...extra,
    ...own,
  }))
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
