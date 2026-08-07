/**
 * Context-keying tests for the alerts VMID cache (60s TTL). Same contract as
 * the scope cache: one entry per (tenant, vDC context), tenant-prefix purge.
 * Run: npx vitest run --config vitest.unit.config.ts src/lib/alerts/vdcVmidsContext.test.ts
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getVdcScopeMock, getVdcContextMock } = vi.hoisted(() => ({
  getVdcScopeMock: vi.fn(),
  getVdcContextMock: vi.fn(),
}))

vi.mock('@/lib/vdc/scope', () => ({ getVdcScope: getVdcScopeMock }))
vi.mock('@/lib/vdc/context', () => ({ getVdcContext: getVdcContextMock }))

import { clearVdcVmidsCache, getVdcVmidsByConnection } from './vdcVmids'

const scopeWithPools = (pools: Record<string, string[]>) => ({
  poolsByConnection: new Map(Object.entries(pools).map(([k, v]) => [k, new Set(v)])),
}) as any

beforeEach(() => {
  vi.clearAllMocks()
  clearVdcVmidsCache()
  getVdcContextMock.mockResolvedValue(null)
  // The pool→VMID resolution goes through pveFetch inside the module; an
  // empty poolsByConnection map short-circuits before any PVE call.
  getVdcScopeMock.mockResolvedValue(scopeWithPools({}))
})

describe('vdcVmids cache context keying', () => {
  it('warms one entry per (tenant, context) — no cross-serving', async () => {
    getVdcContextMock.mockResolvedValueOnce('vA')
    await getVdcVmidsByConnection('t1') // warm t1::vA
    getVdcContextMock.mockResolvedValueOnce(null)
    await getVdcVmidsByConnection('t1') // warm t1::all — must NOT hit t1::vA
    expect(getVdcScopeMock).toHaveBeenCalledTimes(2)
  })

  it('same context twice → served from cache (1 scope resolution)', async () => {
    getVdcContextMock.mockResolvedValue('vA')
    await getVdcVmidsByConnection('t1')
    await getVdcVmidsByConnection('t1')
    expect(getVdcScopeMock).toHaveBeenCalledTimes(1)
  })

  it('clearVdcVmidsCache(tenantId) purges every context of the tenant', async () => {
    getVdcContextMock.mockResolvedValueOnce('vA')
    await getVdcVmidsByConnection('t1')
    clearVdcVmidsCache('t1')
    getVdcContextMock.mockResolvedValueOnce('vA')
    await getVdcVmidsByConnection('t1')
    expect(getVdcScopeMock).toHaveBeenCalledTimes(2)
  })

  it('ignoreVdcContext resolves the union entry and skips the cookie read', async () => {
    await getVdcVmidsByConnection('t1', { ignoreVdcContext: true })
    expect(getVdcContextMock).not.toHaveBeenCalled()
    expect(getVdcScopeMock).toHaveBeenCalledWith('t1', { ignoreVdcContext: true })
  })
})
