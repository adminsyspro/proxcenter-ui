// The Disk I/O chart's latency curve (#881) reads this proxy. It is gated on
// vm.view for the very guest, like the RRD proxy, and never on automation.view.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { callRoute, readJson } from '@/__tests__/setup/route-test'

const getSeriesMock = vi.fn()
const checkPermissionMock = vi.fn()
const resolveRrdScopeMock = vi.fn()

vi.mock('@/lib/orchestrator/client', () => ({
  getOrchestratorClient: () => ({
    getVMDiskLatencySeries: (...args: unknown[]) => getSeriesMock(...args),
  }),
}))

vi.mock('@/lib/rbac', () => ({
  checkPermission: (...args: unknown[]) => checkPermissionMock(...args),
}))

vi.mock('@/lib/rbac/rrdScope', () => ({
  resolveRrdScope: (...args: unknown[]) => resolveRrdScopeMock(...args),
}))

vi.mock('@/lib/tenant', () => ({
  getTenantConnectionIds: vi.fn().mockResolvedValue(new Set<string>(['conn-a'])),
}))

import { GET } from './route'

type Handler = (req: NextRequest, ctx: { params: Promise<{ connectionId: string; vmid: string }> }) => Promise<Response>
const getRoute = (req: Request, ctx: { params: Promise<any> | any }) =>
  (GET as Handler)(new NextRequest(req), { params: Promise.resolve(ctx.params) })

const scope = { permission: 'vm.view', resourceType: 'vm' as const, resourceId: 'conn-a:pve1:qemu:104' }
const series = { step: 60, points: [{ time: 1788878700, disk: 'sata0', storage: 'ZFS-Pool', latency_ms: 0.4, max_ms: 0.4, read_ops: 3, write_ops: 7 }] }

let consoleErrorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  checkPermissionMock.mockReset().mockResolvedValue(null)
  resolveRrdScopeMock.mockReset().mockReturnValue(scope)
  getSeriesMock.mockReset().mockResolvedValue({ data: series })
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  consoleErrorSpy.mockRestore()
})

describe('GET /api/v1/orchestrator/metrics/:connectionId/vms/:vmid/disk-latency', () => {
  it('forwards the window and step and answers the orchestrator payload', async () => {
    const res = await callRoute(getRoute, {
      params: { connectionId: 'conn-a', vmid: '104' },
      searchParams: { node: 'pve1', from: '2026-09-08T14:00:00Z', to: '2026-09-08T15:00:00Z', step: '60.4' },
    })

    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual(series)
    expect(resolveRrdScopeMock).toHaveBeenCalledWith('conn-a', '/nodes/pve1/qemu/104')
    expect(checkPermissionMock).toHaveBeenCalledWith('vm.view', 'vm', 'conn-a:pve1:qemu:104')
    expect(getSeriesMock).toHaveBeenCalledWith('conn-a', '104', { from: '2026-09-08T14:00:00Z', to: '2026-09-08T15:00:00Z', step: 60 })
  })

  it('answers an empty series when the orchestrator has no payload', async () => {
    getSeriesMock.mockResolvedValue({ data: null })

    const res = await callRoute(getRoute, { params: { connectionId: 'conn-a', vmid: '104' }, searchParams: { node: 'pve1' } })

    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({ step: 60, points: [] })
    expect(getSeriesMock).toHaveBeenCalledWith('conn-a', '104', { from: undefined, to: undefined, step: undefined })
  })

  it('refuses a missing node or a non-numeric vmid before touching RBAC', async () => {
    const noNode = await callRoute(getRoute, { params: { connectionId: 'conn-a', vmid: '104' } })
    expect(noNode.status).toBe(400)

    const badVmid = await callRoute(getRoute, { params: { connectionId: 'conn-a', vmid: 'abc' }, searchParams: { node: 'pve1' } })
    expect(badVmid.status).toBe(400)

    expect(checkPermissionMock).not.toHaveBeenCalled()
    expect(getSeriesMock).not.toHaveBeenCalled()
  })

  it('returns the RBAC denial untouched', async () => {
    checkPermissionMock.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))

    const res = await callRoute(getRoute, { params: { connectionId: 'conn-a', vmid: '104' }, searchParams: { node: 'pve1' } })

    expect(res.status).toBe(403)
    expect(getSeriesMock).not.toHaveBeenCalled()
  })

  it('hides a connection outside the tenant as not found', async () => {
    const res = await callRoute(getRoute, { params: { connectionId: 'conn-zzz', vmid: '104' }, searchParams: { node: 'pve1' } })

    expect(res.status).toBe(404)
    expect(getSeriesMock).not.toHaveBeenCalled()
  })

  it('answers 500 with the message when the orchestrator call fails', async () => {
    getSeriesMock.mockRejectedValue(new Error('boom'))

    const res = await callRoute(getRoute, { params: { connectionId: 'conn-a', vmid: '104' }, searchParams: { node: 'pve1' } })

    expect(res.status).toBe(500)
    expect(await readJson(res)).toEqual({ error: 'boom' })
    expect(consoleErrorSpy).toHaveBeenCalled()
  })

  it('stays quiet in the log when the orchestrator is merely unavailable', async () => {
    getSeriesMock.mockRejectedValue(Object.assign(new Error('down'), { code: 'ORCHESTRATOR_UNAVAILABLE' }))

    const res = await callRoute(getRoute, { params: { connectionId: 'conn-a', vmid: '104' }, searchParams: { node: 'pve1' } })

    expect(res.status).toBe(500)
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })
})
