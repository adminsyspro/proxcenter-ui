/**
 * Component tests for TenantVnetDetailPanel — the IPAM table of a tenant
 * VNet. The VM shown on each allocation comes from the IPAM route's own
 * enrichment; the panel makes no other call to name the guests.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, fireEvent } from '@testing-library/react'

import { renderWithProviders, screen } from '@/__tests__/setup/renderWithProviders'
import TenantVnetDetailPanel from './TenantVnetDetailPanel'

vi.mock('@/components/mydc/VnetEditDialog', () => ({ default: () => null }))

const VNET = {
  id: 'vnet-a',
  vdcId: 'v1',
  pveName: 'a1b2c3d4',
  displayName: 'web',
  description: null,
  tag: 100,
  firewall: false,
  subnet: { cidr: '10.0.0.0/24', gateway: '10.0.0.1', dnsServers: [] },
}

const alloc = (i: number, extra: Record<string, any>) => ({
  id: `a${i}`,
  ip: `10.0.0.${i + 10}`,
  mac: `BC:24:11:00:00:0${i}`,
  createdAt: '2026-10-01T00:00:00Z',
  ...extra,
})

const IPAM = {
  connectionId: 'c1',
  cidr: '10.0.0.0/24',
  gateway: '10.0.0.1',
  usable: 253,
  used: 3,
  allocations: [
    alloc(1, { vmid: 101, hostname: 'web-01-old', vm: { name: 'web-01', node: 'pve1', status: 'running', type: 'qemu' } }),
    alloc(2, { vmid: 102, hostname: 'db-01', vm: null }),
    alloc(3, { vmid: null, hostname: null, vm: null }),
  ],
}

let fetchMock: ReturnType<typeof vi.fn>

function jsonRes(body: any, status = 200) {
  return { ok: status < 400, status, json: async () => body } as Response
}

beforeEach(() => {
  fetchMock = vi.fn(async (input: any) => {
    const url = String(input)
    if (url.endsWith('/api/v1/vdcs/v1/vnets/web/ipam')) return jsonRes({ data: IPAM })
    if (url.endsWith('/api/v1/vdcs/v1/vnets/web')) return jsonRes({ data: VNET })
    return jsonRes({ error: 'unexpected' }, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('TenantVnetDetailPanel — IPAM allocations', () => {
  it('names each allocation from the IPAM enrichment, and reads nothing else', async () => {
    renderWithProviders(<TenantVnetDetailPanel selectionId="v1:web" />)

    expect(await screen.findByText('web-01')).toBeTruthy()
    // No enrichment for vmid 102: the panel falls back to the IPAM hostname.
    expect(screen.getByText('db-01')).toBeTruthy()
    expect(screen.queryByText('web-01-old')).toBeNull()

    const urls = fetchMock.mock.calls.map(([u]) => String(u))
    expect(urls.every(u => u.startsWith('/api/v1/vdcs/v1/vnets/web'))).toBe(true)
  })

  it('searches on the enriched VM name', async () => {
    renderWithProviders(<TenantVnetDetailPanel selectionId="v1:web" />)
    await screen.findByText('web-01')

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'web-01' } })

    expect(screen.getByText('web-01')).toBeTruthy()
    expect(screen.queryByText('db-01')).toBeNull()
  })
})
