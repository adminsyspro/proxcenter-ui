import { describe, it, expect, vi, beforeEach } from 'vitest'

const pveFetchMock = vi.fn<(...args: any[]) => Promise<any>>()
const checkPermissionMock = vi.fn<(...args: any[]) => Promise<Response | null>>()
const getRBACContextMock = vi.fn<() => Promise<any>>()
const filterVmsByPermissionMock = vi.fn<(...args: any[]) => Promise<any[]>>()
const sessionGuestVisibilityMock = vi.fn<(...args: any[]) => Promise<any>>()

vi.mock('@/lib/proxmox/client', () => ({ pveFetch: pveFetchMock }))
vi.mock('@/lib/rbac', () => ({
  checkPermission: checkPermissionMock,
  getRBACContext: getRBACContextMock,
  filterVmsByPermission: filterVmsByPermissionMock,
  PERMISSIONS: { CONNECTION_MANAGE: 'connection.manage', VM_VIEW: 'vm.view' },
}))
vi.mock('@/lib/vdc/guestGuard', () => ({ sessionGuestVisibility: sessionGuestVisibilityMock }))

const { enforceGuestTagAccess, loadTagPolicy, visibleGuests } = await import('./tagAccessServer')

const conn = { id: 'conn-1' } as any
const denied = () => new Response(null, { status: 403 })
const EVERY_GUEST = { has: () => true }

let options: Record<string, unknown> = {}
let resources: any[] = []

beforeEach(() => {
  options = {}
  resources = [
    { type: 'qemu', vmid: 100, node: 'pve1', tags: 'web;db' },
    { type: 'lxc', vmid: 101, node: 'pve1', tags: 'other' },
    { type: 'node', node: 'pve1' },
  ]
  pveFetchMock.mockReset().mockImplementation(async (_c, path: string) => {
    if (path === '/cluster/options') return options
    if (path.startsWith('/cluster/resources')) return resources
    throw new Error(`unexpected ${path}`)
  })
  checkPermissionMock.mockReset().mockResolvedValue(denied())
  getRBACContextMock.mockReset().mockResolvedValue({ userId: 'u1', isAdmin: false, tenantId: 'default', principal: { kind: 'user', userId: 'u1' } })
  filterVmsByPermissionMock.mockReset().mockImplementation(async (_p, vms) => vms)
  sessionGuestVisibilityMock.mockReset().mockResolvedValue({ ok: true, visibility: EVERY_GUEST })
})

describe('enforceGuestTagAccess', () => {
  it('never reads PVE when the tags do not change', async () => {
    expect(await enforceGuestTagAccess({ connId: 'conn-1', conn, oldTags: 'a;b', newTags: 'b;a' })).toBeNull()
    expect(pveFetchMock).not.toHaveBeenCalled()
    expect(checkPermissionMock).not.toHaveBeenCalled()
  })

  it('lets a user who manages the connection through without reading the options', async () => {
    checkPermissionMock.mockResolvedValue(null)
    options = { 'user-tag-access': { 'user-allow': 'none' } }

    expect(await enforceGuestTagAccess({ connId: 'conn-1', conn, oldTags: '', newTags: 'x' })).toBeNull()
    expect(checkPermissionMock).toHaveBeenCalledWith('connection.manage', 'connection', 'conn-1')
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('403s a change in none mode with the tag and a stable code', async () => {
    options = { 'user-tag-access': { 'user-allow': 'none' } }

    const res = await enforceGuestTagAccess({ connId: 'conn-1', conn, oldTags: '', newTags: 'x' })
    expect(res?.status).toBe(403)
    expect(await res?.json()).toEqual({
      error: "Tag 'x' is not allowed by the datacenter User Tag Access setting (none)",
      code: 'TAG_ACCESS_DENIED',
      tag: 'x',
    })
  })

  it('403s a registered tag even in free mode', async () => {
    options = { 'registered-tags': ['reserved'] }

    const res = await enforceGuestTagAccess({ connId: 'conn-1', conn, oldTags: '', newTags: 'reserved' })
    expect(res?.status).toBe(403)
    expect((await res?.json()).error).toMatch(/registered tag/)
  })

  it('lets a free-mode change through without listing the guests', async () => {
    expect(await enforceGuestTagAccess({ connId: 'conn-1', conn, oldTags: '', newTags: 'brand-new' })).toBeNull()
    expect(pveFetchMock).not.toHaveBeenCalledWith(conn, expect.stringMatching(/^\/cluster\/resources/))
  })

  it('existing mode allows a tag already on a visible guest and refuses a new one', async () => {
    options = { 'user-tag-access': { 'user-allow': 'existing' } }

    expect(await enforceGuestTagAccess({ connId: 'conn-1', conn, oldTags: '', newTags: 'web' })).toBeNull()
    expect((await enforceGuestTagAccess({ connId: 'conn-1', conn, oldTags: '', newTags: 'brand-new' }))?.status).toBe(403)
  })

  it('existing mode does not count the tags of guests the user cannot see', async () => {
    options = { 'user-tag-access': { 'user-allow': 'existing' } }
    filterVmsByPermissionMock.mockImplementation(async (_p, vms) => vms.filter((v: any) => v.vmid === '100'))

    const res = await enforceGuestTagAccess({ connId: 'conn-1', conn, oldTags: '', newTags: 'other' })
    expect(res?.status).toBe(403)
  })
})

describe('visibleGuests', () => {
  it('keeps guests only and applies the vDC visibility', async () => {
    sessionGuestVisibilityMock.mockResolvedValue({ ok: true, visibility: { has: (_t: string, vmid: number) => vmid === 101 } })

    const guests = await visibleGuests('conn-1', conn)
    expect(guests.map(g => g.vmid)).toEqual(['101'])
  })

  it('returns every guest to a super admin without filtering by grant', async () => {
    getRBACContextMock.mockResolvedValue({ userId: 'u1', isAdmin: true, tenantId: 'default' })

    expect((await visibleGuests('conn-1', conn)).length).toBe(2)
    expect(filterVmsByPermissionMock).not.toHaveBeenCalled()
  })

  it('returns nothing when the vDC visibility cannot be decided', async () => {
    sessionGuestVisibilityMock.mockResolvedValue({ ok: false, response: denied() })

    expect(await visibleGuests('conn-1', conn)).toEqual([])
  })

  it('returns nothing without a session', async () => {
    getRBACContextMock.mockResolvedValue(null)

    expect(await visibleGuests('conn-1', conn)).toEqual([])
  })
})

describe('loadTagPolicy', () => {
  it('reads the guests when asked even if the mode does not need them', async () => {
    options = { 'user-tag-access': { 'user-allow': 'list', 'user-allow-list': ['ok'] } }

    const { policy, visibleGuestCount } = await loadTagPolicy('conn-1', conn, { guestTags: 'always' })
    expect(visibleGuestCount).toBe(2)
    expect([...policy.allowed]).toEqual(['ok'])
    expect([...policy.guestTags].sort((a, b) => a.localeCompare(b))).toEqual(['db', 'other', 'web'])
  })

  it('skips the guests when they are not needed', async () => {
    const { visibleGuestCount } = await loadTagPolicy('conn-1', conn, { guestTags: 'when-needed' })
    expect(visibleGuestCount).toBeNull()
  })
})
