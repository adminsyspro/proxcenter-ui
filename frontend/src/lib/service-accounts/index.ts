// Service accounts (issue #1404): a non-human identity of a tenant that only
// ever authenticates with API tokens. It is a `users` row flagged
// `serviceAccount`, so the whole RBAC (role assignments, tenant membership,
// the live creator check of tokens) applies to it unchanged, but it has no
// password, no interactive login and no second factor, and it stays out of
// the user lists. Its tokens take ITS roles, not their creator's, and die with
// it.
import { nanoid } from "nanoid"

import { prisma } from "@/lib/db/prisma"

/** Reserved domain (RFC 2606): never delivered, never issued by an IdP. */
export const SERVICE_ACCOUNT_EMAIL_DOMAIN = "service-account.invalid"
export const SERVICE_ACCOUNT_AUTH_PROVIDER = "service_account"

const NAME_MAX = 64
const DESCRIPTION_MAX = 500

export class ServiceAccountError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = "ServiceAccountError"
  }
}

export type ServiceAccountRole = {
  id: string
  roleId: string
  roleName: string
  color: string | null
  scopeType: string
  scopeTarget: string | null
}

export type ServiceAccountView = {
  id: string
  tenantId: string
  tenantName: string
  name: string
  description: string | null
  enabled: boolean
  createdAt: string
  roles: ServiceAccountRole[]
  tokenCount: number
  lastUsedAt: string | null
}

/** The address a service account carries in the `users` table and the audit trail. */
export function serviceAccountEmail(id: string): string {
  return `${id.toLowerCase()}@${SERVICE_ACCOUNT_EMAIL_DOMAIN}`
}

export function isServiceAccountEmail(email: string | null | undefined): boolean {
  return !!email && email.toLowerCase().endsWith(`@${SERVICE_ACCOUNT_EMAIL_DOMAIN}`)
}

const VIEW_SELECT = {
  id: true,
  tenantId: true,
  name: true,
  description: true,
  enabled: true,
  createdAt: true,
  tenants: { select: { tenant: { select: { id: true, name: true } } } },
  rolesAssigned: {
    select: { id: true, roleId: true, scopeType: true, scopeTarget: true, role: { select: { name: true, color: true } } },
    orderBy: { grantedAt: "asc" as const },
  },
  serviceAccountTokens: { select: { lastUsedAt: true } },
} as const

function toView(row: any): ServiceAccountView {
  const lastUsed = (row.serviceAccountTokens as { lastUsedAt: Date | null }[])
    .map(t => t.lastUsedAt?.getTime() ?? 0)
    .reduce((a, b) => Math.max(a, b), 0)
  const tenant = (row.tenants as { tenant: { id: string; name: string } }[]).find(m => m.tenant.id === row.tenantId)?.tenant
  return {
    id: row.id,
    tenantId: row.tenantId,
    tenantName: tenant?.name ?? row.tenantId,
    name: row.name ?? row.id,
    description: row.description ?? null,
    enabled: row.enabled,
    createdAt: row.createdAt.toISOString(),
    roles: (row.rolesAssigned as any[]).map(a => ({
      id: a.id,
      roleId: a.roleId,
      roleName: a.role?.name ?? a.roleId,
      color: a.role?.color ?? null,
      scopeType: a.scopeType,
      scopeTarget: a.scopeTarget ?? null,
    })),
    tokenCount: row.serviceAccountTokens.length,
    lastUsedAt: lastUsed ? new Date(lastUsed).toISOString() : null,
  }
}

function normalizeName(raw: unknown): string {
  const name = typeof raw === "string" ? raw.trim() : ""
  if (!name) throw new ServiceAccountError("name is required", 400)
  if (name.length > NAME_MAX) throw new ServiceAccountError(`name is limited to ${NAME_MAX} characters`, 400)
  return name
}

function normalizeDescription(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null
  if (typeof raw !== "string") throw new ServiceAccountError("description must be a string", 400)
  const text = raw.trim()
  if (text.length > DESCRIPTION_MAX) throw new ServiceAccountError(`description is limited to ${DESCRIPTION_MAX} characters`, 400)
  return text || null
}

async function assertNameFree(tenantId: string, name: string, exceptId?: string): Promise<void> {
  const clash = await prisma.user.findFirst({
    where: { serviceAccount: true, tenantId, name: { equals: name, mode: "insensitive" }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  })
  if (clash) throw new ServiceAccountError(`A service account named "${name}" already exists in this tenant`, 409)
}

/** The service accounts of `tenantId`, or of every tenant when null. */
export async function listServiceAccounts(tenantId: string | null): Promise<ServiceAccountView[]> {
  const rows = await prisma.user.findMany({
    where: { serviceAccount: true, ...(tenantId ? { tenantId } : {}) },
    select: VIEW_SELECT,
    orderBy: [{ tenantId: "asc" }, { name: "asc" }],
  })
  return rows.map(toView)
}

export async function getServiceAccount(id: string): Promise<ServiceAccountView | null> {
  const row = await prisma.user.findFirst({ where: { id, serviceAccount: true }, select: VIEW_SELECT })
  return row ? toView(row) : null
}

/** A service account of a live tenant, member of it, with no credential but its future tokens. */
export async function createServiceAccount(input: { tenantId: string; name: unknown; description?: unknown }): Promise<ServiceAccountView> {
  const name = normalizeName(input.name)
  const description = normalizeDescription(input.description)
  const tenant = await prisma.tenant.findUnique({ where: { id: input.tenantId }, select: { id: true, enabled: true } })
  if (!tenant?.enabled) throw new ServiceAccountError("Tenant not found", 404)
  await assertNameFree(tenant.id, name)

  const id = nanoid()
  const now = new Date()
  await prisma.$transaction(async tx => {
    await tx.user.create({
      data: {
        id,
        tenantId: tenant.id,
        email: serviceAccountEmail(id),
        password: null,
        name,
        description,
        role: "viewer",
        authProvider: SERVICE_ACCOUNT_AUTH_PROVIDER,
        serviceAccount: true,
        enabled: true,
        createdAt: now,
        updatedAt: now,
      },
    })
    await tx.userTenant.create({ data: { userId: id, tenantId: tenant.id, isDefault: true, joinedAt: now } })
  })
  return (await getServiceAccount(id))!
}

export async function updateServiceAccount(
  id: string,
  input: { name?: unknown; description?: unknown; enabled?: unknown },
): Promise<ServiceAccountView> {
  const row = await prisma.user.findFirst({ where: { id, serviceAccount: true }, select: { id: true, tenantId: true } })
  if (!row) throw new ServiceAccountError("Service account not found", 404)
  const data: Record<string, unknown> = { updatedAt: new Date() }
  if (input.name !== undefined) {
    data.name = normalizeName(input.name)
    await assertNameFree(row.tenantId, data.name as string, id)
  }
  if (input.description !== undefined) data.description = normalizeDescription(input.description)
  if (input.enabled !== undefined) {
    if (typeof input.enabled !== "boolean") throw new ServiceAccountError("enabled must be a boolean", 400)
    data.enabled = input.enabled
  }
  await prisma.user.update({ where: { id }, data })
  return (await getServiceAccount(id))!
}

/** Removes the account; its tokens, roles and membership go with it (cascades). */
export async function deleteServiceAccount(id: string): Promise<{ name: string }> {
  const row = await prisma.user.findFirst({ where: { id, serviceAccount: true }, select: { id: true, name: true } })
  if (!row) throw new ServiceAccountError("Service account not found", 404)
  await prisma.user.delete({ where: { id } })
  return { name: row.name ?? id }
}
