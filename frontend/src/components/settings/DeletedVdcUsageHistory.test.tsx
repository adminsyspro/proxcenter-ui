/**
 * Deleted vDCs of the "Usage history" section (#902): listed with their
 * sampling span, each opening its kept history with the CSV export.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, within } from '@testing-library/react'

import { renderWithProviders, screen } from '@/__tests__/setup/renderWithProviders'

import DeletedVdcUsageHistory from './DeletedVdcUsageHistory'

const fetchMock = vi.fn()
const gone = {
  vdcId: 'gone/1', vdcName: 'i902-del', tenantId: 't1', tenantName: 'MSP',
  firstSampledAt: '2026-10-14T10:00:00Z', lastSampledAt: new Date().toISOString(), samples: 3,
}

function answer(data: any, ok = true) {
  return { ok, status: ok ? 200 : 500, json: async () => data }
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('DeletedVdcUsageHistory', () => {
  it('lists the deleted vDCs and opens one history with its CSV export', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      url.startsWith('/api/v1/admin/vdc-usage-history/deleted')
        ? answer({ data: [gone] })
        : answer({ data: { bucket: 'sample', deleted: true, enabled: true, intervalMinutes: 15, retentionDays: 400, lastSampledAt: gone.lastSampledAt, periods: [] } }),
    )
    renderWithProviders(<DeletedVdcUsageHistory />)

    const table = await screen.findByTestId('deleted-vdc-history')

    expect(within(table).getByText('i902-del')).toBeInTheDocument()
    expect(within(table).getByText('MSP')).toBeInTheDocument()
    expect(within(table).getByText('3')).toBeInTheDocument()

    fireEvent.click(within(table).getByRole('button', { name: 'Usage history' }))

    expect(await screen.findByText('Usage history: i902-del (deleted)')).toBeInTheDocument()
    const link = await screen.findByRole('link', { name: /Export CSV/ })

    expect(link.getAttribute('href')).toContain('/api/v1/admin/vdcs/gone%2F1/usage/history?')
    expect(link.getAttribute('href')).toContain('format=csv')
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  })

  it('says when no deleted vDC has samples left', async () => {
    fetchMock.mockResolvedValue(answer({ data: [] }))
    renderWithProviders(<DeletedVdcUsageHistory />)

    expect(await screen.findByText('No deleted vDC has samples left')).toBeInTheDocument()
  })

  it('shows the error of a failed load', async () => {
    fetchMock.mockResolvedValue(answer({ error: 'Forbidden' }, false))
    renderWithProviders(<DeletedVdcUsageHistory />)

    expect(await screen.findByText('Forbidden')).toBeInTheDocument()
  })
})
