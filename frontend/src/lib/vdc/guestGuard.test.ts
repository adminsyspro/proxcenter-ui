import { describe, it, expect, vi, beforeEach } from 'vitest'

const { pveFetchMock, getTenantInfrastructureScopeMock, getCurrentTenantIdMock } = vi.hoisted(() => ({
  pveFetchMock: vi.fn<(...args: any[]) => Promise<any>>(),
  getTenantInfrastructureScopeMock: vi.fn<(...args: any[]) => Promise<any>>(),
  getCurrentTenantIdMock: vi.fn<() => Promise<string>>(),
}))

vi.mock('@/lib/proxmox/client', async io => ({
  ...await io<typeof import('@/lib/proxmox/client')>(),
  pveFetch: pveFetchMock,
}))
vi.mock('@/lib/tenant/infraScope', async io => ({
  ...await io<typeof import('@/lib/tenant/infraScope')>(),
  getTenantInfrastructureScope: getTenantInfrastructureScopeMock,
}))
vi.mock('@/lib/tenant', () => ({ getCurrentTenantId: getCurrentTenantIdMock }))

import {
  guardSessionGuest, haSidGuest, parseGuestKey, parseGuestTarget, replicationJobVmid, sessionGuestVisibility,
} from './guestGuard'

const conn = { id: 'conn-1' } as any

function iaasInfra() {
  return {
    kind: 'iaas',
    vdcScope: {
      connectionIds: new Set(['conn-1']),
      nodesByConnection: new Map([['conn-1', new Set(['pve3', 'pve4'])]]),
      poolsByConnection: new Map([['conn-1', new Set(['pool-1'])]]),
    },
  }
}

const RESOURCES = [
  { vmid: 100, type: 'qemu', node: 'pve3', pool: 'pool-1' },
  { vmid: 101, type: 'lxc', node: 'pve4', pool: 'pool-1' },
  { vmid: 200, type: 'qemu', node: 'pve3', pool: 'provider' },
]

const target = { connectionId: 'conn-1', conn, type: 'qemu', node: 'pve3', vmid: '100' }

beforeEach(() => {
  pveFetchMock.mockReset().mockResolvedValue(RESOURCES)
  getTenantInfrastructureScopeMock.mockReset().mockResolvedValue(iaasInfra())
  getCurrentTenantIdMock.mockReset().mockResolvedValue('tenant-1')
})

describe('guardSessionGuest: vDC confinement', () => {
  it('admits a guest inside a vDC pool', async () => {
    expect(await guardSessionGuest(target)).toBeNull()
    expect(getTenantInfrastructureScopeMock).toHaveBeenCalledWith('tenant-1', { ignoreVdcContext: true })
    expect(pveFetchMock).toHaveBeenCalledWith(conn, '/cluster/resources?type=vm')
  })

  it('refuses a guest outside the vDC pools with 403', async () => {
    const res = await guardSessionGuest({ ...target, vmid: '200' })
    expect(res?.status).toBe(403)
    expect(await res?.json()).toEqual({ error: 'Guest outside your vDC scope' })
  })

  it('refuses a guest that moved to another vDC node unless allowMovedNode is set', async () => {
    const stale = { ...target, type: 'lxc', node: 'pve3', vmid: '101' }
    expect((await guardSessionGuest(stale))?.status).toBe(403)
    expect(await guardSessionGuest({ ...stale, allowMovedNode: true })).toBeNull()
  })

  it('a null type and node confine a body vmid to the vDC pools only', async () => {
    expect(await guardSessionGuest({ ...target, type: null, node: null, vmid: '101' })).toBeNull()
    expect((await guardSessionGuest({ ...target, type: null, node: null, vmid: '200' }))?.status).toBe(403)
  })

  it('resolves the connection thunk only for a vDC tenant', async () => {
    const thunk = vi.fn(async () => conn)
    expect(await guardSessionGuest({ ...target, conn: thunk })).toBeNull()
    expect(thunk).toHaveBeenCalledTimes(1)

    getTenantInfrastructureScopeMock.mockResolvedValue({ kind: 'provider' })
    thunk.mockClear()
    expect(await guardSessionGuest({ ...target, conn: thunk, vmid: '200' })).toBeNull()
    expect(thunk).not.toHaveBeenCalled()
  })

  it('a provider or MSP tenant passes after the scope lookup, without any PVE call', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue({ kind: 'msp', connectionIds: new Set(['conn-1']) })
    expect(await guardSessionGuest({ ...target, vmid: '200' })).toBeNull()
    expect(pveFetchMock).not.toHaveBeenCalled()
    expect(getTenantInfrastructureScopeMock).toHaveBeenCalledTimes(1)
  })
})

describe('guardSessionGuest: strict identifiers, 400 before any lookup', () => {
  it.each([
    ['a vmid with a path separator', { vmid: '100/config' }, 'Invalid vmid'],
    ['a vmid with a query string', { vmid: '100?x=1' }, 'Invalid vmid'],
    ['an empty vmid', { vmid: '' }, 'Invalid vmid'],
    ['an unknown guest type', { type: 'vm' }, 'Invalid type'],
    ['a node name with a slash', { node: 'pve3/../pve9' }, 'Invalid node name'],
    ['a node name with a space', { node: 'pve 3' }, 'Invalid node name'],
  ])('refuses %s', async (_label, patch, error) => {
    const res = await guardSessionGuest({ ...target, ...patch })
    expect(res?.status).toBe(400)
    expect(await res?.json()).toEqual({ error })
    expect(getCurrentTenantIdMock).not.toHaveBeenCalled()
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('accepts a dotted node name', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue({ kind: 'provider' })
    expect(await guardSessionGuest({ ...target, node: 'pve3.lab.internal' })).toBeNull()
  })
})

describe('guardSessionGuest: a lookup failure refuses, never passes', () => {
  it('503 when the session tenant cannot be resolved', async () => {
    getCurrentTenantIdMock.mockRejectedValue(new Error('no request scope'))
    const res = await guardSessionGuest(target)
    expect(res?.status).toBe(503)
    expect(await res?.json()).toEqual({ error: 'Unable to verify guest vDC scope' })
  })

  it('503 when the infrastructure scope cannot be resolved', async () => {
    getTenantInfrastructureScopeMock.mockRejectedValue(new Error('db down'))
    expect((await guardSessionGuest(target))?.status).toBe(503)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('503 when the connection thunk fails for a vDC tenant', async () => {
    const res = await guardSessionGuest({ ...target, conn: async () => { throw new Error('Connection not found') } })
    expect(res?.status).toBe(503)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('503 when PVE cannot list the guests', async () => {
    pveFetchMock.mockRejectedValue(new Error('down'))
    expect((await guardSessionGuest(target))?.status).toBe(503)
  })
})

describe('sessionGuestVisibility: masking of cluster-wide lists', () => {
  it('a provider session sees every guest and the connection is never resolved', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue({ kind: 'provider' })
    const thunk = vi.fn(async () => conn)
    const result = await sessionGuestVisibility({ connectionId: 'conn-1', conn: thunk })
    expect(result.ok && result.visibility.all).toBe(true)
    expect(thunk).not.toHaveBeenCalled()
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('a vDC session sees the guests of its pools only', async () => {
    const result = await sessionGuestVisibility({ connectionId: 'conn-1', conn })
    if (!result.ok) throw new Error('unexpected refusal')
    expect(result.visibility.all).toBe(false)
    expect(result.visibility.has('qemu', '100')).toBe(true)
    expect(result.visibility.has('qemu', '200')).toBe(false)
  })

  it('uses the listing the route already holds instead of reading one', async () => {
    const result = await sessionGuestVisibility({ connectionId: 'conn-1', conn, resources: RESOURCES })
    expect(result.ok && result.visibility.has('lxc', '101')).toBe(true)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it.each([
    ['the session tenant lookup fails', () => getCurrentTenantIdMock.mockRejectedValue(new Error('no request scope'))],
    ['the infrastructure scope lookup fails', () => getTenantInfrastructureScopeMock.mockRejectedValue(new Error('db down'))],
    ['the connection cannot be resolved', () => pveFetchMock.mockRejectedValue(new Error('down'))],
  ])('answers 503 when %s', async (_label, arrange) => {
    arrange()
    const result = await sessionGuestVisibility({ connectionId: 'conn-1', conn })
    expect(!result.ok && result.response.status).toBe(503)
  })

  it('answers 503 when the connection thunk fails for a vDC session', async () => {
    const result = await sessionGuestVisibility({ connectionId: 'conn-1', conn: async () => { throw new Error('Connection not found') } })
    expect(!result.ok && result.response.status).toBe(503)
  })
})

describe('haSidGuest and replicationJobVmid', () => {
  it('maps a Proxmox HA service id to a guest', () => {
    expect(haSidGuest('vm:100')).toEqual({ type: 'qemu', vmid: '100' })
    expect(haSidGuest('ct:101')).toEqual({ type: 'lxc', vmid: '101' })
    for (const bad of ['vm:', 'vm:1a', 'lxc:100', 'vm:100/x', '', undefined]) expect(haSidGuest(bad)).toBeNull()
  })

  it('reads the vmid out of a replication job id', () => {
    expect(replicationJobVmid('100-0')).toBe('100')
    expect(replicationJobVmid('4711-12')).toBe('4711')
    for (const bad of ['100', '100-', 'job:1', '1-pve2', 'a-1', undefined]) expect(replicationJobVmid(bad)).toBeNull()
  })
})

describe('parseGuestTarget', () => {
  it('returns the three validated segments', () => {
    expect(parseGuestTarget({ type: 'lxc', node: 'pve1', vmid: '100' })).toEqual({ ok: true, type: 'lxc', node: 'pve1', vmid: '100' })
  })

  it.each([
    [{ type: 'qemu', node: 'pve1', vmid: '1e3' }, 'Invalid vmid'],
    [{ type: 'QEMU', node: 'pve1', vmid: '100' }, 'Invalid type'],
    [{ type: 'qemu', node: '-pve1', vmid: '100' }, 'Invalid node name'],
    [{ type: 'qemu', vmid: '100' }, 'Invalid node name'],
  ])('answers 400 for %j', async (raw, error) => {
    const parsed = parseGuestTarget(raw)
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.response.status).toBe(400)
    expect(await parsed.response.json()).toEqual({ error })
  })
})

describe('parseGuestKey (connId:type:node:vmid)', () => {
  it('splits and validates a well-formed key', () => {
    expect(parseGuestKey('conn-1:qemu:pve1.internal:100')).toEqual({ ok: true, connId: 'conn-1', type: 'qemu', node: 'pve1.internal', vmid: '100' })
  })

  it.each([
    ['bad', /invalid vmkey format/i],
    ['conn-1:qemu:pve1:100:extra', /invalid vmkey format/i],
    ['conn-1:vm:pve1:100', /invalid vmkey: type/i],
    ['conn-1:qemu:pve 1:100', /invalid vmkey: node/i],
    ['conn-1:qemu:pve1:100;rm', /invalid vmkey: vmid/i],
    [':qemu:pve1:100', /invalid vmkey: connection/i],
    [undefined, /invalid vmkey format/i],
  ])('answers 400 for %s', async (key, message) => {
    const parsed = parseGuestKey(key)
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.response.status).toBe(400)
    expect((await parsed.response.json()).error).toMatch(message)
  })
})
