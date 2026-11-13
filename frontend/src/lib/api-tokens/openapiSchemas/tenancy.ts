// Response schemas of the multi-tenant entries (issue #1360): tenants, vDCs,
// EVPN zones, IPAM, roles and users. Server-computed fields (usage, counts,
// timestamps) are described as such; objects ProxCenter enriches over time
// stay open (additionalProperties) so a new field never breaks a client.
import { STRINGS } from "./shared"

const NULLABLE_STRING = { type: ["string", "null"] }
const NULLABLE_INT = { type: ["integer", "null"] }
const DATE = { type: "string", format: "date-time" }
const NULLABLE_DATE = { type: ["string", "null"], format: "date-time" }
const ID_NAME = { type: "object", properties: { id: { type: "string" }, name: NULLABLE_STRING } }

function list(item: Record<string, unknown>, meta?: Record<string, unknown>): Record<string, unknown> {
  return {
    type: "object",
    properties: { data: { type: "array", items: item }, ...(meta ? { meta: { type: "object", properties: meta } } : {}) },
  }
}
const one = (item: Record<string, unknown>) => ({ type: "object", properties: { data: item } })
const TOTAL = { total: { type: "integer" } }

// ── Tenants ──────────────────────────────────────────────────────────────────
const TENANT = {
  type: "object",
  properties: {
    id: { type: "string" },
    slug: { type: "string", description: "Lowercase letters, digits and hyphens; unique" },
    name: { type: "string" },
    description: NULLABLE_STRING,
    enabled: { type: "boolean" },
    operatingModel: { type: "string", enum: ["iaas", "msp"], description: "iaas: vDC tenant; msp: runs its own clusters" },
    vmidRangeStart: NULLABLE_INT,
    vmidRangeEnd: NULLABLE_INT,
    settings: { type: ["object", "null"], additionalProperties: true },
    createdBy: NULLABLE_STRING,
    createdAt: DATE,
    updatedAt: DATE,
  },
}
const TENANT_MEMBER = {
  type: "object",
  properties: {
    id: { type: "string" },
    email: { type: "string" },
    name: NULLABLE_STRING,
    role: { type: "string", description: "Legacy account role; the rights come from rbac_roles" },
    enabled: { type: "boolean" },
    is_default: { type: "boolean", description: "The tenant the user lands in" },
    is_super_admin: { type: "boolean" },
    rbac_roles: {
      type: "array",
      items: { type: "object", properties: { id: { type: "string" }, name: { type: "string" }, is_system: { type: "boolean" } } },
    },
    joined_at: DATE,
  },
}

// ── vDCs ─────────────────────────────────────────────────────────────────────
export const QUOTA = {
  type: ["object", "null"],
  description: "Null: no quota. A null limit is unlimited.",
  properties: {
    maxVcpus: NULLABLE_INT,
    maxRamMb: NULLABLE_INT,
    maxStorageMb: NULLABLE_INT,
    maxVms: NULLABLE_INT,
    maxSnapshots: NULLABLE_INT,
    maxBackups: NULLABLE_INT,
    maxVnets: NULLABLE_INT,
  },
}
const USAGE = {
  type: ["object", "null"],
  description: "Server computed from Proxmox, refreshed in the background",
  properties: {
    usedVcpus: { type: "integer" },
    usedRamMb: { type: "integer" },
    usedStorageMb: { type: "integer" },
    usedVms: { type: "integer" },
    usedSnapshots: { type: "integer" },
    usedBackups: { type: "integer" },
    usedStorageByStorage: { type: ["object", "null"], additionalProperties: { type: "integer" } },
    lastSyncedAt: NULLABLE_DATE,
  },
}
export const VDC = {
  type: "object",
  additionalProperties: true,
  properties: {
    id: { type: "string" },
    tenantId: { type: "string" },
    tenantName: NULLABLE_STRING,
    connectionId: { type: "string", description: "The provider cluster the vDC lives on" },
    name: { type: "string" },
    slug: { type: "string" },
    description: NULLABLE_STRING,
    enabled: { type: "boolean" },
    pvePoolName: { type: "string", description: "Proxmox resource pool of the vDC" },
    sdnZoneName: NULLABLE_STRING,
    evpnZoneId: { type: ["string", "null"], description: "Shared EVPN zone the vDC is attached to" },
    edgeModel: NULLABLE_STRING,
    primaryStorage: NULLABLE_STRING,
    allowBlankVms: { type: "boolean" },
    nodes: STRINGS,
    storages: STRINGS,
    computePolicy: { type: "object", additionalProperties: true },
    transport: { type: "object", additionalProperties: true, description: "VNet transport: cluster, VLAN or VXLAN peers" },
    quota: QUOTA,
    usage: USAGE,
    vnets: { type: "array", items: { type: "object", additionalProperties: true }, description: "As GET /api/v1/vdcs/{id}/vnets returns them" },
    sharedBridges: { type: "array", items: { type: "object", additionalProperties: true } },
    vlanPools: { type: "array", items: { type: "object", additionalProperties: true } },
    storagePolicies: { type: "array", items: { type: "object", additionalProperties: true } },
    pbsBindings: { type: "array", items: { type: "object", additionalProperties: true } },
    isoLibraries: { type: "array", items: { type: "object", additionalProperties: true } },
    catalogGrants: { type: "object", properties: { imageIds: STRINGS, blueprintIds: STRINGS } },
    createdBy: NULLABLE_STRING,
    createdAt: DATE,
    updatedAt: DATE,
  },
}
const EVPN_MEMBER = {
  type: "object",
  properties: {
    id: { type: "string" },
    connectionId: { type: "string" },
    connectionName: { type: "string" },
    controller: { type: "string" },
    controllerCreated: { type: "boolean", description: "ProxCenter created the EVPN controller" },
    adopted: { type: "boolean", description: "The zone already ran on the cluster when it was declared" },
  },
}
export const EVPN_ZONE = {
  type: "object",
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    description: NULLABLE_STRING,
    zoneName: { type: "string", description: "Name of the zone in Proxmox" },
    vrfVxlan: { type: "integer" },
    mtu: NULLABLE_INT,
    vniStart: { type: "integer" },
    vniEnd: { type: "integer" },
    members: { type: "array", items: EVPN_MEMBER },
    vdcCount: { type: "integer", description: "Server computed" },
    networkCount: { type: "integer", description: "Server computed" },
    createdAt: DATE,
  },
}
const EVPN_ZONE_WITH_STATUS = {
  ...EVPN_ZONE,
  properties: {
    ...EVPN_ZONE.properties,
    status: {
      type: "array",
      description: "How each member cluster runs the zone, read from Proxmox",
      items: {
        type: "object",
        properties: {
          connectionId: { type: "string" },
          connectionName: { type: "string" },
          state: { type: "string", enum: ["ok", "pending", "missing", "drift", "controller-missing", "unreachable"] },
          detail: { type: ["string", "null"], description: "What differs from the declaration, for drift" },
          vnetCount: { type: "integer" },
        },
      },
    },
  },
}
export const STORAGE_POLICY = {
  type: "object",
  properties: {
    id: { type: "string" },
    connectionId: { type: "string" },
    name: { type: "string" },
    description: NULLABLE_STRING,
    storageId: { type: "string" },
    iopsRd: NULLABLE_INT,
    iopsWr: NULLABLE_INT,
    mbpsRd: NULLABLE_INT,
    mbpsWr: NULLABLE_INT,
    vdcCount: { type: "integer", description: "Server computed" },
    createdAt: DATE,
    updatedAt: DATE,
  },
}
const MOVE = {
  type: "object",
  properties: {
    id: { type: "string" },
    guestName: NULLABLE_STRING,
    vmid: { type: "integer" },
    targetVmid: { type: "integer" },
    status: { type: "string" },
    origin: { type: "string" },
    sourceVdc: ID_NAME,
    targetVdc: ID_NAME,
    sourceConnectionId: { type: "string" },
    targetConnectionId: { type: "string" },
    targetNode: NULLABLE_STRING,
    error: NULLABLE_STRING,
    warnings: {
      type: "array",
      items: { type: "object", properties: { code: { type: "string" }, context: { type: "object", additionalProperties: true } } },
    },
    createdAt: DATE,
    finishedAt: NULLABLE_DATE,
  },
}

// ── IPAM ─────────────────────────────────────────────────────────────────────
const IPAM = {
  type: "object",
  properties: {
    connectionId: { type: "string" },
    subnetId: { type: "string" },
    cidr: { type: "string" },
    gateway: { type: "string" },
    usable: { type: "integer", description: "Usable hosts of the CIDR, the gateway excluded" },
    used: { type: "integer" },
    allocations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          ip: { type: "string" },
          mac: NULLABLE_STRING,
          vmid: NULLABLE_INT,
          hostname: NULLABLE_STRING,
          createdAt: DATE,
          vm: {
            type: ["object", "null"],
            description: "Live guest state, null when Proxmox could not be read",
            properties: { name: { type: "string" }, node: { type: "string" }, status: { type: "string" }, type: { type: "string" } },
          },
        },
      },
    },
  },
}
const NEXT_FREE = {
  type: "object",
  properties: {
    ip: { type: "string" },
    cidr: { type: "string" },
    prefix: { type: "integer" },
    gateway: { type: "string" },
    dnsServers: STRINGS,
    suggestedMac: { type: "string", description: "A fresh MAC in the Proxmox range, not reserved" },
  },
}

// ── RBAC and users ───────────────────────────────────────────────────────────
const PERMISSION = {
  type: "object",
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    category: { type: "string" },
    description: NULLABLE_STRING,
    is_dangerous: { type: "boolean" },
  },
}
const ROLE_PROPERTIES = {
  id: { type: "string" },
  name: { type: "string" },
  description: NULLABLE_STRING,
  is_system: { type: "boolean" },
  color: NULLABLE_STRING,
  widget_overrides: { type: ["object", "null"], additionalProperties: true },
  default_scopes: { type: ["array", "null"], items: { type: "object", additionalProperties: true } },
  tenant_id: { type: ["string", "null"], description: "Null for a system or provider catalogue role" },
  audience: { type: ["string", "null"], enum: ["provider", "tenant", "service_desk", null] },
  publish_all: { type: "boolean" },
  published_tenants: STRINGS,
  permissions: { type: "array", items: PERMISSION },
  created_at: DATE,
  updated_at: DATE,
}
const ROLE_IN_LIST = { type: "object", properties: { ...ROLE_PROPERTIES, user_count: { type: "integer", description: "Server computed" } } }
const ROLE_DETAIL = {
  type: "object",
  properties: {
    ...ROLE_PROPERTIES,
    users: { type: "array", description: "Holders of the role in the token's tenant", items: { type: "object", additionalProperties: true } },
  },
}
const ASSIGNMENT_IN_LIST = {
  type: "object",
  properties: {
    id: { type: "string" },
    user: { type: "object", properties: { id: { type: "string" }, email: { type: "string" }, name: NULLABLE_STRING } },
    role: { type: "object", properties: { id: { type: "string" }, name: { type: "string" }, color: NULLABLE_STRING, is_system: { type: "boolean" } } },
    tenant_id: { type: "string" },
    tenant_name: NULLABLE_STRING,
    managed_by: { type: ["string", "null"], description: "Set when the assignment is synchronised (SSO, service desk) rather than granted by hand" },
    scope_type: { type: "string", description: "global, connection, node, vm, tag, pool, storage or inherit" },
    scope_target: NULLABLE_STRING,
    granted_at: DATE,
    granted_by_email: NULLABLE_STRING,
    expires_at: NULLABLE_DATE,
  },
}
const ASSIGNMENT_DETAIL = {
  type: "object",
  properties: {
    id: { type: "string" },
    user_id: { type: "string" },
    role_id: { type: "string" },
    scope_type: { type: "string" },
    scope_target: NULLABLE_STRING,
    tenant_id: { type: "string" },
    granted_by: NULLABLE_STRING,
    granted_at: DATE,
    expires_at: NULLABLE_DATE,
    user_email: { type: "string" },
    user_name: NULLABLE_STRING,
    role_name: { type: "string" },
    role_color: NULLABLE_STRING,
    granted_by_email: NULLABLE_STRING,
  },
}
const USER_PROPERTIES = {
  id: { type: "string" },
  email: { type: "string" },
  name: NULLABLE_STRING,
  role: { type: "string", description: "Legacy account role; the rights come from the role assignments" },
  auth_provider: { type: "string", description: "credentials, ldap or oidc" },
  local_login_allowed: { type: "boolean" },
  enabled: { type: "boolean" },
  last_login_at: NULLABLE_DATE,
  created_at: DATE,
  updated_at: DATE,
}
const USER_IN_LIST = {
  type: "object",
  properties: {
    ...USER_PROPERTIES,
    totp_enabled: { type: "boolean" },
    require_2fa_enrollment: { type: "boolean" },
    is_super_admin: { type: "boolean" },
    active_session_count: { type: "integer", description: "Server computed" },
    tenants: {
      type: "array",
      items: { type: "object", properties: { id: { type: "string" }, name: { type: "string" }, isDefault: { type: "boolean" } } },
    },
  },
}

export const TENANCY_RESPONSE_SCHEMAS: Record<string, Record<string, unknown>> = {
  TenantListResponse: list(TENANT),
  TenantResponse: one(TENANT),
  TenantUsersResponse: list(TENANT_MEMBER),
  VdcListResponse: list(VDC),
  VdcResponse: one(VDC),
  VdcEvpnNetworksResponse: one({
    type: "object",
    properties: {
      available: { type: "boolean", description: "The vDC is attached to a shared EVPN zone" },
      vdcs: { type: "array", items: ID_NAME, description: "vDCs of the tenant attached to the same zone, this one included" },
      networks: {
        type: "array",
        items: { type: "object", properties: { id: { type: "string" }, name: { type: "string" }, vdcIds: STRINGS } },
      },
    },
  }),
  EvpnZoneListResponse: list(EVPN_ZONE),
  EvpnZoneResponse: one(EVPN_ZONE_WITH_STATUS),
  StoragePolicyListResponse: list(STORAGE_POLICY),
  VdcMoveListResponse: list(MOVE),
  VdcMoveResponse: one(MOVE),
  VdcVnetIpamResponse: one(IPAM),
  VdcVnetNextFreeResponse: one(NEXT_FREE),
  RbacRoleListResponse: list(ROLE_IN_LIST, TOTAL),
  RbacRoleResponse: one(ROLE_DETAIL),
  RbacPermissionListResponse: {
    type: "object",
    properties: {
      data: { type: "array", items: PERMISSION },
      categories: {
        type: "array",
        items: { type: "object", properties: { id: { type: "string" }, label: { type: "string" }, permissions: { type: "array", items: PERMISSION } } },
      },
      meta: { type: "object", properties: TOTAL },
    },
  },
  RbacAssignmentListResponse: list(ASSIGNMENT_IN_LIST, TOTAL),
  RbacAssignmentResponse: one(ASSIGNMENT_DETAIL),
  UserListResponse: list(USER_IN_LIST, { ...TOTAL, adminCount: { type: "integer" } }),
  UserResponse: one({ type: "object", properties: USER_PROPERTIES }),
}
