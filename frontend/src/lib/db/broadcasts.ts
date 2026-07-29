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
  // No pre-read: a findUnique-then-update leaves a window where a concurrent
  // delete (two provider super-admins editing the same banner is ordinary)
  // makes the update throw P2025 instead of returning the contract's null.
  // One call, and only the missing-record error is swallowed.
  try {
    return await prisma.broadcastMessage.update({ where: { id }, data: input })
  } catch (error) {
    if ((error as { code?: string }).code === 'P2025') return null
    throw error
  }
}

export async function deleteBroadcast(id: string): Promise<boolean> {
  // No pre-read for the same reason as updateBroadcast: deleteMany never
  // throws on a missing row, so there is no existence-check race at all.
  const { count } = await prisma.broadcastMessage.deleteMany({ where: { id } })
  return count > 0
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
