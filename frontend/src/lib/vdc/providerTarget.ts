// src/lib/vdc/providerTarget.ts
// A provider administrator deploying into a tenant's vDC (roadmap#65).
//
// The template wizard and the routes it reads normally judge everything on
// the caller's own tenant. A provider deploying for a customer names the
// target vDC explicitly instead, and the routes then apply that tenant's
// rules (VMID range, pool, quota, storages, networks) as if the tenant had
// deployed itself.

import { NextResponse } from 'next/server'

import { getPrincipal } from '@/lib/auth/principal'
import { prisma } from '@/lib/db/prisma'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { DEFAULT_TENANT_ID } from '@/lib/tenant/constants'
import { getTenantInfrastructureScope, type InfraScope } from '@/lib/tenant/infraScope'

import { getVdcScope } from './scope'

export interface ProviderVdcTarget {
  vdcId: string
  vdcName: string
  tenantId: string
  tenantName: string
  connectionId: string
}

// Flat rather than a discriminated union: the project's tsconfig does not
// narrow on `ok`. Exactly one of `target` and `response` is set.
export interface ProviderVdcTargetResult {
  ok: boolean
  target: ProviderVdcTarget | null
  response: Response | null
}

const PROVIDER_ONLY = 'Only a provider administrator can target a tenant vDC.'
const VDC_UNAVAILABLE = 'This vDC does not exist or is disabled.'

/**
 * Authorise a provider caller to act on `vdcId` and resolve its tenant.
 *
 * Judged on the RAW session tenant, never on getCurrentTenantId(): the latter
 * falls back to the provider tenant on a stale JWT or a disabled tenant, which
 * would let a tenant admin pass a provider gate. The caller also needs
 * admin.settings, the right that already lets it manage the vDC itself.
 */
export async function resolveProviderVdcTarget(vdcId: string): Promise<ProviderVdcTargetResult> {
  const principalResult = await getPrincipal()
  const principal = principalResult.ok ? principalResult.principal : undefined
  if (principal?.kind !== 'session' || principal.tenantId !== DEFAULT_TENANT_ID) {
    return { ok: false, target: null, response: NextResponse.json({ error: PROVIDER_ONLY }, { status: 403 }) }
  }

  const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)
  if (denied) return { ok: false, target: null, response: denied }

  const vdc = await prisma.vdc.findUnique({
    where: { id: vdcId },
    select: {
      id: true,
      name: true,
      tenantId: true,
      connectionId: true,
      enabled: true,
      tenant: { select: { name: true, enabled: true } },
    },
  })
  // `enabled` is nullable: only an explicitly enabled vDC is in scope, the
  // same rule getVdcScope applies to the tenant itself.
  if (!vdc || vdc.enabled !== true || !vdc.tenant?.enabled || vdc.tenantId === DEFAULT_TENANT_ID) {
    return { ok: false, target: null, response: NextResponse.json({ error: VDC_UNAVAILABLE }, { status: 404 }) }
  }

  return {
    ok: true,
    response: null,
    target: {
      vdcId: vdc.id,
      vdcName: vdc.name,
      tenantId: vdc.tenantId,
      tenantName: vdc.tenant.name,
      connectionId: vdc.connectionId,
    },
  }
}

/** `tenantId` is null exactly when `response` carries the refusal. */
export interface ScopeTenantResult {
  ok: boolean
  tenantId: string | null
  target: ProviderVdcTarget | null
  response: Response | null
}

/**
 * Tenant whose scope a wizard read route applies: the caller's own, or the
 * tenant of `?targetVdcId=` for an authorised provider. A target on another
 * cluster than the one the route reads is refused, so a vDC id cannot widen
 * what a route returns for an unrelated connection.
 */
export async function resolveScopeTenant(
  req: Request,
  connectionId: string | null,
  currentTenantId: () => Promise<string>,
): Promise<ScopeTenantResult> {
  const targetVdcId = new URL(req.url).searchParams.get('targetVdcId')
  if (!targetVdcId) return { ok: true, tenantId: await currentTenantId(), target: null, response: null }

  const resolved = await resolveProviderVdcTarget(targetVdcId)
  if (!resolved.ok) return { ok: false, tenantId: null, target: null, response: resolved.response }
  if (connectionId && resolved.target.connectionId !== connectionId) {
    return {
      ok: false,
      tenantId: null,
      target: null,
      response: NextResponse.json({ error: 'The target vDC is not on this connection.' }, { status: 400 }),
    }
  }
  return { ok: true, tenantId: resolved.target.tenantId, target: resolved.target, response: null }
}

/**
 * Infrastructure scope a wizard read route masks with. A provider targeting a
 * vDC gets that vDC's slice, whatever the tenant's operating model: the deploy
 * route judges the placement on the vDC scope too. The tenant's whole scope is
 * read (no view context), and it holds a single vDC per connection.
 */
export async function scopeTenantInfrastructure(scopeTenant: { tenantId: string; target: ProviderVdcTarget | null }): Promise<InfraScope> {
  if (!scopeTenant.target) return getTenantInfrastructureScope(scopeTenant.tenantId)
  const vdcScope = await getVdcScope(scopeTenant.tenantId, { ignoreVdcContext: true })
  // Never widen to the provider view: a target tenant is never the provider.
  if (!vdcScope) throw new Error('Tenant vDC scope not resolved')
  return { kind: 'iaas', vdcScope }
}
