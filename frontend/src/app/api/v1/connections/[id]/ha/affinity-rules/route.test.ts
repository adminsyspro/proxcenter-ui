import { describe, it, expect, vi, beforeEach } from 'vitest'

// The API token guard is covered by routeGuard.test.ts and writeContract.test.ts:
// pass-through so this file keeps testing the handler, as for a session caller.
vi.mock('@/lib/api-tokens/routeGuard', () => ({
  withPublicApiGuard: (_entryId: string, handler: any) => handler,
}))

import { callRoute, readJson } from '@/__tests__/setup/route-test'

vi.mock('@/lib/rbac', () => ({
  checkPermission: vi.fn<(...args: any[]) => Promise<Response | null>>(),
  PERMISSIONS: {
    CONNECTION_VIEW: 'connection.view',
    CONNECTION_MANAGE: 'connection.manage',
  },
}))

vi.mock('@/lib/connections/getConnection', () => ({
  getConnectionById: vi.fn<(id: string) => Promise<any>>(),
}))

vi.mock('@/lib/proxmox/client', () => ({
  pveFetch: vi.fn<(...args: any[]) => Promise<any>>(),
}))

vi.mock('@/lib/audit', () => ({ audit: vi.fn() }))

import { POST } from './route'
import { checkPermission } from '@/lib/rbac'
import { getConnectionById } from '@/lib/connections/getConnection'
import { pveFetch } from '@/lib/proxmox/client'

const checkPermissionMock = checkPermission as any
const getConnectionByIdMock = getConnectionById as any
const pveFetchMock = pveFetch as any

beforeEach(() => {
  vi.clearAllMocks()
  checkPermissionMock.mockResolvedValue(null)
  getConnectionByIdMock.mockResolvedValue({ id: 'conn-1' })
  pveFetchMock.mockResolvedValue(null)
})

describe('POST /api/v1/connections/[id]/ha/affinity-rules', () => {
  const call = (body: Record<string, unknown>) => callRoute(POST as any, { params: { id: 'conn-1' }, body })

  it('400 "Rule type is required (node-affinity or resource-affinity)"', async () => {
    const res = await call({ rule: "keep-db" })
    expect(res.status).toBe(400)
    expect((await readJson<any>(res)).error).toBe('Rule type is required (node-affinity or resource-affinity)')
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('400 "Rule name is required"', async () => {
    const res = await call({ type: "resource-affinity" })
    expect(res.status).toBe(400)
    expect((await readJson<any>(res)).error).toBe('Rule name is required')
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('200 "HA affinity rule created"', async () => {
    const res = await call({ type: "node-affinity", rule: "keep-db", nodes: "pve1" })
    expect(res.status).toBe(200)
    expect((await readJson<any>(res)).message).toBe('HA affinity rule created')
  })
})
