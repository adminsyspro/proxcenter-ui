// src/lib/db/broadcasts.ts
//
// Data access for broadcast banners (#607). Targeting is decided by
// lib/broadcast/targeting.ts; this module only loads rows and shapes the
// public payload.

import type { BroadcastMessage } from '@prisma/client'

import { prisma } from '@/lib/db/prisma'
import { matchesPrincipal, type BroadcastPrincipal } from '@/lib/broadcast/targeting'
import type { BroadcastInput, PublicBroadcast } from '@/lib/broadcast/types'

export type { BroadcastInput, PublicBroadcast }

export async function listBroadcasts(): Promise<BroadcastMessage[]> {
  return prisma.broadcastMessage.findMany({ orderBy: { createdAt: 'asc' } })
}

export async function createBroadcast(input: BroadcastInput, createdBy: string): Promise<BroadcastMessage> {
  return prisma.broadcastMessage.create({ data: { ...input, createdBy } })
}

export async function updateBroadcast(id: string, input: BroadcastInput): Promise<BroadcastMessage | null> {
  const existing = await prisma.broadcastMessage.findUnique({ where: { id }, select: { id: true } })
  if (!existing) return null
  return prisma.broadcastMessage.update({ where: { id }, data: input })
}

export async function deleteBroadcast(id: string): Promise<boolean> {
  const existing = await prisma.broadcastMessage.findUnique({ where: { id }, select: { id: true } })
  if (!existing) return false
  await prisma.broadcastMessage.delete({ where: { id } })
  return true
}

/**
 * Role ids granted to the user IN THE CURRENT TENANT, expired grants
 * excluded. The expiry clause mirrors activeGrantFilter() in
 * src/lib/rbac/index.ts:41-45, which is module-private there.
 */
export async function resolvePrincipalRoles(
  userId: string,
  tenantId: string,
): Promise<{ roleIds: string[]; legacyRole: string | null }> {
  const [grants, user] = await Promise.all([
    prisma.rbacUserRole.findMany({
      where: {
        userId,
        tenantId,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      select: { roleId: true },
    }),
    prisma.user.findUnique({ where: { id: userId }, select: { role: true } }),
  ])

  return { roleIds: grants.map(g => g.roleId), legacyRole: user?.role ?? null }
}

function toPublic(row: BroadcastMessage): PublicBroadcast {
  return {
    id: row.id,
    message: row.message,
    linkUrl: row.linkUrl,
    linkLabel: row.linkLabel,
    bgColor: row.bgColor,
    fgColor: row.fgColor,
    dismissible: row.dismissible,
    updatedAt: row.updatedAt.toISOString(),
  }
}

export async function listActiveForPrincipal(
  principal: BroadcastPrincipal,
  now: Date,
): Promise<PublicBroadcast[]> {
  // The window bounds are filtered in SQL to keep the scan small; the
  // per-principal decision stays in the pure targeting module.
  const rows = await prisma.broadcastMessage.findMany({
    where: {
      enabled: true,
      AND: [
        { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
        { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
      ],
    },
    orderBy: { createdAt: 'asc' },
  })

  return rows.filter(row => matchesPrincipal(row, principal, now)).map(toPublic)
}
