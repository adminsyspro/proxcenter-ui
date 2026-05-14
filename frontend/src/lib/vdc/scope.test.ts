/**
 * Tenant isolation contract for `getVdcScope`.
 *
 * Locks the post-v1.4.0 contract:
 *   - DEFAULT_TENANT_ID (provider) returns `null` (no filtering)
 *   - any other tenant returns a VdcScope object, even when the tenant
 *     has zero enabled vDCs — in that case the Sets/Maps are empty and
 *     downstream filters deny by construction
 *
 * The regression that motivated this suite was an external audit
 * finding: `buildVdcScope` used to return `null` whenever a tenant had
 * no vDCs, which `applyVdcFilter`, `assertVdcPbsAccess`,
 * `getAllowedJobPools`, and the inventory routes interpreted as
 * "I am the provider, no filtering". A non-provider tenant with zero
 * vDCs therefore briefly saw every cluster, every PBS namespace, and
 * every cluster-wide backup job. This file pins the new contract so
 * any future `return null` slip on the tenant path fails here.
 */

import { afterAll, afterEach, describe, expect, it } from 'vitest'

import { clearVdcScopeCache, getVdcScope } from './scope'
import { prismaTest } from '@/__tests__/setup/prisma-test'

const PROVIDER = 'default'
const TENANT_NO_VDC = 'tenant-without-any-vdc'

afterEach(() => {
  // The 5s in-memory cache would otherwise leak between cases.
  clearVdcScopeCache()
})

afterAll(async () => {
  await prismaTest.$disconnect()
})

describe('getVdcScope — provider', () => {
  it('returns null for the default tenant (no filtering)', async () => {
    const scope = await getVdcScope(PROVIDER)

    expect(scope).toBeNull()
  })
})

describe('getVdcScope — tenant without any vDC', () => {
  it('returns a non-null VdcScope with empty Sets and Maps', async () => {
    const scope = await getVdcScope(TENANT_NO_VDC)

    expect(scope).not.toBeNull()
    expect(scope!.connectionIds.size).toBe(0)
    expect(scope!.pbsConnectionIds.size).toBe(0)
    expect(scope!.nodesByConnection.size).toBe(0)
    expect(scope!.storagesByConnection.size).toBe(0)
    expect(scope!.poolsByConnection.size).toBe(0)
    expect(scope!.vnetsByConnection.size).toBe(0)
    expect(scope!.sharedBridgesByConnection.size).toBe(0)
    expect(scope!.pbsNamespacesByConnection.size).toBe(0)
    expect(scope!.pbsNamespacesByPveConnection.size).toBe(0)
  })

  it('makes downstream Set lookups deny: a random connection id maps to undefined', async () => {
    const scope = await getVdcScope(TENANT_NO_VDC)

    expect(scope).not.toBeNull()

    // Pattern used by inventory route + applyVdcFilter + assertVdcPbsAccess
    expect(scope!.connectionIds.has('conn-anything')).toBe(false)
    expect(scope!.nodesByConnection.get('conn-anything')).toBeUndefined()
    expect(scope!.poolsByConnection.get('conn-anything')).toBeUndefined()
    expect(scope!.storagesByConnection.get('conn-anything')).toBeUndefined()
    expect(scope!.pbsNamespacesByConnection.get('conn-anything')).toBeUndefined()
  })
})
