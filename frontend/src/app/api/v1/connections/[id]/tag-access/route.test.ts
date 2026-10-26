import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'
import { buildTagPolicy } from '@/lib/proxmox/tagAccess'

const checkPermissionMock = vi.fn<(...args: any[]) => Promise<Response | null>>()
const loadTagPolicyMock = vi.fn<(...args: any[]) => Promise<any>>()

vi.mock('@/lib/rbac', () => ({
  checkPermission: checkPermissionMock,
  PERMISSIONS: { VM_VIEW: 'vm.view' },
}))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: vi.fn(async () => ({ id: 'conn-1' })) }))
vi.mock('@/lib/proxmox/tagAccessServer', () => ({ loadTagPolicy: loadTagPolicyMock }))

const { GET } = await import('./route')
const params = { id: 'conn-1' }

const withPolicy = (privileged: boolean, visibleGuestCount: number) => loadTagPolicyMock.mockResolvedValue({
  policy: buildTagPolicy({ userAllow: 'existing', allowList: ['ok'], registered: ['reg', 'reg-elsewhere'] }, privileged, ['web', 'reg']),
  visibleGuestCount,
})

beforeEach(() => {
  checkPermissionMock.mockReset().mockResolvedValue(null)
  loadTagPolicyMock.mockReset()
})

describe('GET /api/v1/connections/[id]/tag-access', () => {
  it('describes what a regular user may do, naming only the registered tags on visible guests', async () => {
    withPolicy(false, 3)

    const res = await callRoute(GET as any, { params })
    expect(res.status).toBe(200)
    expect((await readJson<any>(res)).data).toEqual({
      userAllow: 'existing',
      privileged: false,
      freeform: false,
      allowedTags: ['ok', 'web'],
      lockedTags: ['reg'],
    })
    expect(loadTagPolicyMock).toHaveBeenCalledWith('conn-1', { id: 'conn-1' }, { guestTags: 'always' })
  })

  it('lists every tag and locks none for a user who manages the connection', async () => {
    withPolicy(true, 3)

    const { data } = await readJson<any>(await callRoute(GET as any, { params }))
    expect(data.privileged).toBe(true)
    expect(data.allowedTags).toEqual(['ok', 'reg', 'reg-elsewhere', 'web'])
    expect(data.lockedTags).toEqual([])
  })

  it('names no tag to a user who sees no guest on the connection', async () => {
    withPolicy(false, 0)

    const { data } = await readJson<any>(await callRoute(GET as any, { params }))
    expect(data.allowedTags).toEqual([])
  })

  it('answers the permission refusal as is', async () => {
    checkPermissionMock.mockResolvedValue(new Response(JSON.stringify({ error: 'no' }), { status: 403 }))

    const res = await callRoute(GET as any, { params })
    expect(res.status).toBe(403)
    expect(loadTagPolicyMock).not.toHaveBeenCalled()
  })

  it('500s with the error message when PVE cannot be read', async () => {
    loadTagPolicyMock.mockRejectedValue(new Error('PVE 500 /cluster/options'))

    const res = await callRoute(GET as any, { params })
    expect(res.status).toBe(500)
    expect((await readJson<any>(res)).error).toBe('PVE 500 /cluster/options')
  })
})
