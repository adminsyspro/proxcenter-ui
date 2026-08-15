// src/lib/appearance/server.ts
//
// Server-side read of the stored appearance, used while rendering (issue #696).
// Reading it on the server rather than fetching it after hydration is the whole
// point: the palette is baked into the first HTML, so a user whose colour is
// restored from the database never sees a frame of the default orange.
//
// Wrapped in React's `cache` so the root layout, the dashboard layout and
// Providers, which all ask for the mode during a single render, share one
// query.

import 'server-only'

import { cache } from 'react'

import { getServerSession } from 'next-auth'

import { authOptions } from '@/lib/auth/config'
import { getUserAppearance } from '@/lib/db/userPreferences'

export type AppearanceHydration = {
  /** There is a session, so the browser is allowed to save its appearance. */
  authenticated: boolean
  /** The signed-in user, used to tell whose settings a shared browser holds. */
  userId: string | null
  /** The stored blob, or `null` when this user has never saved one. */
  stored: Record<string, unknown> | null
}

const ANONYMOUS: AppearanceHydration = { authenticated: false, userId: null, stored: null }

/**
 * What the current request knows about the user's appearance. Never throws:
 * appearance is cosmetic, and taking a layout down over it, or over a database
 * blip, would be a poor trade.
 */
export const getAppearanceHydration = cache(async (): Promise<AppearanceHydration> => {
  try {
    const session = await getServerSession(authOptions)
    const userId = session?.user?.id

    if (!userId) return ANONYMOUS

    const stored = await getUserAppearance(session.user.tenantId || 'default', userId)

    return { authenticated: true, userId, stored }
  } catch {
    return ANONYMOUS
  }
})

/** The stored appearance alone, for callers that only need to merge it. */
export const getStoredAppearance = async (): Promise<Record<string, unknown> | null> =>
  (await getAppearanceHydration()).stored
