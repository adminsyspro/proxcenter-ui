import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ pveFetch: vi.fn(), getConn: vi.fn() }))

vi.mock('@/lib/proxmox/client', () => ({ pveFetch: (...a: unknown[]) => m.pveFetch(...a) }))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: (...a: unknown[]) => m.getConn(...a) }))

import {
  guestsInScope,
  parsePage,
  parsePolicyBody,
  parseWindowBody,
  poolsInScope,
  scopedClusterGuests,
  windowTargetInScope,
  windowVisible,
} from './validate'

const IAAS = { connections: { c1: { all: false, nodes: ['pve1'], pools: ['pool-a'] } } }
const RESOURCES = [
  { type: 'qemu', vmid: 100, node: 'pve1', pool: 'pool-a' },
  { type: 'lxc', vmid: 101, node: 'pve1', pool: 'pool-b' },
  { type: 'qemu', vmid: 102, node: 'pve2', pool: 'pool-a' },
  { type: 'qemu', vmid: 103, node: 'pve1' },
]

beforeEach(() => {
  vi.clearAllMocks()
  m.getConn.mockResolvedValue({ id: 'c1' })
  m.pveFetch.mockResolvedValue(RESOURCES)
})

describe('parsePolicyBody', () => {
  const base = { name: ' Prod ', target: 99.9 }

  it('trims, deduplicates and defaults', () => {
    const r = parsePolicyBody({
      ...base,
      guests: [{ connectionId: 'c1', vmid: 100 }, { connectionId: 'c1', vmid: 100 }],
      tags: ['prod', ' prod ', 'web'],
    })
    expect(r).toEqual({ ok: true, value: {
      name: 'Prod', target: 99.9, guests: [{ connectionId: 'c1', vmid: 100 }], tags: ['prod', 'web'], pools: [], enabled: true,
    } })
  })

  it.each([
    [null, 'invalid_body'],
    [{ target: 99.9 }, 'invalid_name'],
    [{ name: '   ', target: 99.9 }, 'invalid_name'],
    [{ name: 'x'.repeat(121), target: 99.9 }, 'invalid_name'],
    [{ name: 'p', target: 89.99 }, 'invalid_target'],
    [{ name: 'p', target: 99.9991 }, 'invalid_target'],
    [{ name: 'p', target: '99.9' }, 'invalid_target'],
    [{ name: 'p', target: 99.9, guests: [{ connectionId: 'c1', vmid: 0 }] }, 'invalid_guests'],
    [{ name: 'p', target: 99.9, guests: [{ connectionId: '../x', vmid: 1 }] }, 'invalid_guests'],
    [{ name: 'p', target: 99.9, tags: [''] }, 'invalid_selector'],
    [{ name: 'p', target: 99.9, pools: 'pool-a' }, 'invalid_selector'],
    [{ name: 'p', target: 99.9, enabled: 'yes' }, 'invalid_body'],
  ])('refuses %j with %s', (body, error) => {
    expect(parsePolicyBody(body)).toEqual({ ok: false, error })
  })

  it('accepts both target bounds and 120 characters', () => {
    expect(parsePolicyBody({ name: 'x'.repeat(120), target: 90 }).ok).toBe(true)
    expect(parsePolicyBody({ name: 'p', target: 99.999, enabled: false })).toMatchObject({ ok: true, value: { enabled: false } })
  })
})

describe('parseWindowBody', () => {
  const base = { scope: 'node', connectionId: 'c1', node: 'pve1', startsAt: '2026-10-27T08:00:00Z', endsAt: '2026-10-27T10:00:00Z', reason: 'Kernel' }

  it('keeps only the fields of its scope', () => {
    const r = parseWindowBody({ ...base, vmid: 100, policyId: 'p1' })
    expect(r).toEqual({ ok: true, value: {
      scope: 'node', connectionId: 'c1', node: 'pve1', vmid: null, policyId: null,
      startsAt: new Date('2026-10-27T08:00:00Z'), endsAt: new Date('2026-10-27T10:00:00Z'), reason: 'Kernel',
    } })
    expect(parseWindowBody({ ...base, scope: 'policy', policyId: 'p1' })).toMatchObject({ ok: true, value: { connectionId: null, node: null, policyId: 'p1' } })
    expect(parseWindowBody({ ...base, scope: 'guest', vmid: 100 })).toMatchObject({ ok: true, value: { node: null, vmid: 100 } })
  })

  it('refuses an end at or before the start', () => {
    expect(parseWindowBody({ ...base, endsAt: base.startsAt })).toEqual({ ok: false, error: 'invalid_window' })
    expect(parseWindowBody({ ...base, endsAt: '2026-10-27T07:00:00Z' })).toEqual({ ok: false, error: 'invalid_window' })
  })

  it('refuses a time without an explicit offset, accepts Z and +hh:mm', () => {
    expect(parseWindowBody({ ...base, startsAt: '2026-10-27T08:00' })).toEqual({ ok: false, error: 'invalid_window' })
    expect(parseWindowBody({ ...base, endsAt: '2026-10-28T08:00' })).toEqual({ ok: false, error: 'invalid_window' })
    expect(parseWindowBody({ ...base, startsAt: '2026-10-27' })).toEqual({ ok: false, error: 'invalid_window' })
    expect(parseWindowBody({ ...base, startsAt: 'Tue Oct 27 2026 08:00:00 GMT' })).toEqual({ ok: false, error: 'invalid_window' })
    expect(parseWindowBody({ ...base, startsAt: '2026-10-27T09:00:00+02:00' })).toMatchObject({ ok: true, value: { startsAt: new Date('2026-10-27T07:00:00Z') } })
    expect(parseWindowBody({ ...base, startsAt: '2026-10-27T08:00:00.123Z' }).ok).toBe(true)
  })

  it('refuses more than 31 days, accepts 31 days exactly', () => {
    expect(parseWindowBody({ ...base, endsAt: '2026-11-27T08:00:01Z' })).toEqual({ ok: false, error: 'invalid_window' })
    expect(parseWindowBody({ ...base, endsAt: '2026-11-27T08:00:00Z' }).ok).toBe(true)
  })

  it.each([
    [{ scope: 'cluster' }, 'invalid_scope'],
    [{ startsAt: 'yesterday' }, 'invalid_window'],
    [{ reason: '  ' }, 'invalid_reason'],
    [{ reason: 'x'.repeat(501) }, 'invalid_reason'],
    [{ connectionId: undefined }, 'invalid_target_ref'],
    [{ node: 'pve1/../x' }, 'invalid_target_ref'],
    [{ scope: 'guest', vmid: -1 }, 'invalid_target_ref'],
    [{ scope: 'policy', policyId: '' }, 'invalid_target_ref'],
  ])('refuses %j with %s', (patch, error) => {
    expect(parseWindowBody({ ...base, ...patch })).toEqual({ ok: false, error })
  })
})

describe('guestsInScope', () => {
  it('lets the provider and a whole connection through without listing the cluster', async () => {
    expect(await guestsInScope(null, ['c1'], [{ connectionId: 'c1', vmid: 999 }])).toBe(true)
    expect(await guestsInScope({ connections: { c1: { all: true } } }, ['c1'], [{ connectionId: 'c1', vmid: 999 }])).toBe(true)
    expect(m.pveFetch).not.toHaveBeenCalled()
  })

  it('refuses a connection outside the visible list', async () => {
    expect(await guestsInScope(null, ['c1'], [{ connectionId: 'c2', vmid: 1 }])).toBe(false)
  })

  it('vDC: the guest must be in a vDC pool, whatever its node (AllowsGuest in Go)', async () => {
    expect(await guestsInScope(IAAS, ['c1'], [{ connectionId: 'c1', vmid: 100 }])).toBe(true)
    expect(m.pveFetch).toHaveBeenCalledWith({ id: 'c1' }, '/cluster/resources?type=vm')
    // 102 sits on pve2, outside the vDC nodes, but in pool-a: accepted.
    expect(await guestsInScope(IAAS, ['c1'], [{ connectionId: 'c1', vmid: 102 }])).toBe(true)
    for (const vmid of [101, 103, 404]) {
      expect(await guestsInScope(IAAS, ['c1'], [{ connectionId: 'c1', vmid }])).toBe(false)
    }
  })

  it('vDC: fails closed when the cluster cannot be listed, and logs it', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    m.pveFetch.mockRejectedValue(new Error('down\nforged line'))
    expect(await guestsInScope(IAAS, ['c1'], [{ connectionId: 'c1', vmid: 100 }])).toBe(false)
    expect(log).toHaveBeenCalledWith('[availability] guest list', 'down forged line')
    m.pveFetch.mockResolvedValue({ not: 'a list' })
    expect(await guestsInScope(IAAS, ['c1'], [{ connectionId: 'c1', vmid: 100 }])).toBe(false)
  })

  it('vDC without any pool: nothing is in scope', async () => {
    const noPool = { connections: { c1: { all: false, nodes: ['pve1'], pools: [] } } }
    expect(await guestsInScope(noPool, ['c1'], [{ connectionId: 'c1', vmid: 100 }])).toBe(false)
  })
})

describe('poolsInScope', () => {
  it('a vDC names only its pools; a whole connection any pool', () => {
    expect(poolsInScope(null, ['x'])).toBe(true)
    expect(poolsInScope(IAAS, ['pool-a'])).toBe(true)
    expect(poolsInScope(IAAS, ['pool-b'])).toBe(false)
    expect(poolsInScope({ connections: { c1: { all: true } } }, ['x'])).toBe(true)
    expect(poolsInScope({ connections: {} }, ['x'])).toBe(false)
  })
})

describe('windowTargetInScope / windowVisible', () => {
  const w = (patch: object) => ({ scope: 'node', connectionId: 'c1', node: 'pve1', vmid: null, ...patch }) as never

  it('a connection window needs the whole connection', async () => {
    expect(await windowTargetInScope(null, ['c1'], w({ scope: 'connection', node: null }))).toBe(true)
    expect(await windowTargetInScope(IAAS, ['c1'], w({ scope: 'connection', node: null }))).toBe(false)
    expect(await windowTargetInScope(null, ['c1'], w({ scope: 'connection', connectionId: 'c2' }))).toBe(false)
  })

  it('a node window needs a visible node, a guest window a guest in scope', async () => {
    expect(await windowTargetInScope(IAAS, ['c1'], w({}))).toBe(true)
    expect(await windowTargetInScope(IAAS, ['c1'], w({ node: 'pve2' }))).toBe(false)
    expect(await windowTargetInScope(IAAS, ['c1'], w({ scope: 'guest', node: null, vmid: 100 }))).toBe(true)
    expect(await windowTargetInScope(IAAS, ['c1'], w({ scope: 'guest', node: null, vmid: 101 }))).toBe(false)
    expect(await windowTargetInScope(IAAS, ['c1'], w({ scope: 'policy', connectionId: null }))).toBe(true)
  })

  it('hides a window outside the perimeter, shows the policy windows', () => {
    expect(windowVisible(IAAS, ['c1'], { scope: 'node', connectionId: 'c1', node: 'pve1' })).toBe(true)
    expect(windowVisible(IAAS, ['c1'], { scope: 'node', connectionId: 'c1', node: 'pve2' })).toBe(false)
    expect(windowVisible(IAAS, ['c1'], { scope: 'guest', connectionId: 'c2', node: null })).toBe(false)
    expect(windowVisible(IAAS, ['c1'], { scope: 'policy', connectionId: null, node: null })).toBe(true)
  })
})

describe('scopedClusterGuests', () => {
  it('names every guest of a connection seen whole', async () => {
    m.pveFetch.mockResolvedValue([
      { type: 'qemu', vmid: 100, name: 'web-01', node: 'pve1', pool: 'pool-a' },
      { type: 'lxc', vmid: 101, name: 'dns', node: 'pve2' },
      { type: 'storage', vmid: 5, name: 'nope' },
    ])
    const guests = await scopedClusterGuests(null, 'c1')
    expect(guests && [...guests]).toEqual([[100, { name: 'web-01', type: 'qemu' }], [101, { name: 'dns', type: 'lxc' }]])
  })

  it('vDC: only the guests of its pools, on any node', async () => {
    m.pveFetch.mockResolvedValue([
      { type: 'qemu', vmid: 100, name: 'web-01', node: 'pve1', pool: 'pool-a' },
      { type: 'lxc', vmid: 104, name: 'moved', node: 'pve9', pool: 'pool-a' },
      { type: 'qemu', vmid: 102, name: 'other', node: 'pve1', pool: 'pool-b' },
      { type: 'qemu', vmid: 103, name: '', node: 'pve1', pool: 'pool-a' },
    ])
    const guests = await scopedClusterGuests(IAAS, 'c1')
    expect(guests && [...guests]).toEqual([
      [100, { name: 'web-01', type: 'qemu' }], [104, { name: 'moved', type: 'lxc' }], [103, { name: null, type: 'qemu' }],
    ])
  })

  it('null for a connection out of scope or a cluster that cannot be listed', async () => {
    expect(await scopedClusterGuests(IAAS, 'c2')).toBeNull()
    expect(m.pveFetch).not.toHaveBeenCalled()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    m.pveFetch.mockRejectedValue(new Error('down'))
    expect(await scopedClusterGuests(null, 'c1')).toBeNull()
  })
})

describe('parsePage', () => {
  it('a whole number from 1 to 10000, 1 when absent', () => {
    expect(parsePage(null)).toBe(1)
    expect(parsePage('')).toBe(1)
    expect(parsePage('3')).toBe(3)
    expect(parsePage('10000')).toBe(10000)
    for (const v of ['0', '-1', '10001', '1e20', '1.5', ' 2', 'abc']) expect(parsePage(v)).toBeNull()
  })
})
