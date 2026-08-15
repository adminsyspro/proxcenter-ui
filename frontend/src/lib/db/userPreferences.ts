// src/lib/db/userPreferences.ts
//
// Read/write of the per-user appearance blob stored in `user_preferences`
// (issue #696). Kept next to lib/db/settings.ts, which does the same job for
// tenant-wide settings, so both key/value stores read alike at the call sites.
//
// Everything crossing this module is run through sanitizeAppearance, on write
// because the payload comes from the browser, and on read as well, because a
// row written by another version of the app (or edited by hand) must not be
// able to hand an unusable colour to the server-side render.
//
// Known limitation: the tenant comes from the session at the moment the write
// lands. A save still inside its debounce window when the user switches tenant
// is therefore stored against the tenant they arrived in, not the one they were
// looking at. The window is a few hundred milliseconds and the damage is a
// colour in the wrong place, so it is left as is rather than carried through
// the API as a client-chosen tenant, which would weaken the authorisation.

import { prisma } from '@/lib/db/prisma'
import { sanitizeAppearance } from '@/lib/appearance/schema'

import type { Prisma } from '@prisma/client'

/**
 * The user's stored appearance, or `null` when they have never saved one.
 * The null case matters: it is what tells the client it may seed the store
 * from a cookie left over from before this table existed.
 */
export async function getUserAppearance(
  tenantId: string,
  userId: string,
): Promise<Record<string, unknown> | null> {
  const row = await prisma.userPreference.findUnique({
    where: { tenantId_userId: { tenantId, userId } },
    select: { appearance: true },
  })

  if (!row) return null

  return sanitizeAppearance(row.appearance)
}

/**
 * Merge `appearance` into the user's stored blob and return what is now on
 * record. Merging rather than replacing keeps a client that only knows about
 * some of the keys (an older tab, a partial update) from wiping the rest.
 */
export async function setUserAppearance(
  tenantId: string,
  userId: string,
  appearance: unknown,
): Promise<Record<string, unknown>> {
  const incoming = sanitizeAppearance(appearance)
  const current = (await getUserAppearance(tenantId, userId)) ?? {}
  const merged = { ...current, ...incoming }

  await prisma.userPreference.upsert({
    where: { tenantId_userId: { tenantId, userId } },
    create: { tenantId, userId, appearance: merged as Prisma.InputJsonValue },
    update: { appearance: merged as Prisma.InputJsonValue },
  })

  return merged
}
