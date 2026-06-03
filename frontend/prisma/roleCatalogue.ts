/**
 * RBAC catalogue: the permission list and the system-role → permission
 * mappings that `prisma/seed.ts` writes to Postgres on every container boot.
 *
 * Extracted from seed.ts so it can be imported by unit tests WITHOUT running
 * the seed (seed.ts calls main() at module load). esbuild bundles this file
 * into prisma/seed.js at Docker build time (--bundle), so the runtime seed
 * stays a self-contained CommonJS artifact.
 */

export interface Permission {
  id: string
  name: string
  category: string
  description: string
  isDangerous?: boolean
}

export const ALL_PERMISSIONS: Permission[] = [
  // VM/CT
  { id: "vm.view", name: "vm.view", category: "vm", description: "View VMs and their details" },
  { id: "vm.console", name: "vm.console", category: "vm", description: "Access VNC/SPICE console" },
  { id: "vm.start", name: "vm.start", category: "vm", description: "Start a VM" },
  { id: "vm.stop", name: "vm.stop", category: "vm", description: "Stop a VM" },
  { id: "vm.restart", name: "vm.restart", category: "vm", description: "Restart a VM" },
  { id: "vm.suspend", name: "vm.suspend", category: "vm", description: "Suspend/Resume a VM" },
  { id: "vm.snapshot", name: "vm.snapshot", category: "vm", description: "Create/Delete snapshots" },
  { id: "vm.backup", name: "vm.backup", category: "vm", description: "Backup/Restore a VM" },
  { id: "vm.clone", name: "vm.clone", category: "vm", description: "Clone a VM" },
  { id: "vm.migrate", name: "vm.migrate", category: "vm", description: "Migrate a VM", isDangerous: true },
  { id: "vm.config", name: "vm.config", category: "vm", description: "Modify VM configuration", isDangerous: true },
  { id: "vm.delete", name: "vm.delete", category: "vm", description: "Delete a VM", isDangerous: true },
  { id: "vm.create", name: "vm.create", category: "vm", description: "Create a new VM", isDangerous: true },

  // Storage
  { id: "storage.view", name: "storage.view", category: "storage", description: "View storages" },
  { id: "storage.content", name: "storage.content", category: "storage", description: "Browse storage content" },
  { id: "storage.upload", name: "storage.upload", category: "storage", description: "Upload ISO files/templates" },
  { id: "storage.delete", name: "storage.delete", category: "storage", description: "Delete files", isDangerous: true },

  // Node
  { id: "node.view", name: "node.view", category: "node", description: "View cluster nodes" },
  { id: "node.console", name: "node.console", category: "node", description: "Access node console" },
  { id: "node.services", name: "node.services", category: "node", description: "Manage services", isDangerous: true },
  { id: "node.network", name: "node.network", category: "node", description: "Configure network", isDangerous: true },

  // Connection
  { id: "connection.view", name: "connection.view", category: "connection", description: "View PVE/PBS connections" },
  { id: "connection.manage", name: "connection.manage", category: "connection", description: "Manage connections", isDangerous: true },

  // Backup
  { id: "backup.view", name: "backup.view", category: "backup", description: "View backups" },
  { id: "backup.restore", name: "backup.restore", category: "backup", description: "Restore a backup", isDangerous: true },
  { id: "backup.delete", name: "backup.delete", category: "backup", description: "Delete a backup", isDangerous: true },
  { id: "backup.job.view", name: "backup.job.view", category: "backup", description: "View scheduled backup jobs" },
  { id: "backup.job.create", name: "backup.job.create", category: "backup", description: "Create a backup job", isDangerous: true },
  { id: "backup.job.edit", name: "backup.job.edit", category: "backup", description: "Edit a backup job", isDangerous: true },
  { id: "backup.job.delete", name: "backup.job.delete", category: "backup", description: "Delete a backup job", isDangerous: true },
  { id: "backup.job.run", name: "backup.job.run", category: "backup", description: "Manually run a backup job" },

  // Node management
  { id: "node.manage", name: "node.manage", category: "node", description: "Manage nodes (updates, restart)", isDangerous: true },

  // Automation
  { id: "automation.view", name: "automation.view", category: "automation", description: "View automation and DRS settings" },
  { id: "automation.manage", name: "automation.manage", category: "automation", description: "Configure automation and DRS", isDangerous: true },
  { id: "automation.execute", name: "automation.execute", category: "automation", description: "Execute automation actions", isDangerous: true },

  // Operations
  { id: "events.view", name: "events.view", category: "operations", description: "View events and logs" },
  { id: "alerts.view", name: "alerts.view", category: "operations", description: "View alerts" },
  { id: "alerts.manage", name: "alerts.manage", category: "operations", description: "Manage alerts (acknowledge, resolve)", isDangerous: true },
  { id: "tasks.view", name: "tasks.view", category: "operations", description: "View task center" },
  { id: "reports.view", name: "reports.view", category: "operations", description: "View reports" },

  // Storage admin
  { id: "storage.admin", name: "storage.admin", category: "storage", description: "Access Storage Overview and Ceph pages", isDangerous: true },

  // Admin
  { id: "admin.users", name: "admin.users", category: "admin", description: "Manage users", isDangerous: true },
  { id: "admin.rbac", name: "admin.rbac", category: "admin", description: "Manage roles and permissions", isDangerous: true },
  { id: "admin.settings", name: "admin.settings", category: "admin", description: "Modify settings", isDangerous: true },
  { id: "admin.audit", name: "admin.audit", category: "admin", description: "View audit logs" },
  { id: "admin.compliance", name: "admin.compliance", category: "admin", description: "Manage compliance and security policies", isDangerous: true },
  { id: "admin.tenants", name: "admin.tenants", category: "admin", description: "Manage tenants (multi-tenancy)", isDangerous: true },

  // SDN / VNet
  { id: "sdn.vnet.view", name: "sdn.vnet.view", category: "sdn", description: "List and view VNets in own vDCs" },
  { id: "sdn.vnet.create", name: "sdn.vnet.create", category: "sdn", description: "Create new VNets in own vDCs" },
  { id: "sdn.vnet.edit", name: "sdn.vnet.edit", category: "sdn", description: "Edit VNet metadata and firewall toggle" },
  { id: "sdn.vnet.delete", name: "sdn.vnet.delete", category: "sdn", description: "Delete VNets that have no NIC attached", isDangerous: true },
  { id: "sdn.vnet.firewall", name: "sdn.vnet.firewall", category: "sdn", description: "CRUD firewall rules, ipsets, aliases per VNet", isDangerous: true },
]

export interface RoleSeed {
  id: string
  name: string
  description: string
  color: string
  /** "*" expands to every permission id from rbac_permissions. */
  permissions: string[]
}

export const ROLES: RoleSeed[] = [
  {
    id: "role_super_admin",
    name: "Super Admin",
    description: "Full access to all features",
    color: "#ef4444",
    permissions: ["*"],
  },
  {
    id: "role_provider_admin",
    name: "Provider Admin",
    description: "MSP provider: full access + manages tenant identity and OIDC",
    color: "#dc2626",
    permissions: ["*"],
  },
  {
    id: "role_operator",
    name: "Operator",
    description: "Day-to-day VM management without admin access",
    color: "#f59e0b",
    permissions: [
      "vm.view", "vm.console", "vm.start", "vm.stop", "vm.restart", "vm.suspend",
      "vm.snapshot", "vm.backup",
      "node.view", "node.console", "connection.view", "backup.view",
      "events.view", "tasks.view", "alerts.view", "automation.view", "reports.view",
    ],
  },
  {
    id: "role_vm_admin",
    name: "VM Admin",
    description: "Full VM administration",
    color: "#8b5cf6",
    permissions: [
      "vm.view", "vm.console", "vm.start", "vm.stop", "vm.restart", "vm.suspend",
      "vm.snapshot", "vm.backup", "vm.clone", "vm.migrate", "vm.config", "vm.delete", "vm.create",
      "storage.view", "storage.content", "storage.upload",
      "node.view", "node.console", "node.manage", "connection.view",
      "backup.view", "backup.restore",
      "events.view", "tasks.view", "storage.admin",
      "alerts.view", "alerts.manage", "automation.view", "automation.manage", "reports.view",
    ],
  },
  {
    id: "role_viewer",
    name: "Viewer",
    description: "Read-only access to all resources",
    color: "#3b82f6",
    permissions: [
      "vm.view", "node.view", "connection.view", "storage.view", "backup.view",
      "events.view", "alerts.view", "automation.view", "reports.view", "tasks.view",
    ],
  },
  {
    id: "role_vm_user",
    name: "VM User",
    description: "Basic usage of assigned VMs (console, start/stop)",
    color: "#10b981",
    permissions: [
      "vm.view", "vm.console", "vm.start", "vm.stop", "vm.restart",
      // issue #378: read-only context so a VM User can navigate the Inventory
      // (connection list + node detail panel) for the VMs it is allowed to
      // use. The SSE stream + filterVmsByPermission still restrict the actual
      // VM list to the user's assigned scope.
      "connection.view", "node.view",
    ],
  },
  {
    id: "role_tenant_admin",
    name: "Tenant Admin",
    description: "Full VM and backup administration within tenant scope",
    color: "#ea580c",
    permissions: [
      // No automation.* on purpose: orchestration pages (DRS, Site Recovery,
      // network security, flows, resources) are provider-only.
      "vm.view", "vm.console", "vm.start", "vm.stop", "vm.restart", "vm.suspend",
      "vm.snapshot", "vm.backup", "vm.clone", "vm.migrate", "vm.config", "vm.delete", "vm.create",
      "node.view", "connection.view",
      "storage.view",
      "backup.view", "backup.restore", "backup.delete",
      "backup.job.view", "backup.job.create", "backup.job.edit", "backup.job.delete", "backup.job.run",
      "admin.users", "admin.rbac", "admin.settings", "admin.audit",
      "alerts.view", "alerts.manage",
      "reports.view",
      "sdn.vnet.view", "sdn.vnet.create", "sdn.vnet.edit", "sdn.vnet.delete", "sdn.vnet.firewall",
    ],
  },
  {
    id: "role_tenant_operator",
    name: "Tenant Operator",
    description: "Day-to-day VM operations (start, stop, console, snapshots)",
    color: "#2563eb",
    permissions: [
      "vm.view", "vm.console", "vm.start", "vm.stop", "vm.restart", "vm.suspend",
      "vm.snapshot", "vm.migrate",
      "storage.view",
      "node.view", "connection.view",
      "backup.view",
      "events.view", "tasks.view",
      "alerts.view",
      "reports.view",
      "sdn.vnet.view",
    ],
  },
  {
    id: "role_tenant_viewer",
    name: "Tenant Viewer",
    description: "Read-only access with console to assigned VMs",
    color: "#6b7280",
    permissions: [
      "vm.view", "vm.console",
      "storage.view",
      "node.view", "connection.view",
      "backup.view",
      "events.view", "tasks.view",
      "alerts.view",
      "reports.view",
      "sdn.vnet.view",
    ],
  },
]
