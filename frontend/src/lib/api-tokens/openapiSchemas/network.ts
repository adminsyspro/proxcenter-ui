// Request and response schemas of the network entries.
import { STRINGS, UPID } from "./shared"

const PVE_OBJECT = { type: "object", description: "As Proxmox returns it", additionalProperties: true }
const BOOL_01 = { type: "boolean", description: "Sent to Proxmox as 0 or 1" }
const DNS_SERVERS = {
  oneOf: [STRINGS, { type: "string", description: "Comma-separated" }],
  description: "DNS servers, as an array or a comma-separated string",
}

/** Address fields every interface type accepts. */
const IFACE_ADDRESSING = {
  address: { type: "string", description: "IPv4 address; with a /prefix it is sent as cidr" },
  netmask: { type: "string" },
  gateway: { type: "string" },
  address6: { type: "string", description: "IPv6 address; with a /prefix it is sent as cidr6" },
  netmask6: { type: "string" },
  gateway6: { type: "string" },
  cidr: { type: "string" },
  cidr6: { type: "string" },
  mtu: { type: "integer" },
  comments: { type: "string" },
}
/** Type-specific fields, all named as Proxmox names them. */
const OVS_FIELDS = {
  ovs_bridge: { type: "string" },
  ovs_options: { type: "string" },
  ovs_tag: { type: "integer" },
  ovs_bonds: { type: "string" },
  ovs_ports: { type: "string" },
}
const IFACE_TYPE = {
  type: "string",
  enum: ["bridge", "bond", "eth", "alias", "vlan", "OVSBridge", "OVSBond", "OVSPort", "OVSIntPort"],
}

const VDC_SUBNET = {
  type: ["object", "null"],
  description: "Null for a pure L2 network",
  properties: {
    id: { type: "string" },
    vnetId: { type: ["string", "null"] },
    cidr: { type: "string" },
    gateway: { type: "string" },
    dnsServers: STRINGS,
    ipamEnabled: { type: "boolean" },
    createdAt: { type: "string", format: "date-time" },
  },
}
const VDC_VNET_PROPERTIES = {
  id: { type: "string" },
  vdcId: { type: "string" },
  pveName: { type: "string", description: "Name of the VNet in Proxmox, generated" },
  displayName: { type: "string", description: "Name shown to the tenant, unique in the vDC; the {pveName} path segment" },
  description: { type: ["string", "null"] },
  tag: { type: "integer", description: "VNI (VXLAN) or VLAN tag" },
  type: { type: "string", enum: ["vxlan", "vlan"] },
  bridge: { type: ["string", "null"] },
  zoneName: { type: ["string", "null"] },
  firewall: { type: "boolean" },
  subnet: VDC_SUBNET,
  tenantNetwork: {
    type: ["object", "null"],
    description: "The stretched tenant network that created this VNet; the provider manages it",
    properties: { id: { type: "string" }, name: { type: "string" } },
  },
  createdBy: { type: ["string", "null"], description: "User who created it; null when an API token did" },
  createdAt: { type: "string", format: "date-time" },
}
const VDC_VNET = { type: "object", properties: VDC_VNET_PROPERTIES }

export const NETWORK_REQUEST_SCHEMAS: Record<string, Record<string, unknown>> = {
  NodeNetworkCreateRequest: {
    type: "object",
    required: ["iface", "type"],
    description: "Absent or empty fields are not sent to Proxmox.",
    properties: {
      iface: { type: "string" },
      type: IFACE_TYPE,
      ...IFACE_ADDRESSING,
      autostart: { type: "boolean" },
      bridge_ports: { type: "string" },
      bridge_stp: { type: "string" },
      bridge_fd: { type: "integer" },
      bridge_vlan_aware: { type: "boolean" },
      bond_mode: { type: "string" },
      bond_primary: { type: "string" },
      "bond-xmit-hash-policy": { type: "string" },
      slaves: { type: "string" },
      "vlan-id": { type: "integer" },
      "vlan-raw-device": { type: "string" },
      ...OVS_FIELDS,
    },
  },
  NodeIfaceUpdateRequest: {
    type: "object",
    required: ["type"],
    description:
      "Absent or empty fields are not sent to Proxmox. Only the fields of `type` are sent: bridge_* for a bridge, bond_* and slaves for a bond, vlan-* for a VLAN, ovs_* for an OVS object.",
    properties: {
      type: IFACE_TYPE,
      ...IFACE_ADDRESSING,
      autostart: BOOL_01,
      bridge_ports: { type: "string" },
      bridge_vlan_aware: BOOL_01,
      bond_mode: { type: "string" },
      "bond-primary": { type: "string" },
      bond_xmit_hash_policy: { type: "string" },
      slaves: { type: "string" },
      "vlan-id": { type: "integer" },
      "vlan-raw-device": { type: "string" },
      ...OVS_FIELDS,
    },
  },
  VdcVnetCreateRequest: {
    type: "object",
    required: ["displayName"],
    properties: {
      displayName: { type: "string", description: "1-20 chars, lowercase letters, digits and dashes, starting with a letter" },
      description: { type: "string" },
      firewall: { type: "boolean", description: "Default true" },
      subnet: {
        type: ["object", "null"],
        description: "Absent or null: a pure L2 network (not allowed when the platform provides the edge)",
        required: ["cidr", "gateway"],
        properties: { cidr: { type: "string" }, gateway: { type: "string" }, dnsServers: DNS_SERVERS },
      },
      type: { type: "string", enum: ["vxlan", "vlan"], description: "Default vxlan" },
      vni: { type: "integer", description: "VXLAN only: a VNI the transport policy accepts; absent = allocated" },
      bridge: { type: "string", description: "Required for a VLAN network" },
      vlanTag: { type: "integer", minimum: 1, maximum: 4094, description: "VLAN only; absent = allocated from the vDC VLAN pool" },
      externalAddressing: { type: "boolean" },
    },
  },
  VdcVnetUpdateRequest: {
    type: "object",
    description: "Only the given fields change.",
    properties: {
      description: { type: "string" },
      firewall: { type: "boolean" },
      subnet: { type: "object", properties: { dnsServers: DNS_SERVERS } },
    },
  },
}

export const NETWORK_RESPONSE_SCHEMAS: Record<string, Record<string, unknown>> = {
  NodeNetworkListResponse: { type: "object", properties: { data: { type: "array", items: PVE_OBJECT } } },
  NodeIfaceResponse: { type: "object", properties: { data: PVE_OBJECT } },
  SdnApplyResponse: { type: "object", required: ["data"], properties: { data: { type: "object", properties: { upid: UPID } } } },
  VdcVnetsResponse: {
    type: "object",
    properties: {
      data: {
        type: "array",
        items: {
          type: "object",
          properties: {
            ...VDC_VNET_PROPERTIES,
            ipamUsage: { type: "object", properties: { used: { type: "integer" }, usable: { type: "integer" } } },
          },
        },
      },
    },
  },
  VdcVnetResponse: { type: "object", properties: { data: VDC_VNET } },
}
