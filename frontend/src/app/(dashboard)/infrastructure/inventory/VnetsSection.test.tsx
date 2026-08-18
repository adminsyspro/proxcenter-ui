/**
 * Component tests for VnetsSection — the tenant VNets table.
 *
 * Covers the Task 14 vDC-context behaviours: the union view of a multi-vDC
 * tenant shows a "Virtual Datacenter" column, a pc_vdc_context cookie
 * matching one of the tenant's active vDCs narrows the table to that vDC
 * (and hides the now-constant column), and a foreign cookie fails open to
 * the union.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen } from '@/__tests__/setup/renderWithProviders'
import VnetsSection from './VnetsSection'

vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => ({ isFullClusterView: false }),
}))

// Dialogs and the detail panel only open on user action — stub them so the
// test doesn't drag their fetch plumbing in.
vi.mock('@/components/mydc/VnetCreateDialog', () => ({ default: () => null }))
vi.mock('@/components/mydc/VnetEditDialog', () => ({ default: () => null }))
vi.mock('@/components/mydc/VnetDeleteDialog', () => ({ default: () => null }))
vi.mock('./TenantVnetDetailPanel', () => ({ default: () => null }))

const VDCS = [
  { id: 'v1', name: 'ACME — GRA4', connectionId: 'c1', enabled: true },
  { id: 'v2', name: 'ACME — SBG', connectionId: 'c2', enabled: true },
]

const VNET = (id: string, name: string) => ({
  id,
  displayName: name,
  pveName: id,
  tag: 100,
  firewall: false,
  subnet: { cidr: '10.0.0.0/24', gateway: '10.0.0.1', dnsServers: [] },
  ipamUsage: { used: 3, usable: 250 },
})

function jsonRes(body: any, status = 200) {
  return { ok: status < 400, status, json: async () => body } as Response
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (input: any) => {
    const url = String(input)
    if (url.endsWith('/api/v1/vdcs')) return jsonRes({ data: VDCS })
    if (url.includes('/api/v1/vdcs/v1/vnets')) return jsonRes({ data: [VNET('vnet-a', 'web-gra4')] })
    if (url.includes('/api/v1/vdcs/v2/vnets')) return jsonRes({ data: [VNET('vnet-b', 'web-sbg')] })
    return jsonRes({ data: [] })
  }))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  document.cookie = 'pc_vdc_context=; path=/; max-age=0'
})

describe('VnetsSection — vDC context', () => {
  it('union view of a multi-vDC tenant: every vnet listed, vDC column shown', async () => {
    renderWithProviders(<VnetsSection connectionIds={[]} />)

    expect(await screen.findByText('web-gra4')).toBeTruthy()
    expect(screen.getByText('web-sbg')).toBeTruthy()
    // Column header + one cell per row.
    expect(screen.getByText('Virtual Datacenter')).toBeTruthy()
    expect(screen.getByText('ACME — GRA4')).toBeTruthy()
    expect(screen.getByText('ACME — SBG')).toBeTruthy()
  })

  it('a context cookie matching an active vDC narrows the table and drops the column', async () => {
    document.cookie = 'pc_vdc_context=v1; path=/'

    renderWithProviders(<VnetsSection connectionIds={[]} />)

    expect(await screen.findByText('web-gra4')).toBeTruthy()
    expect(screen.queryByText('web-sbg')).toBeNull()
    expect(screen.queryByText('Virtual Datacenter')).toBeNull()
  })

  it('a foreign context cookie fails open to the union view', async () => {
    document.cookie = 'pc_vdc_context=not-mine; path=/'

    renderWithProviders(<VnetsSection connectionIds={[]} />)

    expect(await screen.findByText('web-gra4')).toBeTruthy()
    expect(screen.getByText('web-sbg')).toBeTruthy()
    expect(screen.getByText('Virtual Datacenter')).toBeTruthy()
  })
})
