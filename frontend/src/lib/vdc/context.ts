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

  return vdc?.id ?? null
}
