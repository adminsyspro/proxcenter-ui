// The GET handler used to answer [] on any failure. At scale the snapshot
// inventory times out routinely, so the operator was told they had no
// snapshots when the orchestrator had merely timed out. The cluster_id and
// vmid filters were also unreachable because the handler took no request,
// so every screen paid for a cluster-wide inventory.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { callRoute, readJson, deniedPermissionResponse } from '@/__tests__/setup/route-test'

const listMirrorSnapshotsMock = vi.fn()
const deleteMirrorSnapshotsMock = vi.fn()
const checkPermissionMock = vi.fn()

vi.mock('@/lib/orchestrator/client', () => ({
  getOrchestratorClient: () => ({
    listMirrorSnapshots: (...args: unknown[]) => listMirrorSnapshotsMock(...args),
    deleteMirrorSnapshots: (...args: unknown[]) => deleteMirrorSnapshotsMock(...args),
  }),
}))

vi.mock('@/lib/rbac', () => ({
  checkPermission: (...args: unknown[]) => checkPermissionMock(...args),
  PERMISSIONS: {
    AUTOMATION_VIEW: 'automation.view',
    AUTOMATION_MANAGE: 'automation.manage',
  },
}))

vi.mock('@/lib/tenant', () => ({
  getTenantConnectionIds: vi.fn().mockResolvedValue(new Set<string>(['conn-a', 'conn-b'])),
}))

import { GET, POST } from './route'

// The handlers are typed on NextRequest (GET reads request.nextUrl); callRoute
// builds a plain Request, so wrap it into a NextRequest before handing it over.
type Handler = (req: NextRequest) => Promise<Response>
const asNextRequest = (handler: Handler) => (req: Request) => handler(new NextRequest(req))
const getRoute = asNextRequest(GET)
const postRoute = asNextRequest(POST)

const fakeSnapshots = [
  { cluster_id: 'conn-a', snapshot: 's1' },
  { cluster_id: 'conn-zzz', snapshot: 's2' },
  { snapshot: 's3' },
]

let consoleErrorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  checkPermissionMock.mockReset().mockResolvedValue(null)
  listMirrorSnapshotsMock.mockReset().mockResolvedValue({ data: fakeSnapshots })
  deleteMirrorSnapshotsMock.mockReset().mockResolvedValue({ data: { deleted: [], failed: [] } })
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  consoleErrorSpy.mockRestore()
})

describe('GET /api/v1/orchestrator/replication/snapshots', () => {
  it('returns the tenant-scoped snapshots passthrough on 200', async () => {
    const res = await callRoute(getRoute)
    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual([
      { cluster_id: 'conn-a', snapshot: 's1' },
      { snapshot: 's3' },
    ])
    expect(listMirrorSnapshotsMock).toHaveBeenCalledWith({ clusterId: undefined, vmid: undefined })
  })

  it('forwards the cluster_id and vmid filters to the orchestrator', async () => {
    const res = await callRoute(getRoute, { searchParams: { cluster_id: 'conn-a', vmid: '100' } })
    expect(res.status).toBe(200)
    expect(listMirrorSnapshotsMock).toHaveBeenCalledWith({ clusterId: 'conn-a', vmid: 100 })
  })

  it('drops a non numeric vmid instead of forwarding it', async () => {
    const res = await callRoute(getRoute, { searchParams: { vmid: 'abc' } })
    expect(res.status).toBe(200)
    expect(listMirrorSnapshotsMock).toHaveBeenCalledWith({ clusterId: undefined, vmid: undefined })
  })

  it('returns an empty array when the orchestrator data is not an array', async () => {
    listMirrorSnapshotsMock.mockResolvedValue({ data: null })
    const res = await callRoute(getRoute)
    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual([])
  })

  it('returns denied response when permission check fails', async () => {
    checkPermissionMock.mockResolvedValue(deniedPermissionResponse())
    const res = await callRoute(getRoute)
    expect(res.status).toBe(403)
    expect(listMirrorSnapshotsMock).not.toHaveBeenCalled()
  })

  it('returns a 502 without logging when the orchestrator is unavailable', async () => {
    const err: any = new Error('Orchestrator unavailable')
    err.code = 'ORCHESTRATOR_UNAVAILABLE'
    listMirrorSnapshotsMock.mockRejectedValue(err)
    const res = await callRoute(getRoute)
    expect(res.status).toBe(502)
    expect(await readJson(res)).toEqual({ error: 'Orchestrator unavailable' })
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })

  it('returns a 502 with the error message and logs on an unexpected failure', async () => {
    listMirrorSnapshotsMock.mockRejectedValue(new Error('boom'))
    const res = await callRoute(getRoute)
    expect(res.status).toBe(502)
    expect(await readJson(res)).toEqual({ error: 'boom' })
    expect(consoleErrorSpy).toHaveBeenCalled()
  })

  it('returns a 502 with a generic message when the failure has no message', async () => {
    listMirrorSnapshotsMock.mockRejectedValue({})
    const res = await callRoute(getRoute)
    expect(res.status).toBe(502)
    expect(await readJson(res)).toEqual({ error: 'Failed to list snapshots' })
  })
})

describe('POST /api/v1/orchestrator/replication/snapshots', () => {
  const ownedItem = { cluster_id: 'conn-a', pool: 'rbd', image: 'vm-100-disk-0', snapshot: 's1' }
  const foreignItem = { cluster_id: 'conn-zzz', pool: 'rbd', image: 'vm-200-disk-0', snapshot: 's2' }

  it('returns 400 when items is empty', async () => {
    const res = await callRoute(postRoute, { body: { items: [] } })
    expect(res.status).toBe(400)
    expect(await readJson(res)).toEqual({ error: 'items is required' })
    expect(deleteMirrorSnapshotsMock).not.toHaveBeenCalled()
  })

  it('returns an empty result without calling the orchestrator when every item is foreign', async () => {
    const res = await callRoute(postRoute, { body: { items: [foreignItem] } })
    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({ deleted: [], failed: [] })
    expect(deleteMirrorSnapshotsMock).not.toHaveBeenCalled()
  })

  it('forwards only the tenant-owned items and returns the orchestrator response', async () => {
    const result = { deleted: [ownedItem], failed: [] }
    deleteMirrorSnapshotsMock.mockResolvedValue({ data: result })
    const res = await callRoute(postRoute, { body: { items: [ownedItem, foreignItem] } })
    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual(result)
    expect(deleteMirrorSnapshotsMock).toHaveBeenCalledWith([ownedItem])
  })

  it('returns denied response when permission check fails', async () => {
    checkPermissionMock.mockResolvedValue(deniedPermissionResponse())
    const res = await callRoute(postRoute, { body: { items: [ownedItem] } })
    expect(res.status).toBe(403)
    expect(deleteMirrorSnapshotsMock).not.toHaveBeenCalled()
  })

  it('returns a 500 with the error message when the orchestrator call fails', async () => {
    deleteMirrorSnapshotsMock.mockRejectedValue(new Error('boom'))
    const res = await callRoute(postRoute, { body: { items: [ownedItem] } })
    expect(res.status).toBe(500)
    expect(await readJson(res)).toEqual({ error: 'boom' })
  })
})
