// src/lib/db/settings.ts
//
// Tenant-scoped key/value settings store. Centralises the read/write of the
// `settings` table so callers don't repeat the same SELECT/UPSERT shape.
//
// Storage: `value` is JSONB on Postgres. Prisma returns parsed objects on
// read and accepts plain JS values on write — no JSON.stringify/parse needed
// at the call sites.

import type { Prisma } from "@prisma/client"

import { prisma } from "@/lib/db/prisma"

const DEFAULT_TENANT = "default"

/**
 * Read a tenant-scoped setting. Falls back to the global default tenant when
 * the requested tenant has no override, mirroring the legacy behaviour the
 * security-policies and branding code used. Returns `null` when neither row
 * exists, so callers can `?? defaultValue` cleanly.
 *
 * `T` is the JSON shape the caller expects. We don't validate it — trust the
 * writer; if the schema changed and a stale row is left over, the caller is
 * responsible for guarding their downstream consumption.
 */
export async function getSetting<T = unknown>(
  key: string,
  tenantId: string = DEFAULT_TENANT,
): Promise<T | null> {
  // Try the tenant-scoped row first.
  let row = await prisma.setting.findUnique({
    where: { key_tenantId: { key, tenantId } },
  })


  // Fall back to the default-tenant row when the caller is in a sub-tenant
  // that hasn't customised this key. Skipped when we're already in 'default'
  // so we don't double-query for the same primary key.
  if (!row && tenantId !== DEFAULT_TENANT) {
    row = await prisma.setting.findUnique({
      where: { key_tenantId: { key, tenantId: DEFAULT_TENANT } },
    })
  }

  if (!row) return null

return row.value as unknown as T
}

/**
 * Upsert a tenant-scoped setting. The value is stored as JSONB so callers
 * pass plain JS objects/arrays/primitives — no manual JSON.stringify.
 */
export async function setSetting(
  key: string,
  tenantId: string,
  value: unknown,
): Promise<void> {
  const json = (value ?? null) as Prisma.InputJsonValue

  await prisma.setting.upsert({
    where: { key_tenantId: { key, tenantId } },
    update: { value: json, updatedAt: new Date() },
    create: { key, tenantId, value: json },
  })
}
