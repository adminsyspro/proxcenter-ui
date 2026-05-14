/**
 * Idempotent seed for ProxCenter on Postgres.
 *
 * Bootstraps the rows the app needs out of the box: the default tenant,
 * the singleton security_policies row, the RBAC permission catalogue and
 * the nine system roles with their permission mappings.
 *
 * The seed deliberately does NOT create any user account: super-admin
 * user provisioning is handled by the setup wizard on first launch.
 *
 * Re-running the seed is safe — every step uses upsert semantics, so
 * tweaking the catalogue above and shipping a new image will reconcile
 * existing rows on the next container boot rather than duplicate them.
 */

import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"

// Prisma 7 requires a driver adapter; @prisma/adapter-pg wraps node-postgres.
// DATABASE_URL is read explicitly so the seed fails fast on misconfig instead
// of silently connecting to a default localhost:5432.
const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  console.error("[seed] DATABASE_URL is not set; nothing to do.")
  process.exit(1)
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl }),
})

interface Permission {
  id: string
  name: string
  category: string
  description: string
  isDangerous?: boolean
}

const ALL_PERMISSIONS: Permission[] = [
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

interface RoleSeed {
  id: string
  name: string
  description: string
  color: string

  /** "*" expands to every permission id from rbac_permissions. */
  permissions: string[]
}

const ROLES: RoleSeed[] = [
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

async function seedTenant() {
  await prisma.tenant.upsert({
    where: { id: "default" },
    update: {},
    create: {
      id: "default",
      slug: "default",
      name: "Default",
      description: "Default tenant for all existing data",
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  })
}

async function seedSecurityPolicy() {
  await prisma.securityPolicy.upsert({
    where: { id: "default" },
    update: {},
    create: {
      id: "default",
      tenantId: "default",
      updatedAt: new Date(),
    },
  })
}

async function seedPermissions() {
  for (const p of ALL_PERMISSIONS) {
    await prisma.rbacPermission.upsert({
      where: { id: p.id },
      update: {
        name: p.name,
        category: p.category,
        description: p.description,
        isDangerous: p.isDangerous ?? false,
      },
      create: {
        id: p.id,
        name: p.name,
        category: p.category,
        description: p.description,
        isDangerous: p.isDangerous ?? false,
      },
    })
  }
}

async function seedRoles() {
  const allPermissionIds = (await prisma.rbacPermission.findMany({ select: { id: true } })).map(p => p.id)

  for (const r of ROLES) {
    const now = new Date()

    await prisma.rbacRole.upsert({
      where: { id: r.id },
      update: {
        name: r.name,
        description: r.description,
        color: r.color,
        isSystem: true,
        updatedAt: now,
      },
      create: {
        id: r.id,
        name: r.name,
        description: r.description,
        color: r.color,
        isSystem: true,
        createdAt: now,
        updatedAt: now,
      },
    })

    // Resolve effective permission set: "*" → every catalogue id, else verbatim.
    // Filter against the catalogue so a stale entry in the role list doesn't
    // crash the seed if a permission was renamed/removed but the role list
    // wasn't updated yet.
    const effective = r.permissions.includes("*")
      ? allPermissionIds
      : r.permissions.filter(p => allPermissionIds.includes(p))

    // Replace-rather-than-append semantics: each seed run rebuilds the role's
    // permission set so that wildcard roles pick up newly-added permissions
    // automatically, and explicit lists drop permissions removed from ROLES.
    // Wrapped in a transaction so a partial failure can't leave the role
    // half-permissioned.
    await prisma.$transaction([
      prisma.rbacRolePermission.deleteMany({ where: { roleId: r.id } }),
      prisma.rbacRolePermission.createMany({
        data: effective.map(permissionId => ({ roleId: r.id, permissionId })),
        skipDuplicates: true,
      }),
    ])
  }
}

async function main() {
  console.log("[seed] starting…")
  await seedTenant()
  console.log("[seed]   tenant 'default' ✓")
  await seedSecurityPolicy()
  console.log("[seed]   security_policies singleton ✓")
  await seedPermissions()
  console.log(`[seed]   ${ALL_PERMISSIONS.length} permissions ✓`)
  await seedRoles()
  console.log(`[seed]   ${ROLES.length} system roles + permission mappings ✓`)
  console.log("[seed] done")
}

main()
  .catch(e => {
    console.error("[seed] failed:", e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
