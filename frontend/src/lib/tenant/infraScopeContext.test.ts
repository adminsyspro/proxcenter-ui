/**
 * Plumbing tests: getTenantInfrastructureScope forwards ignoreVdcContext to
 * getVdcScope (iaas branch); the msp branch never consults getVdcScope.
 * Run: npx vitest run --config vitest.unit.config.ts src/lib/tenant/infraScopeContext.test.ts
 *
 * Note: unlike the Task-2 brief draft, DEFAULT_TENANT_ID is NOT mocked here.
 * infraScope.ts imports it from './constants' (a client-safe, side-effect-
 * free module — see infraScope.test.ts, which mocks the same way), not from
 * '@/lib/tenant'. Since these tests only exercise tenantId 't1' (never the
 * default tenant), the real constant is used as-is.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getVdcScopeMock, tenantFindUniqueMock, connectionFindManyMock } = vi.hoisted(() => ({
  getVdcScopeMock: vi.fn(),
  tenantFindUniqueMock: vi.fn(),
  connectionFindManyMock: vi.fn(),
}))

vi.mock('@/lib/vdc/scope', () => ({ getVdcScope: getVdcScopeMock }))
vi.mock('@/lib/db/prisma', () => ({
  prisma: { tenant: { findUnique: tenantFindUniqueMock }, connection: { findMany: connectionFindManyMock } },
}))

import { getTenantInfrastructureScope } from './infraScope'

beforeEach(() => {
  vi.clearAllMocks()
  tenantFindUniqueMock.mockResolvedValue({ operatingModel: 'iaas' })
  getVdcScopeMock.mockResolvedValue({ connectionIds: new Set() })
})

describe('getTenantInfrastructureScope context plumbing', () => {
  it('iaas branch forwards ignoreVdcContext to getVdcScope', async () => {
    await getTenantInfrastructureScope('t1', { ignoreVdcContext: true })
    expect(getVdcScopeMock).toHaveBeenCalledWith('t1', { ignoreVdcContext: true })
  })

  it('iaas branch without opts keeps the default (context-narrowed) path', async () => {
    await getTenantInfrastructureScope('t1')
    expect(getVdcScopeMock).toHaveBeenCalledWith('t1', undefined)
  })

  it('msp branch never calls getVdcScope', async () => {
    tenantFindUniqueMock.mockResolvedValue({ operatingModel: 'msp' })
    connectionFindManyMock.mockResolvedValue([{ id: 'c1' }])
    const scope = await getTenantInfrastructureScope('t1', { ignoreVdcContext: true })
    expect(scope.kind).toBe('msp')
    expect(getVdcScopeMock).not.toHaveBeenCalled()
  })
})
