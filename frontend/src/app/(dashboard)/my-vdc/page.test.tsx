/**
 * Landing behavior of /my-vdc: multi-vDC tenants get cards; a card click
 * sets the pc_vdc_context cookie and opens the overview; single-vDC tenants
 * keep the direct overview. MyVdcOverview and QuotaDonut are mocked — this
 * tests the page's routing logic, not the cockpit.
 * Run: npx vitest run "src/app/(dashboard)/my-vdc/page.test.tsx"
 */
import React from 'react'

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: any) =>
    values?.count !== undefined ? `${key}:${values.count}` : key,
}))
vi.mock('@/components/mydc/MyVdcOverview', () => ({
  default: ({ vdc }: any) => <div data-testid="overview">{vdc.name}</div>,
}))
vi.mock('@/components/mydc/QuotaDonut', () => ({ default: () => <div /> }))

import MyVdcPage from './page'

const vdc = (id: string, name: string) => ({
  id, name, enabled: true, quota: null,
  usage: { usedVcpus: 2, usedRamMb: 2048, usedStorageMb: 10240, usedVms: 3, usedSnapshots: 0, usedBackups: 0, lastSyncedAt: new Date().toISOString() },
  vnets: [],
})

const mockVdcsResponse = (list: any[]) => {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({ data: list }),
  })) as any)
}

beforeEach(() => {
  document.cookie = 'pc_vdc_context=; path=/; max-age=0'
})

afterEach(() => {
  cleanup() // no RTL auto-cleanup in this suite (vitest globals disabled)
  vi.unstubAllGlobals()
})

describe('/my-vdc landing', () => {
  it('renders one card per active vDC when the tenant has several', async () => {
    mockVdcsResponse([vdc('vA', 'ACME — Paris'), vdc('vB', 'ACME — Frankfurt')])
    render(<MyVdcPage />)
    await waitFor(() => expect(screen.getByText('ACME — Paris')).toBeTruthy())
    expect(screen.getByText('ACME — Frankfurt')).toBeTruthy()
    expect(screen.queryByTestId('overview')).toBeNull()
  })

  it('card click sets the context cookie and opens the overview', async () => {
    mockVdcsResponse([vdc('vA', 'ACME — Paris'), vdc('vB', 'ACME — Frankfurt')])
    render(<MyVdcPage />)
    await waitFor(() => expect(screen.getByText('ACME — Paris')).toBeTruthy())
    await userEvent.click(screen.getByText('ACME — Paris'))
    expect(document.cookie).toContain('pc_vdc_context=vA')
    expect(screen.getByTestId('overview').textContent).toBe('ACME — Paris')
  })

  it('single-vDC tenant goes straight to the overview (unchanged behavior)', async () => {
    mockVdcsResponse([vdc('vA', 'ACME — Paris')])
    render(<MyVdcPage />)
    await waitFor(() => expect(screen.getByTestId('overview')).toBeTruthy())
    expect(screen.getByTestId('overview').textContent).toBe('ACME — Paris')
  })
})
