import { describe, it, expect, vi, beforeEach } from 'vitest'

const pveFetch = vi.fn()

vi.mock('@/lib/proxmox/client', () => ({ pveFetch: (...a: any[]) => pveFetch(...a) }))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: vi.fn(async (id: string) => (id === 'c1' ? { id } : null)) }))
vi.mock('@/lib/rbac', () => ({ checkPermission: vi.fn(async () => null), PERMISSIONS: { VM_VIEW: 'vm.view' } }))
// The session sees every guest but vmid 999.
vi.mock('@/lib/vdc/guestGuard', () => ({
  sessionGuestVisibility: vi.fn(async () => ({ ok: true, visibility: { has: (_t: string | null, vmid: string) => vmid !== '999' } })),
}))

import { POST } from './route'

const ctx = (id = 'c1') => ({ params: Promise.resolve({ id }) })

const post = (items: any[], headers: Record<string, string> = {}) =>
  new Request('http://x/api/v1/connections/c1/guests/trends', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ items }),
  })

// POST is typed as possibly undefined (the RBAC guard's return type).
async function call(req: Request, id = 'c1'): Promise<Response> {
  const res = await POST(req, ctx(id))

  if (!res) throw new Error('POST returned no response')

  return res
}

beforeEach(() => {
  pveFetch.mockReset()
})

describe('POST /connections/[id]/guests/trends', () => {
  it('answers 404 for an unknown connection', async () => {
    const res = await call(post([]), 'nope')

    expect(res.status).toBe(404)
  })

  it('uses the RRD, falls back to status/current, and leaves a guest empty when both fail', async () => {
    pveFetch.mockImplementation(async (_c: any, path: string) => {
      if (path.startsWith('/nodes/pve1/qemu/101/rrddata')) return [{ time: 1_700_000_000, cpu: 0.5, mem: 1, maxmem: 4 }]
      if (path.startsWith('/nodes/pve1/qemu/102/rrddata')) return []
      if (path === '/nodes/pve1/qemu/102/status/current') return { cpu: 0.25, mem: 2, maxmem: 4 }
      throw new Error('unreachable')
    })

    const res = await call(post([
      { type: 'qemu', node: 'pve1', vmid: 101 },
      { type: 'qemu', node: 'pve1', vmid: 102 },
      { type: 'qemu', node: 'pve1', vmid: 103 },
      { type: 'qemu', node: 'pve1', vmid: 999 },
    ]))
    const { data, debug } = await res.json()

    expect(data['qemu:pve1:101'][0]).toMatchObject({ cpu: 50, ram: 25 })
    expect(data['qemu:pve1:102']).toEqual([expect.objectContaining({ cpu: 25, ram: 50 })])
    expect(data['qemu:pve1:103']).toEqual([])
    expect(data).not.toHaveProperty('qemu:pve1:999')
    expect(debug).toBeUndefined()
  })

  it('returns the steps of each guest under x-debug', async () => {
    pveFetch.mockRejectedValue(new Error('down'))

    const res = await call(post([{ type: 'lxc', node: 'pve1', vmid: 200 }], { 'x-debug': '1' }))
    const body = await res.json()

    expect(body.data['lxc:pve1:200']).toEqual([])
    expect(body.debug.items[0].steps.map((s: any) => s.step)).toEqual(['rrd_error', 'status_current_error', 'fallback_skipped'])
  })

  it('answers an empty map when no requested guest is visible', async () => {
    const res = await call(post([{ type: 'qemu', node: 'pve1', vmid: 999 }]))

    expect(await res.json()).toEqual({ data: {} })
    expect(pveFetch).not.toHaveBeenCalled()
  })
})
