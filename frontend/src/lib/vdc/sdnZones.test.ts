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

import { createZone } from './sdn'

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
      if (path === '/cluster/status') return [] as any
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
