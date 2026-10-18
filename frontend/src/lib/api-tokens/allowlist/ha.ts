// PURE data modules: imported by BOTH the proxy (D7) and
// principal.ts (D8). NO DB access, ever.
import { CONN, type AllowlistEntry } from "./types"

// ── HA domain (spec 5) ───────────────────────────────────────────────────────
const HA = `${CONN}/ha`
const HA_FILE = "connections/[id]/ha"
/** GET neighbours of the HA write routes: the read scope or the write scope. */
const HA_READ_SCOPES = ["nodes:read", "ha:write"]
/** Static siblings of ha/{sid}: Next serves them first. */
const NOT_HA_SIBLINGS = { sid: ["groups", "affinity-rules", "auto-ha"] } as const
const SID_NOTE = "{sid} is `vm:<vmid>` or `ct:<vmid>`, sent unencoded (`vm:100`): a percent-encoded `:` (`vm%3A100`) is refused with 401."
const TENANT_NOTE = "Not available to a vDC tenant token."

type HaEntry = Omit<AllowlistEntry, "tag" | "routeFile" | "connectionSegment" | "clusterObject" | "requiredScopes"> & {
  file: string
  read?: true
}

/** An HA route of a connection (a cluster object); `file` is its directory under src/app/api/v1. */
function haEntry({ file, read, ...entry }: HaEntry): AllowlistEntry {
  return {
    ...entry,
    requiredScopes: read ? HA_READ_SCOPES : ["ha:write"],
    connectionSegment: "id",
    clusterObject: true,
    tag: "HA",
    routeFile: `src/app/api/v1/${file}/route.ts`,
  }
}

export const HA_ENTRIES: AllowlistEntry[] = [
  haEntry({
    id: "ha-resource-get",
    method: "GET",
    read: true,
    file: `${HA_FILE}/[sid]`,
    pattern: `${HA}/{sid}`,
    segmentExclude: NOT_HA_SIBLINGS,
    summary: "HA configuration of a guest",
    description: `The HA resource {sid} as Proxmox stores it; \`data\` is null when the guest is not HA-managed. ${SID_NOTE}`,
    responseSchemaRef: "HaResourceResponse",
  }),
  haEntry({
    id: "ha-resource-upsert",
    method: "POST",
    file: `${HA_FILE}/[sid]`,
    pattern: `${HA}/{sid}`,
    segmentExclude: NOT_HA_SIBLINGS,
    summary: "Put a guest under HA, or update its HA configuration",
    description:
      `Creates the HA resource {sid} when the guest is not HA-managed yet, otherwise updates it with the given fields; \`message\` says which. ${SID_NOTE} Only from the provider tenant. ${TENANT_NOTE}`,
    requestSchemaRef: "HaResourceUpsertRequest",
    responseSchemaRef: "HaWriteResponse",
  }),
  haEntry({
    id: "ha-resource-delete",
    method: "DELETE",
    file: `${HA_FILE}/[sid]`,
    pattern: `${HA}/{sid}`,
    segmentExclude: NOT_HA_SIBLINGS,
    summary: "Take a guest out of HA",
    description: `Removes the HA resource {sid}; the guest itself is left as it is. ${SID_NOTE} Only from the provider tenant. ${TENANT_NOTE}`,
    responseSchemaRef: "HaWriteResponse",
  }),
  haEntry({
    id: "ha-groups-list",
    method: "GET",
    read: true,
    file: `${HA_FILE}/groups`,
    pattern: `${HA}/groups`,
    summary: "HA groups of a cluster",
    description: "The HA groups of the cluster (Proxmox VE 8; version 9 replaced them with node affinity rules).",
    responseSchemaRef: "HaListResponse",
  }),
  haEntry({
    id: "ha-group-create",
    method: "POST",
    file: `${HA_FILE}/groups`,
    pattern: `${HA}/groups`,
    summary: "Create an HA group",
    description: `Creates the HA group \`group\` over \`nodes\` (Proxmox VE 8). ${TENANT_NOTE}`,
    requestSchemaRef: "HaGroupCreateRequest",
    responseSchemaRef: "HaWriteResponse",
  }),
  haEntry({
    id: "ha-group-get",
    method: "GET",
    read: true,
    file: `${HA_FILE}/groups/[groupId]`,
    pattern: `${HA}/groups/{groupId}`,
    summary: "HA group",
    description: "The HA group {groupId}; 404 when it does not exist.",
    responseSchemaRef: "HaObjectResponse",
  }),
  haEntry({
    id: "ha-group-update",
    method: "PUT",
    file: `${HA_FILE}/groups/[groupId]`,
    pattern: `${HA}/groups/{groupId}`,
    summary: "Update an HA group",
    description: `Changes the given properties of the HA group {groupId}; \`delete\` lists the properties to clear. ${TENANT_NOTE}`,
    requestSchemaRef: "HaGroupUpdateRequest",
    responseSchemaRef: "HaWriteResponse",
  }),
  haEntry({
    id: "ha-group-delete",
    method: "DELETE",
    file: `${HA_FILE}/groups/[groupId]`,
    pattern: `${HA}/groups/{groupId}`,
    summary: "Delete an HA group",
    description: `Removes the HA group {groupId}. ${TENANT_NOTE}`,
    responseSchemaRef: "HaWriteResponse",
  }),
  haEntry({
    id: "ha-affinity-list",
    method: "GET",
    read: true,
    file: `${HA_FILE}/affinity-rules`,
    pattern: `${HA}/affinity-rules`,
    summary: "HA affinity rules of a cluster",
    description: "The HA rules of the cluster (Proxmox VE 9 and later). On an older cluster `data` is empty and `unsupported` is true.",
    responseSchemaRef: "HaAffinityRulesResponse",
  }),
  haEntry({
    id: "ha-affinity-create",
    method: "POST",
    file: `${HA_FILE}/affinity-rules`,
    pattern: `${HA}/affinity-rules`,
    summary: "Create an HA affinity rule",
    description:
      `Creates the HA rule \`rule\`: a node-affinity rule keeps \`resources\` on \`nodes\`, a resource-affinity rule keeps them together (positive) or apart (negative). Proxmox VE 9 and later. ${TENANT_NOTE}`,
    requestSchemaRef: "HaAffinityCreateRequest",
    responseSchemaRef: "HaWriteResponse",
  }),
  haEntry({
    id: "ha-affinity-get",
    method: "GET",
    read: true,
    file: `${HA_FILE}/affinity-rules/[ruleId]`,
    pattern: `${HA}/affinity-rules/{ruleId}`,
    summary: "HA affinity rule",
    description: "The HA rule {ruleId}; 404 when it does not exist.",
    responseSchemaRef: "HaObjectResponse",
  }),
  haEntry({
    id: "ha-affinity-update",
    method: "PUT",
    file: `${HA_FILE}/affinity-rules/[ruleId]`,
    pattern: `${HA}/affinity-rules/{ruleId}`,
    summary: "Update an HA affinity rule",
    description:
      `Changes the given properties of the HA rule {ruleId}; \`type\` defaults to the rule's current type, \`delete\` lists the properties to clear, \`digest\` guards against a concurrent change. ${TENANT_NOTE}`,
    requestSchemaRef: "HaAffinityUpdateRequest",
    responseSchemaRef: "HaWriteResponse",
  }),
  haEntry({
    id: "ha-affinity-delete",
    method: "DELETE",
    file: `${HA_FILE}/affinity-rules/[ruleId]`,
    pattern: `${HA}/affinity-rules/{ruleId}`,
    summary: "Delete an HA affinity rule",
    description: `Removes the HA rule {ruleId}. ${TENANT_NOTE}`,
    responseSchemaRef: "HaWriteResponse",
  }),
  haEntry({
    id: "ha-auto-get",
    method: "GET",
    read: true,
    file: `${HA_FILE}/auto-ha`,
    pattern: `${HA}/auto-ha`,
    summary: "Auto-HA settings of a cluster",
    description:
      "The ProxCenter Auto-HA settings of the cluster: when enabled, every new guest is put under HA with these defaults.",
    responseSchemaRef: "AutoHaSettingsResponse",
  }),
  haEntry({
    id: "ha-auto-update",
    method: "PUT",
    file: `${HA_FILE}/auto-ha`,
    pattern: `${HA}/auto-ha`,
    summary: "Update the Auto-HA settings of a cluster",
    description:
      `Changes the given Auto-HA settings; absent or invalid fields keep their value, \`max_restart\` and \`max_relocate\` are clamped to 0-10. Needs node.manage on this connection. ${TENANT_NOTE}`,
    requestSchemaRef: "HaAutoUpdateRequest",
    responseSchemaRef: "AutoHaSettingsResponse",
  }),
  haEntry({
    id: "ha-auto-sync",
    method: "POST",
    file: `${HA_FILE}/auto-ha/sync`,
    pattern: `${HA}/auto-ha/sync`,
    summary: "Apply Auto-HA to the existing guests now",
    description:
      `Puts every guest of the cluster that is not HA-managed yet (templates excepted) under HA with the Auto-HA defaults. 400 when Auto-HA is disabled. No body. Needs node.manage on this connection. ${TENANT_NOTE}`,
    responseSchemaRef: "AutoHaSyncResponse",
  }),
]
