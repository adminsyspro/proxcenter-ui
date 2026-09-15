/**
 * MOCK-based tests for createZone's VLAN/VXLAN parameterization.
 * Run with the unit config (no Postgres):
 *   npx vitest run --config vitest.unit.config.ts src/lib/vdc/sdnZones.test.ts
 */
import { describe, expect, it, beforeEach, vi } from 'vitest'

vi.mock('@/lib/proxmox/client', () => ({
  pveFetch: vi.fn(),
}))

import { pveFetch } from '@/lib/proxmox/client'

import { createZone, readZonePve, updateZone } from './sdn'

const fakeConn = { baseUrl: 'http://x', apiToken: 't' } as any

function zonesCallBody(): URLSearchParams {
  const call = vi.mocked(pveFetch).mock.calls.find((c) => c[1] === '/cluster/sdn/zones')
  if (!call) throw new Error('no POST to /cluster/sdn/zones recorded')
  return call[2]?.body as URLSearchParams
}

describe('createZone', () => {
  beforeEach(() => {
    vi.mocked(pveFetch).mockReset()
  })

  it('creates a VLAN zone bound to a bridge, no peers', async () => {
    vi.mocked(pveFetch).mockResolvedValue(undefined as any)

    await createZone(fakeConn, 'vlabcdef', { type: 'vlan', bridge: 'vmbr0' })

    const params = zonesCallBody()
    expect(params.get('type')).toBe('vlan')
    expect(params.get('zone')).toBe('vlabcdef')
    expect(params.get('bridge')).toBe('vmbr0')
    expect(params.has('peers')).toBe(false)
  })

  it('defaults to a VXLAN zone with peers pulled from /cluster/status', async () => {
    vi.mocked(pveFetch).mockImplementation(async (_conn: any, path: string) => {
      if (path === '/cluster/status') {
        return [
          { type: 'node', ip: '10.0.0.1' },
          { type: 'node', ip: '10.0.0.2' },
          { type: 'cluster' }, // non-node entries must be filtered out
        ] as any
      }
      if (path === '/cluster/sdn/zones') return undefined as any
      throw new Error(`unexpected fetch ${path}`)
    })

    await createZone(fakeConn, 'zfoo')

    const params = zonesCallBody()
    expect(params.get('type')).toBe('vxlan')
    expect(params.get('zone')).toBe('zfoo')
    expect(params.get('peers')).toBe('10.0.0.1,10.0.0.2')
  })

  it('swallows an "already exists" error instead of throwing', async () => {
    vi.mocked(pveFetch).mockImplementation(async (_conn: any, path: string) => {
      if (path === '/cluster/status') return [{ type: 'node', ip: '10.0.0.1' }] as any
      if (path === '/cluster/sdn/zones') throw new Error('zone already exists')
      throw new Error(`unexpected fetch ${path}`)
    })

    await expect(createZone(fakeConn, 'zfoo')).resolves.toBeUndefined()
  })

  it('throws when a VLAN zone is requested without a bridge', async () => {
    await expect(createZone(fakeConn, 'vlnobrdg', { type: 'vlan' })).rejects.toThrow('bridge is required')
    expect(pveFetch).not.toHaveBeenCalled()
  })
})

describe('createZone with an explicit transport (#899)', () => {
  beforeEach(() => {
    vi.mocked(pveFetch).mockReset()
  })

  it('sends the given peers and MTU without reading /cluster/status', async () => {
    vi.mocked(pveFetch).mockResolvedValue(undefined as any)

    await createZone(fakeConn, 'zfoo', { peers: ['10.100.5.1', '10.100.5.2'], mtu: 1400 })

    const params = zonesCallBody()
    expect(params.get('type')).toBe('vxlan')
    expect(params.get('peers')).toBe('10.100.5.1,10.100.5.2')
    expect(params.get('mtu')).toBe('1400')
    expect(vi.mocked(pveFetch).mock.calls.some((c) => c[1] === '/cluster/status')).toBe(false)
  })

  it('leaves the MTU to PVE when it is not set', async () => {
    vi.mocked(pveFetch).mockResolvedValue(undefined as any)

    await createZone(fakeConn, 'zfoo', { peers: ['10.100.5.1'], mtu: null })

    expect(zonesCallBody().has('mtu')).toBe(false)
  })

  it('refuses an empty peer list instead of staging a zone PVE would reject', async () => {
    await expect(createZone(fakeConn, 'zfoo', { peers: [] })).rejects.toThrow(/no peer address/)
    expect(pveFetch).not.toHaveBeenCalled()
  })
})

describe('updateZone', () => {
  beforeEach(() => {
    vi.mocked(pveFetch).mockReset()
  })

  function zonePutBody(): URLSearchParams {
    const call = vi.mocked(pveFetch).mock.calls.find((c) => c[1] === '/cluster/sdn/zones/zfoo')
    if (!call) throw new Error('no PUT to /cluster/sdn/zones/zfoo recorded')
    expect(call[2]?.method).toBe('PUT')
    return call[2]?.body as URLSearchParams
  }

  it('PUTs peers and MTU on the zone', async () => {
    vi.mocked(pveFetch).mockResolvedValue(undefined as any)

    await updateZone(fakeConn, 'zfoo', { peers: ['10.0.0.1', '10.0.0.2'], mtu: 8950 })

    const body = zonePutBody()
    expect(body.get('peers')).toBe('10.0.0.1,10.0.0.2')
    expect(body.get('mtu')).toBe('8950')
    expect(body.has('delete')).toBe(false)
  })

  it('deletes the MTU property when it is unset', async () => {
    vi.mocked(pveFetch).mockResolvedValue(undefined as any)

    await updateZone(fakeConn, 'zfoo', { peers: ['10.0.0.1'], mtu: null })

    const body = zonePutBody()
    expect(body.get('delete')).toBe('mtu')
    expect(body.has('mtu')).toBe(false)
  })

  it('refuses an empty peer list and wraps a PVE refusal with the zone name', async () => {
    await expect(updateZone(fakeConn, 'zfoo', { peers: [], mtu: null })).rejects.toThrow(/no peer address/)
    expect(pveFetch).not.toHaveBeenCalled()

    vi.mocked(pveFetch).mockRejectedValue(new Error('400 peers: invalid format'))
    await expect(updateZone(fakeConn, 'zfoo', { peers: ['10.0.0.1'], mtu: null }))
      .rejects.toThrow(/Failed to update SDN zone "zfoo": 400 peers/)
  })
})

describe('readZonePve', () => {
  beforeEach(() => {
    vi.mocked(pveFetch).mockReset()
  })

  it('parses the running values and the staged changes', async () => {
    vi.mocked(pveFetch).mockResolvedValue({
      zone: 'zfoo', type: 'vxlan', peers: '10.0.0.1,10.0.0.2', mtu: '1400',
      state: 'changed', pending: { peers: '10.0.0.1,10.0.0.2,10.0.0.3' },
    } as any)

    expect(await readZonePve(fakeConn, 'zfoo')).toEqual({
      type: 'vxlan', peers: ['10.0.0.1', '10.0.0.2'], mtu: 1400,
      state: 'changed', pending: { peers: '10.0.0.1,10.0.0.2,10.0.0.3' },
    })
    expect(vi.mocked(pveFetch).mock.calls[0][1]).toBe('/cluster/sdn/zones/zfoo?pending=1')
  })

  it('reports no MTU and no pending change on a plain zone', async () => {
    vi.mocked(pveFetch).mockResolvedValue({ zone: 'zfoo', type: 'vxlan', peers: '10.0.0.1' } as any)

    expect(await readZonePve(fakeConn, 'zfoo')).toEqual({ type: 'vxlan', peers: ['10.0.0.1'], mtu: null, state: null, pending: null })
  })

  it('returns null for a zone Proxmox does not know, rethrows anything else', async () => {
    vi.mocked(pveFetch).mockRejectedValueOnce(new Error("sdn zone 'zfoo' does not exist"))
    expect(await readZonePve(fakeConn, 'zfoo')).toBeNull()

    vi.mocked(pveFetch).mockRejectedValueOnce(new Error('500 connection refused'))
    await expect(readZonePve(fakeConn, 'zfoo')).rejects.toThrow(/connection refused/)
  })
})
