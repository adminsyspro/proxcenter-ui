// PURE data modules: imported by BOTH the proxy (D7) and
// principal.ts (D8). NO DB access, ever.
import { CONN, type AllowlistEntry } from "./types"

// ── Network domain (spec 5) ──────────────────────────────────────────────────
const NODE_NETWORK = `${CONN}/nodes/{node}/network`
const NODE_NETWORK_FILE = "connections/[id]/nodes/[node]/network"
const VNETS = "/api/v1/vdcs/{id}/vnets"
const VNETS_FILE = "vdcs/[id]/vnets"
/** GET neighbours of the network write routes: the read scope or the write scope. */
const NETWORK_READ_SCOPES = ["nodes:read", "network:write"]
const PENDING_NOTE = "The change is staged in Proxmox's pending network configuration until it is applied (PUT .../network)."
const TENANT_NOTE = "Not available to a vDC tenant token."
const VDC_NOTE =
  "The vDC must belong to the token's tenant (404 otherwise, as for a session of another tenant) and sit on a connection inside the token perimeter."

type NetworkEntry = Omit<AllowlistEntry, "tag" | "routeFile" | "requiredScopes"> & { file: string; read?: true }

/** A network route; `file` is its directory under src/app/api/v1. */
function networkEntry({ file, read, ...entry }: NetworkEntry): AllowlistEntry {
  return {
    ...entry,
    requiredScopes: read ? NETWORK_READ_SCOPES : ["network:write"],
    tag: "Network",
    routeFile: `src/app/api/v1/${file}/route.ts`,
  }
}

/** A node network route of a connection (a cluster object). */
function nodeNetworkEntry(entry: NetworkEntry): AllowlistEntry {
  return networkEntry({ ...entry, connectionSegment: "id", clusterObject: true })
}

/** A VNet route of a vDC: the handler resolves the vDC connection itself. */
function vnetEntry(entry: NetworkEntry): AllowlistEntry {
  return networkEntry({ ...entry, perimeter: "handler" })
}

export const NETWORK_ENTRIES: AllowlistEntry[] = [
  nodeNetworkEntry({
    id: "node-network-list",
    method: "GET",
    read: true,
    file: NODE_NETWORK_FILE,
    pattern: NODE_NETWORK,
    summary: "Network interfaces of a node",
    description: "The network interfaces of the node as Proxmox lists them. Needs node.network on the node (scope network:write).",
    responseSchemaRef: "NodeNetworkListResponse",
  }),
  nodeNetworkEntry({
    id: "node-network-create",
    method: "POST",
    file: NODE_NETWORK_FILE,
    pattern: NODE_NETWORK,
    summary: "Create a network interface on a node",
    description: `Creates the interface \`iface\` of type \`type\` (bridge, bond, vlan, OVS objects); empty fields are not sent. ${PENDING_NOTE} ${TENANT_NOTE}`,
    requestSchemaRef: "NodeNetworkCreateRequest",
    responseSchemaRef: "SuccessResponse",
  }),
  nodeNetworkEntry({
    id: "node-network-apply",
    method: "PUT",
    file: NODE_NETWORK_FILE,
    pattern: NODE_NETWORK,
    summary: "Apply the pending network configuration of a node",
    description:
      `Reloads the node network with its pending configuration (ifreload). Answers \`success\` once Proxmox accepted the reload; the Proxmox task it starts is not returned. No body. ${TENANT_NOTE}`,
    responseSchemaRef: "SuccessResponse",
  }),
  nodeNetworkEntry({
    id: "node-network-revert",
    method: "DELETE",
    file: NODE_NETWORK_FILE,
    pattern: NODE_NETWORK,
    summary: "Revert the pending network changes of a node",
    description: `Drops every pending network change of the node; the running configuration is left as it is. ${TENANT_NOTE}`,
    responseSchemaRef: "SuccessResponse",
  }),
  nodeNetworkEntry({
    id: "node-iface-get",
    method: "GET",
    read: true,
    file: `${NODE_NETWORK_FILE}/[iface]`,
    pattern: `${NODE_NETWORK}/{iface}`,
    summary: "Network interface of a node",
    description: "The interface {iface} as Proxmox returns it. Needs node.network on the node (scope network:write).",
    responseSchemaRef: "NodeIfaceResponse",
  }),
  nodeNetworkEntry({
    id: "node-iface-update",
    method: "PUT",
    file: `${NODE_NETWORK_FILE}/[iface]`,
    pattern: `${NODE_NETWORK}/{iface}`,
    summary: "Update a network interface of a node",
    description:
      `Changes the interface {iface}; \`type\` is required and selects the type-specific fields sent. An \`address\` in CIDR notation is sent as \`cidr\` (same for \`address6\`). ${PENDING_NOTE} ${TENANT_NOTE}`,
    requestSchemaRef: "NodeIfaceUpdateRequest",
    responseSchemaRef: "SuccessResponse",
  }),
  nodeNetworkEntry({
    id: "node-iface-delete",
    method: "DELETE",
    file: `${NODE_NETWORK_FILE}/[iface]`,
    pattern: `${NODE_NETWORK}/{iface}`,
    summary: "Delete a network interface of a node",
    description: `Removes the interface {iface}. ${PENDING_NOTE} ${TENANT_NOTE}`,
    responseSchemaRef: "SuccessResponse",
  }),
  networkEntry({
    id: "sdn-apply",
    method: "POST",
    file: "connections/[id]/sdn/apply",
    pattern: `${CONN}/sdn/apply`,
    connectionSegment: "id",
    clusterObject: true,
    summary: "Apply the pending SDN configuration of a cluster",
    description: `Applies the pending SDN zones, VNets and subnets on every node of the cluster. \`data.upid\` is the Proxmox task UPID. No body. ${TENANT_NOTE}`,
    responseSchemaRef: "SdnApplyResponse",
  }),
  vnetEntry({
    id: "vdc-vnets-list",
    method: "GET",
    read: true,
    file: VNETS_FILE,
    pattern: VNETS,
    summary: "Networks of a vDC",
    description: `The VNets of the vDC with their subnet and IPAM usage. Needs sdn.vnet.view (scope network:write). ${VDC_NOTE}`,
    responseSchemaRef: "VdcVnetsResponse",
  }),
  vnetEntry({
    id: "vdc-vnet-create",
    method: "POST",
    file: VNETS_FILE,
    pattern: VNETS,
    summary: "Create a network in a vDC",
    description:
      `Creates a VXLAN (default) or VLAN network named \`displayName\`, with a subnet or none (pure L2), and applies the SDN configuration. The vDC quota and VNI or VLAN policy apply. Answers 201. ${VDC_NOTE}`,
    requestSchemaRef: "VdcVnetCreateRequest",
    responseSchemaRef: "VdcVnetResponse",
  }),
  vnetEntry({
    id: "vdc-vnet-get",
    method: "GET",
    read: true,
    file: `${VNETS_FILE}/[pveName]`,
    pattern: `${VNETS}/{pveName}`,
    summary: "Network of a vDC",
    description: `The VNet whose display name is {pveName}; 404 when the vDC has none. Needs sdn.vnet.view (scope network:write). ${VDC_NOTE}`,
    responseSchemaRef: "VdcVnetResponse",
  }),
  vnetEntry({
    id: "vdc-vnet-update",
    method: "PUT",
    file: `${VNETS_FILE}/[pveName]`,
    pattern: `${VNETS}/{pveName}`,
    summary: "Update a network of a vDC",
    description:
      `Changes the description, the firewall flag or the DNS servers of the VNet {pveName} (its display name). A VNet of a stretched tenant network is the provider's: 403. ${VDC_NOTE}`,
    requestSchemaRef: "VdcVnetUpdateRequest",
    responseSchemaRef: "VdcVnetResponse",
  }),
  vnetEntry({
    id: "vdc-vnet-delete",
    method: "DELETE",
    file: `${VNETS_FILE}/[pveName]`,
    pattern: `${VNETS}/{pveName}`,
    summary: "Delete a network of a vDC",
    description:
      `Deletes the VNet {pveName} (its display name) and applies the SDN configuration. 409 while guest NICs still use it (\`attachmentCount\`); a VNet of a stretched tenant network is the provider's: 403. ${VDC_NOTE}`,
    responseSchemaRef: "SuccessResponse",
  }),
]
