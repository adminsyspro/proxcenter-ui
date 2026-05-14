// src/lib/compliance/profiles.ts
// CRUD operations for compliance profiles (Postgres / Prisma).

import { prisma } from '@/lib/db/prisma'

// Wire shape preserved (snake_case fields, integer-as-boolean) for the UI
// callers that haven't been migrated to camelCase yet.
export interface ComplianceProfile {
  id: string
  name: string
  description: string | null
  framework_id: string | null
  is_active: number
  connection_id: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface ComplianceProfileCheck {
  id: string
  profile_id: string
  check_id: string
  enabled: number
  weight: number
  control_ref: string | null
  category: string | null
}

function rowToProfile(r: any): ComplianceProfile {
  return {
    id: r.id,
    name: r.name,
    description: r.description ?? null,
    framework_id: r.frameworkId ?? null,
    is_active: r.isActive ? 1 : 0,
    connection_id: r.connectionId ?? null,
    created_by: r.createdBy ?? null,
    created_at: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
    updated_at: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : String(r.updatedAt),
  }
}

function rowToCheck(r: any): ComplianceProfileCheck {
  return {
    id: r.id,
    profile_id: r.profileId,
    check_id: r.checkId,
    enabled: r.enabled ? 1 : 0,
    weight: Number(r.weight),
    control_ref: r.controlRef ?? null,
    category: r.category ?? null,
  }
}

export async function listProfiles(tenantId: string, connectionId?: string): Promise<ComplianceProfile[]> {
  const where: any = { tenantId }

  if (connectionId) {
    where.OR = [{ connectionId }, { connectionId: null }]
  }

  const rows = await prisma.complianceProfile.findMany({
    where,
    orderBy: { createdAt: 'desc' },
  })


return rows.map(rowToProfile)
}

export async function getProfile(id: string, tenantId: string): Promise<ComplianceProfile | undefined> {
  const r = await prisma.complianceProfile.findFirst({ where: { id, tenantId } })


return r ? rowToProfile(r) : undefined
}

export async function getProfileChecks(profileId: string, tenantId: string): Promise<ComplianceProfileCheck[]> {
  const rows = await prisma.complianceProfileCheck.findMany({ where: { profileId, tenantId } })


return rows.map(rowToCheck)
}

export async function createProfile(data: {
  name: string
  description?: string
  connection_id?: string
  created_by?: string
  tenant_id: string
}): Promise<ComplianceProfile> {
  const id = crypto.randomUUID()
  const now = new Date()

  await prisma.complianceProfile.create({
    data: {
      id,
      tenantId: data.tenant_id,
      name: data.name,
      description: data.description || null,
      frameworkId: null,
      isActive: false,
      connectionId: data.connection_id || null,
      createdBy: data.created_by || null,
      createdAt: now,
      updatedAt: now,
    },
  })

return (await getProfile(id, data.tenant_id))!
}

export async function updateProfile(
  id: string,
  data: { name?: string; description?: string },
  tenantId: string,
): Promise<ComplianceProfile | undefined> {
  const update: Record<string, unknown> = { updatedAt: new Date() }

  if (data.name !== undefined) update.name = data.name
  if (data.description !== undefined) update.description = data.description
  await prisma.complianceProfile.updateMany({ where: { id, tenantId }, data: update })

return getProfile(id, tenantId)
}

export async function updateProfileChecks(
  profileId: string,
  checks: Array<{
    check_id: string
    enabled: boolean
    weight: number
    control_ref?: string
    category?: string
  }>,
  tenantId: string,
): Promise<void> {
  const now = new Date()

  await prisma.$transaction(async tx => {
    await tx.complianceProfileCheck.deleteMany({ where: { profileId, tenantId } })

    if (checks.length > 0) {
      await tx.complianceProfileCheck.createMany({
        data: checks.map(c => ({
          id: crypto.randomUUID(),
          tenantId,
          profileId,
          checkId: c.check_id,
          enabled: !!c.enabled,
          weight: c.weight,
          controlRef: c.control_ref || null,
          category: c.category || null,
        })),
      })
    }

    await tx.complianceProfile.updateMany({ where: { id: profileId, tenantId }, data: { updatedAt: now } })
  })
}

export async function deleteProfile(id: string, tenantId: string): Promise<void> {
  await prisma.complianceProfile.deleteMany({ where: { id, tenantId } })
}

export async function setActiveProfile(profileId: string, connectionId: string | undefined, tenantId: string): Promise<void> {
  await prisma.$transaction(async tx => {
    if (connectionId) {
      await tx.complianceProfile.updateMany({
        where: { tenantId, OR: [{ connectionId }, { connectionId: null }] },
        data: { isActive: false },
      })
    } else {
      await tx.complianceProfile.updateMany({
        where: { tenantId },
        data: { isActive: false },
      })
    }

    await tx.complianceProfile.updateMany({
      where: { id: profileId, tenantId },
      data: { isActive: true },
    })
  })
}

export async function deactivateProfiles(connectionId: string | undefined, tenantId: string): Promise<void> {
  if (connectionId) {
    await prisma.complianceProfile.updateMany({
      where: { tenantId, OR: [{ connectionId }, { connectionId: null }] },
      data: { isActive: false },
    })
  } else {
    await prisma.complianceProfile.updateMany({
      where: { tenantId },
      data: { isActive: false },
    })
  }
}

export async function getActiveProfile(connectionId: string | undefined, tenantId: string): Promise<(ComplianceProfile & { checks: ComplianceProfileCheck[] }) | null> {
  const where: any = { isActive: true, tenantId }

  if (connectionId) {
    where.OR = [{ connectionId }, { connectionId: null }]
  }

  const profile = await prisma.complianceProfile.findFirst({ where })

  if (!profile) return null
  const checks = await getProfileChecks(profile.id, tenantId)


return { ...rowToProfile(profile), checks }
}
