// src/lib/orchestrator/haRoute.ts
//
// Route-level plumbing shared by the /api/v1/ha/* handlers. haProxy.ts owns
// the conversation with the orchestrator; this owns what surrounds it, namely
// the guards and the request body, so the eleven routes cannot drift apart on
// either.

import { NextRequest, NextResponse } from 'next/server'

import { proxyHaJson } from './haProxy'
import { requireFeature } from '@/lib/auth/requireEnterprise'
import { Features } from '@/lib/license/features'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'

/**
 * The two guards every HA write shares: the HA capability, then
 * admin.settings. Returns the rejection to hand back, or null to proceed.
 *
 * The read-only routes (GET /ha/cluster, GET /ha/config) deliberately skip the
 * capability gate and call checkPermission on their own: a lapsed option must
 * never blind the operator of a running cluster (spec v5 D2).
 */
export async function haWriteGuard(): Promise<NextResponse | null> {
  const guard = await requireFeature(Features.HA)
  if (guard) return guard

  return checkPermission(PERMISSIONS.ADMIN_SETTINGS)
}

type WriteMethod = 'POST' | 'PUT' | 'DELETE'

/** Handler for a guarded HA operation that carries no request body. */
export function haOperation(path: string, method: WriteMethod) {
  return async function handler(): Promise<NextResponse> {
    const guard = await haWriteGuard()
    if (guard) return guard

    return proxyHaJson(path, { method })
  }
}

/**
 * Handler for a guarded HA operation that forwards its JSON body upstream. An
 * unreadable body is the caller's fault and answers 400, where the historical
 * blind catch used to blame the orchestrator with a 503.
 */
export function haOperationWithBody(path: string, method: WriteMethod) {
  return async function handler(request: NextRequest): Promise<NextResponse> {
    const guard = await haWriteGuard()
    if (guard) return guard

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    return proxyHaJson(path, { method, body })
  }
}
