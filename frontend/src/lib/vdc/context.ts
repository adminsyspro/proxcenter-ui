// src/lib/vdc/context.ts
// Server-side read + validation of the vDC context cookie. The cookie is a
// VIEW FILTER, not a security boundary: it can only restrict the union scope
// the tenant is already authorized for. Every anomaly fails open to null
// (= union of the tenant's vDCs), never throws.

import { cookies } from 'next/headers'

import { prisma } from '@/lib/db/prisma'
import { DEFAULT_TENANT_ID } from '@/lib/tenant'

import { VDC_CONTEXT_COOKIE } from './contextCookie'

export { VDC_CONTEXT_COOKIE }

// 5s TTL memo of the validation query — getVdcScope resolves the context on
// every call and several routes resolve the scope more than once per
// request. Same staleness window as the scope cache safety net.
const validationCache = new Map<string, { value: string | null; expiry: number }>()
const VALIDATION_TTL_MS = 5_000

/** Purges the memoized cookie validations (all tenants when omitted). */
export function clearVdcContextCache(tenantId?: string): void {
  if (tenantId) {
    const prefix = `${tenantId}::`
    for (const key of validationCache.keys()) {
      if (key.startsWith(prefix)) validationCache.delete(key)
    }
  } else {
    validationCache.clear()
  }
}

/**
 * Resolves the active vDC context for a tenant, or null for the union view.
 * null when: provider tenant, no cookie, cookie outside a request scope
 * (background jobs), or the vdcId doesn't belong to the tenant / is disabled.
 */
export async function getVdcContext(tenantId: string): Promise<string | null> {
  if (tenantId === DEFAULT_TENANT_ID) return null

  let raw: string | undefined
  try {
    const cookieStore = await cookies()
    raw = cookieStore.get(VDC_CONTEXT_COOKIE)?.value
  } catch {
    // cookies() throws outside a request scope (jobs, tests) → union.
    return null
  }
  if (!raw) return null

  const key = `${tenantId}::${raw}`
  const now = Date.now()
  const cached = validationCache.get(key)
  if (cached && cached.expiry > now) return cached.value

  let vdc: { id: string } | null = null
  try {
    vdc = await prisma.vdc.findFirst({
      where: { id: raw, tenantId, enabled: true },
      select: { id: true },
    })
  } catch {
    // DB hiccup while validating a view filter → union view, not a 500.
    return null
  }

  const value = vdc?.id ?? null
  validationCache.set(key, { value, expiry: now + VALIDATION_TTL_MS })
  return value
}
