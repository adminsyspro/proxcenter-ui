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

// The permission list + system-role → permission mappings live in a separate
// pure-data module so unit tests can import them without running this seed
// (main() executes at module load). esbuild --bundle inlines it into seed.js.
import { ALL_PERMISSIONS, ROLES } from "./roleCatalogue"

// Prisma 7 requires a driver adapter; @prisma/adapter-pg wraps node-postgres.
// DATABASE_URL is read explicitly so the seed fails fast on misconfig instead
// of silently connecting to a default localhost:5432.
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  console.error("[seed] DATABASE_URL is not set; nothing to do.")
  process.exit(1)
}

// PrismaPg ignores the libpq-style `?schema=` query parameter; pass the
// schema explicitly so the seed works in non-public schemas (e.g. smoke tests).
function extractSchema(url: string): string | undefined {
  try {
    const parsed = new URL(url)
    const s = parsed.searchParams.get('schema')
    return s && s.length > 0 ? s : undefined
  } catch {
    return undefined
  }
}

const _schema = extractSchema(databaseUrl)
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl }, _schema ? { schema: _schema } : {}),
})

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
