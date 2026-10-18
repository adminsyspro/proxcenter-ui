// PURE data modules: imported by BOTH the proxy (D7) and
// principal.ts (D8). NO DB access, ever.
import type { AllowlistEntry, AllowlistQueryParam, GuestScopeSpec } from "./types"

// ── Firewall domain (spec 5) ─────────────────────────────────────────────────
const FW = "/api/v1/firewall"
const VM = `${FW}/vms/{connectionId}/{node}/{vmType}/{vmid}`
const VM_FILE = "firewall/vms/[connectionId]/[node]/[vmType]/[vmid]"
const NODE = `${FW}/nodes/{connectionId}/{node}`
const NODE_FILE = "firewall/nodes/[connectionId]/[node]"
const GUEST_SCOPE: GuestScopeSpec = { connection: "connectionId", node: "node", type: "vmType", vmid: "vmid" }
/** GET neighbours of the firewall write routes: the read scope or the write scope. */
const FIREWALL_READ_SCOPES = ["nodes:read", "firewall:write"]
const READ_NOTE = "Needs node.view on the connection (scope nodes:read or firewall:write)."
const WRITE_NOTE = "Needs node.manage on the connection."
const TENANT_NOTE = "Not available to a vDC tenant token."
const GUEST_NOTE = "A vDC tenant token reaches the guests of its own vDC pools only."
const ORCHESTRATOR_NOTE = "Runs on the orchestrator only (no direct Proxmox fallback)."
const MOVE_NOTE = "`moveto` moves the rule to that position; an empty optional field clears it."
const TYPE_QUERY: AllowlistQueryParam[] = [
  { name: "type", description: "`options` (default) or `rules`" },
]

type FirewallEntry = Omit<AllowlistEntry, "tag" | "routeFile" | "requiredScopes" | "connectionSegment"> & {
  file: string
  read?: true
}

/** A firewall route; `file` is its directory under src/app/api/v1. */
function firewallEntry({ file, read, ...entry }: FirewallEntry): AllowlistEntry {
  return {
    ...entry,
    requiredScopes: read ? FIREWALL_READ_SCOPES : ["firewall:write"],
    connectionSegment: "connectionId",
    tag: "Firewall",
    routeFile: `src/app/api/v1/${file}/route.ts`,
  }
}

/** A cluster-, node-, group-, IP set- or alias-level route (a cluster object). */
function clusterFwEntry(entry: FirewallEntry): AllowlistEntry {
  return firewallEntry({ ...entry, clusterObject: true, description: `${entry.description} ${TENANT_NOTE}` })
}

/** A route of one guest firewall, confined to the vDC guests. */
function guestFwEntry(entry: FirewallEntry): AllowlistEntry {
  return firewallEntry({ ...entry, guestScope: GUEST_SCOPE })
}

export const FIREWALL_ENTRIES: AllowlistEntry[] = [
  // Aliases
  clusterFwEntry({
    id: "fw-aliases-list",
    method: "GET",
    read: true,
    file: "firewall/aliases/[connectionId]",
    pattern: `${FW}/aliases/{connectionId}`,
    summary: "Firewall aliases of a cluster",
    description: `The cluster firewall aliases (name, CIDR, comment). ${READ_NOTE}`,
    responseSchemaRef: "FirewallAliasesResponse",
  }),
  clusterFwEntry({
    id: "fw-alias-create",
    method: "POST",
    file: "firewall/aliases/[connectionId]",
    pattern: `${FW}/aliases/{connectionId}`,
    summary: "Create a firewall alias",
    description: `Creates the cluster alias \`name\` for \`cidr\`. Answers 201. ${WRITE_NOTE}`,
    requestSchemaRef: "FirewallAliasCreateRequest",
    responseSchemaRef: "FirewallStatusResponse",
  }),
  clusterFwEntry({
    id: "fw-alias-update",
    method: "PUT",
    file: "firewall/aliases/[connectionId]/[name]",
    pattern: `${FW}/aliases/{connectionId}/{name}`,
    summary: "Update a firewall alias",
    description: `Changes the CIDR and comment of the cluster alias {name}. ${WRITE_NOTE}`,
    requestSchemaRef: "FirewallAliasUpdateRequest",
    responseSchemaRef: "FirewallStatusResponse",
  }),
  clusterFwEntry({
    id: "fw-alias-delete",
    method: "DELETE",
    file: "firewall/aliases/[connectionId]/[name]",
    pattern: `${FW}/aliases/{connectionId}/{name}`,
    summary: "Delete a firewall alias",
    description: `Removes the cluster alias {name}. ${WRITE_NOTE}`,
    responseSchemaRef: "SuccessResponse",
  }),

  // Cluster options and rules
  clusterFwEntry({
    id: "fw-cluster-get",
    method: "GET",
    read: true,
    file: "firewall/cluster/[connectionId]",
    pattern: `${FW}/cluster/{connectionId}`,
    queryParams: TYPE_QUERY,
    summary: "Cluster firewall options or rules",
    description: `The cluster firewall options, or its rules with \`type=rules\`. ${READ_NOTE}`,
    responseSchemaRef: "FirewallOptionsOrRulesResponse",
  }),
  clusterFwEntry({
    id: "fw-cluster-options-update",
    method: "PUT",
    file: "firewall/cluster/[connectionId]",
    pattern: `${FW}/cluster/{connectionId}`,
    summary: "Update the cluster firewall options",
    description: `Changes the cluster firewall options; absent fields keep their value. ${WRITE_NOTE}`,
    requestSchemaRef: "FirewallOptionsUpdateRequest",
    responseSchemaRef: "FirewallStatusResponse",
  }),
  clusterFwEntry({
    id: "fw-cluster-rule-add",
    method: "POST",
    file: "firewall/cluster/[connectionId]",
    pattern: `${FW}/cluster/{connectionId}`,
    summary: "Add a cluster firewall rule",
    description: `Same as POST .../cluster/{connectionId}/rules. Answers 201. ${WRITE_NOTE}`,
    requestSchemaRef: "FirewallRuleCreateRequest",
    responseSchemaRef: "FirewallStatusResponse",
  }),
  clusterFwEntry({
    id: "fw-cluster-rule-create",
    method: "POST",
    file: "firewall/cluster/[connectionId]/rules",
    pattern: `${FW}/cluster/{connectionId}/rules`,
    summary: "Create a cluster firewall rule",
    description: `Adds a rule to the cluster firewall, at position \`pos\` when given. Answers 201. ${WRITE_NOTE}`,
    requestSchemaRef: "FirewallRuleCreateRequest",
    responseSchemaRef: "FirewallStatusResponse",
  }),
  clusterFwEntry({
    id: "fw-cluster-rule-update",
    method: "PUT",
    file: "firewall/cluster/[connectionId]/rules/[pos]",
    pattern: `${FW}/cluster/{connectionId}/rules/{pos}`,
    summary: "Update or move a cluster firewall rule",
    description: `Changes the cluster rule at position {pos}. ${MOVE_NOTE} ${WRITE_NOTE}`,
    requestSchemaRef: "FirewallRuleUpdateRequest",
    responseSchemaRef: "FirewallStatusResponse",
  }),
  clusterFwEntry({
    id: "fw-cluster-rule-delete",
    method: "DELETE",
    file: "firewall/cluster/[connectionId]/rules/[pos]",
    pattern: `${FW}/cluster/{connectionId}/rules/{pos}`,
    summary: "Delete a cluster firewall rule",
    description: `Removes the cluster rule at position {pos}. ${WRITE_NOTE}`,
    responseSchemaRef: "FirewallStatusResponse",
  }),

  // Security groups
  clusterFwEntry({
    id: "fw-groups-list",
    method: "GET",
    read: true,
    file: "firewall/groups/[connectionId]",
    pattern: `${FW}/groups/{connectionId}`,
    summary: "Firewall security groups of a cluster",
    description: `The cluster security groups with their rules. ${READ_NOTE}`,
    responseSchemaRef: "FirewallGroupsResponse",
  }),
  clusterFwEntry({
    id: "fw-group-create",
    method: "POST",
    file: "firewall/groups/[connectionId]",
    pattern: `${FW}/groups/{connectionId}`,
    summary: "Create a firewall security group",
    description: `Creates the cluster security group \`group\`. Answers 201. ${WRITE_NOTE}`,
    requestSchemaRef: "FirewallGroupCreateRequest",
    responseSchemaRef: "FirewallStatusResponse",
  }),
  clusterFwEntry({
    id: "fw-group-delete",
    method: "DELETE",
    file: "firewall/groups/[connectionId]/[groupName]",
    pattern: `${FW}/groups/{connectionId}/{groupName}`,
    summary: "Delete a firewall security group",
    description: `Removes the security group {groupName}. ${WRITE_NOTE}`,
    responseSchemaRef: "SuccessResponse",
  }),
  clusterFwEntry({
    id: "fw-group-rule-create",
    method: "POST",
    file: "firewall/groups/[connectionId]/[groupName]/rules",
    pattern: `${FW}/groups/{connectionId}/{groupName}/rules`,
    summary: "Create a security group rule",
    description: `Adds a rule to the security group {groupName}, at position \`pos\` when given. Answers 201. ${WRITE_NOTE}`,
    requestSchemaRef: "FirewallRuleCreateRequest",
    responseSchemaRef: "FirewallStatusResponse",
  }),
  clusterFwEntry({
    id: "fw-group-rule-update",
    method: "PUT",
    file: "firewall/groups/[connectionId]/[groupName]/rules/[pos]",
    pattern: `${FW}/groups/{connectionId}/{groupName}/rules/{pos}`,
    summary: "Update or move a security group rule",
    description: `Changes the rule at position {pos} of the security group {groupName}. ${MOVE_NOTE} ${WRITE_NOTE}`,
    requestSchemaRef: "FirewallRuleUpdateRequest",
    responseSchemaRef: "SuccessResponse",
  }),
  clusterFwEntry({
    id: "fw-group-rule-delete",
    method: "DELETE",
    file: "firewall/groups/[connectionId]/[groupName]/rules/[pos]",
    pattern: `${FW}/groups/{connectionId}/{groupName}/rules/{pos}`,
    summary: "Delete a security group rule",
    description: `Removes the rule at position {pos} of the security group {groupName}. ${WRITE_NOTE}`,
    responseSchemaRef: "SuccessResponse",
  }),

  // IP sets
  clusterFwEntry({
    id: "fw-ipsets-list",
    method: "GET",
    read: true,
    file: "firewall/ipsets/[connectionId]",
    pattern: `${FW}/ipsets/{connectionId}`,
    summary: "Firewall IP sets of a cluster",
    description: `The cluster IP sets with their entries. ${READ_NOTE}`,
    responseSchemaRef: "FirewallIpsetsResponse",
  }),
  clusterFwEntry({
    id: "fw-ipset-create",
    method: "POST",
    file: "firewall/ipsets/[connectionId]",
    pattern: `${FW}/ipsets/{connectionId}`,
    summary: "Create a firewall IP set",
    description: `Creates the cluster IP set \`name\`, empty. Answers 201. ${WRITE_NOTE}`,
    requestSchemaRef: "FirewallIpsetCreateRequest",
    responseSchemaRef: "FirewallStatusResponse",
  }),
  clusterFwEntry({
    id: "fw-ipset-delete",
    method: "DELETE",
    file: "firewall/ipsets/[connectionId]/[ipsetName]",
    pattern: `${FW}/ipsets/{connectionId}/{ipsetName}`,
    summary: "Delete a firewall IP set",
    description: `Removes the IP set {ipsetName}. ${WRITE_NOTE}`,
    responseSchemaRef: "SuccessResponse",
  }),
  clusterFwEntry({
    id: "fw-ipset-entry-create",
    method: "POST",
    file: "firewall/ipsets/[connectionId]/[ipsetName]/entries",
    pattern: `${FW}/ipsets/{connectionId}/{ipsetName}/entries`,
    summary: "Add an IP set entry",
    description: `Adds \`cidr\` to the IP set {ipsetName}. Answers 201. ${WRITE_NOTE}`,
    requestSchemaRef: "FirewallIpsetEntryCreateRequest",
    responseSchemaRef: "FirewallStatusResponse",
  }),
  clusterFwEntry({
    id: "fw-ipset-entry-delete",
    method: "DELETE",
    file: "firewall/ipsets/[connectionId]/[ipsetName]/entries/[cidr]",
    pattern: `${FW}/ipsets/{connectionId}/{ipsetName}/entries/{cidr}`,
    encodedSlashSegment: "cidr",
    summary: "Remove an IP set entry",
    description:
      `Removes the entry {cidr} from the IP set {ipsetName}. {cidr} is URL-encoded, its slash included (10.0.0.0%2F24). ${WRITE_NOTE}`,
    responseSchemaRef: "SuccessResponse",
  }),

  // Node options and rules
  clusterFwEntry({
    id: "fw-node-get",
    method: "GET",
    read: true,
    file: NODE_FILE,
    pattern: NODE,
    queryParams: TYPE_QUERY,
    summary: "Node firewall options or rules",
    description: `The firewall options of the node, or its rules with \`type=rules\`. ${READ_NOTE}`,
    responseSchemaRef: "FirewallOptionsOrRulesResponse",
  }),
  clusterFwEntry({
    id: "fw-node-options-update",
    method: "PUT",
    file: NODE_FILE,
    pattern: NODE,
    summary: "Update the node firewall options",
    description: `Changes the firewall options of the node; absent fields keep their value. ${WRITE_NOTE}`,
    requestSchemaRef: "FirewallOptionsUpdateRequest",
    responseSchemaRef: "FirewallStatusResponse",
  }),
  clusterFwEntry({
    id: "fw-node-rule-add",
    method: "POST",
    file: NODE_FILE,
    pattern: NODE,
    summary: "Add a node firewall rule",
    description: `Same as POST .../nodes/{connectionId}/{node}/rules. Answers 201. ${WRITE_NOTE}`,
    requestSchemaRef: "FirewallRuleCreateRequest",
    responseSchemaRef: "FirewallStatusResponse",
  }),
  clusterFwEntry({
    id: "fw-node-rule-create",
    method: "POST",
    file: `${NODE_FILE}/rules`,
    pattern: `${NODE}/rules`,
    summary: "Create a node firewall rule",
    description: `Adds a rule to the firewall of the node, at position \`pos\` when given. Answers 201. ${WRITE_NOTE}`,
    requestSchemaRef: "FirewallRuleCreateRequest",
    responseSchemaRef: "FirewallStatusResponse",
  }),
  clusterFwEntry({
    id: "fw-node-rule-update",
    method: "PUT",
    file: `${NODE_FILE}/rules/[pos]`,
    pattern: `${NODE}/rules/{pos}`,
    summary: "Update or move a node firewall rule",
    description: `Changes the node rule at position {pos}. ${MOVE_NOTE} ${WRITE_NOTE}`,
    requestSchemaRef: "FirewallRuleUpdateRequest",
    responseSchemaRef: "FirewallStatusResponse",
  }),
  clusterFwEntry({
    id: "fw-node-rule-delete",
    method: "DELETE",
    file: `${NODE_FILE}/rules/[pos]`,
    pattern: `${NODE}/rules/{pos}`,
    summary: "Delete a node firewall rule",
    description: `Removes the node rule at position {pos}. ${WRITE_NOTE}`,
    responseSchemaRef: "FirewallStatusResponse",
  }),

  // Micro-segmentation
  clusterFwEntry({
    id: "fw-microseg-base-generate",
    method: "POST",
    file: "firewall/microseg/[connectionId]/generate-base",
    pattern: `${FW}/microseg/{connectionId}/generate-base`,
    summary: "Generate the base micro-segmentation security groups",
    description:
      `Creates one base security group (sg-base-*) per network alias (net-*), and with \`create_gateways\` the missing gateway aliases (gw-*). \`dry_run\` only returns the plan. ${ORCHESTRATOR_NOTE} ${WRITE_NOTE}`,
    requestSchemaRef: "FirewallMicrosegBaseGenerateRequest",
    responseSchemaRef: "FirewallMicrosegBaseGenerateResponse",
  }),
  guestFwEntry({
    id: "fw-vm-isolate",
    method: "POST",
    file: "firewall/microseg/[connectionId]/vm/[node]/[vmType]/[vmid]/isolate",
    pattern: `${FW}/microseg/{connectionId}/vm/{node}/{vmType}/{vmid}/isolate`,
    summary: "Isolate a guest",
    description:
      `Applies micro-segmentation to the guest: enables its firewall, sets DROP policies, applies the base security groups of its networks (creating a missing one) and \`additional_sgs\`, and enables the firewall on its NICs, as the flags ask. {vmType} is qemu or lxc. ${ORCHESTRATOR_NOTE} ${WRITE_NOTE} ${GUEST_NOTE} \`apply_base_sgs\` is refused to a vDC tenant token (it may create cluster-level groups and aliases): 403.`,
    requestSchemaRef: "FirewallVmIsolateRequest",
    responseSchemaRef: "FirewallVmIsolateResponse",
  }),

  // Guest firewall
  guestFwEntry({
    id: "fw-vm-get",
    method: "GET",
    read: true,
    file: VM_FILE,
    pattern: VM,
    queryParams: TYPE_QUERY,
    summary: "Guest firewall options or rules",
    description: `The firewall options of the guest, or its rules with \`type=rules\`. {vmType} is qemu or lxc. ${READ_NOTE} ${GUEST_NOTE}`,
    responseSchemaRef: "FirewallOptionsOrRulesResponse",
  }),
  guestFwEntry({
    id: "fw-vm-rule-create",
    method: "POST",
    file: VM_FILE,
    pattern: VM,
    summary: "Create a guest firewall rule",
    description: `Adds a rule to the firewall of the guest, at position \`pos\` when given. Answers 201. ${WRITE_NOTE} ${GUEST_NOTE}`,
    requestSchemaRef: "FirewallRuleCreateRequest",
    responseSchemaRef: "FirewallStatusResponse",
  }),
  guestFwEntry({
    id: "fw-vm-options-update",
    method: "PUT",
    file: VM_FILE,
    pattern: VM,
    summary: "Update the guest firewall options",
    description: `Changes the firewall options of the guest; absent fields keep their value. ${WRITE_NOTE} ${GUEST_NOTE}`,
    requestSchemaRef: "FirewallOptionsUpdateRequest",
    responseSchemaRef: "FirewallStatusResponse",
  }),
  guestFwEntry({
    id: "fw-vm-rule-update",
    method: "PUT",
    file: `${VM_FILE}/rules/[pos]`,
    pattern: `${VM}/rules/{pos}`,
    summary: "Update or move a guest firewall rule",
    description: `Changes the guest rule at position {pos}. ${MOVE_NOTE} ${WRITE_NOTE} ${GUEST_NOTE}`,
    requestSchemaRef: "FirewallRuleUpdateRequest",
    responseSchemaRef: "FirewallStatusResponse",
  }),
  guestFwEntry({
    id: "fw-vm-rule-delete",
    method: "DELETE",
    file: `${VM_FILE}/rules/[pos]`,
    pattern: `${VM}/rules/{pos}`,
    summary: "Delete a guest firewall rule",
    description: `Removes the guest rule at position {pos}. ${WRITE_NOTE} ${GUEST_NOTE}`,
    responseSchemaRef: "FirewallStatusResponse",
  }),
  guestFwEntry({
    id: "fw-vm-nic-firewall-update",
    method: "PUT",
    file: `${VM_FILE}/nic-firewall`,
    pattern: `${VM}/nic-firewall`,
    summary: "Toggle the firewall on every NIC of a guest",
    description:
      `Rewrites \`firewall=1\` (or 0) on every network interface of the guest configuration, the second level of the guest firewall. ${WRITE_NOTE} ${GUEST_NOTE}`,
    requestSchemaRef: "FirewallVmNicFirewallUpdateRequest",
    responseSchemaRef: "FirewallStatusResponse",
  }),
]
