/**
 * VdcUsageHistoryChart (#902): range and counter pickers, the CSV link of the
 * shown range, and the empty, disabled and error states. Recharts draws
 * nothing measurable under jsdom, so the curve itself is checked in the E2E.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, waitFor } from '@testing-library/react'

import { renderWithProviders, screen } from '@/__tests__/setup/renderWithProviders'

import VdcUsageHistoryChart, { breakGaps, historyQuery, niceCeil, rangeHolding, RANGES } from './VdcUsageHistoryChart'

const URL_BASE = '/api/v1/vdcs/v1/usage/history'

function period(start: string, storageMb: number) {
  const stats = (v: number) => ({ max: v, avg: v, last: v })

  return {
    periodStart: start,
    periodEnd: start,
    samples: 1,
    counters: {
      usedVcpus: stats(4),
      usedRamMb: stats(2048),
      usedStorageMb: stats(storageMb),
      usedVms: stats(2),
      usedSnapshots: stats(0),
      usedBackups: stats(1),
    },
    storages: {},
  }
}

function answer(data: any, ok = true) {
  return { ok, status: ok ? 200 : 500, json: async () => data }
}

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('historyQuery', () => {
  it('asks for the span and bucket of each range, ending on the next minute', () => {
    const now = Date.parse('2026-10-14T12:00:30Z')

    for (const [range, { spanMs, bucket }] of Object.entries(RANGES)) {
      const p = new URLSearchParams(historyQuery(range as any, now))

      expect(p.get('to')).toBe('2026-10-14T12:01:00.000Z')
      expect(Date.parse(p.get('to')!) - Date.parse(p.get('from')!)).toBe(spanMs)
      expect(p.get('bucket')).toBe(bucket)
      expect(p.has('format')).toBe(false)
    }
    expect(new URLSearchParams(historyQuery('24h', now, 'csv')).get('format')).toBe('csv')
  })
})

describe('rangeHolding', () => {
  it('picks the shortest range that still holds the last sample', () => {
    const now = Date.parse('2026-10-14T12:00:00Z')

    expect(rangeHolding('2026-10-14T11:00:00Z', now)).toBe('24h')
    expect(rangeHolding('2026-10-10T12:00:00Z', now)).toBe('7d')
    expect(rangeHolding('2026-09-20T12:00:00Z', now)).toBe('30d')
    expect(rangeHolding('2026-03-01T12:00:00Z', now)).toBe('12m')
    expect(rangeHolding('2020-01-01T00:00:00Z', now)).toBe('12m')
    expect(rangeHolding(null, now)).toBe('24h')
  })
})

describe('niceCeil', () => {
  it('rounds the axis top up to a round value', () => {
    expect(niceCeil(59.4)).toBe(60)
    expect(niceCeil(13.2)).toBe(15)
    expect(niceCeil(0.33)).toBeCloseTo(0.35)
    expect(niceCeil(0)).toBe(1)
  })
})

describe('breakGaps', () => {
  const row = (t: number, v = 1) => ({ t, peak: v, avg: v, last: v, samples: 1 })

  it('leaves a regular series alone', () => {
    const rows = [row(0), row(60_000), row(120_000)]
    expect(breakGaps(rows, 180_000)).toEqual(rows)
  })

  it('inserts an empty point in the middle of a hole, so the curve breaks', () => {
    const out = breakGaps([row(0), row(60_000), row(20 * 3_600_000)], 180_000)
    expect(out).toHaveLength(4)
    expect(out[2]).toEqual({ t: Math.round((60_000 + 20 * 3_600_000) / 2), peak: null, avg: null, last: null, samples: 0 })
    expect(out[3].peak).toBe(1)
  })

  it('does not take a change of cadence for a hole', () => {
    const M = 60_000
    // Every 15 min, then every minute once the cadence drops to 1 min.
    const rows = [row(0), row(15 * M), row(30 * M), row(31 * M), row(32 * M)]
    expect(breakGaps(rows, 3 * M)).toEqual(rows)
  })

  it('handles an empty series', () => {
    expect(breakGaps([], 1)).toEqual([])
  })
})

describe('VdcUsageHistoryChart', () => {
  it('loads the last 24 hours, shows the cadence and links the CSV of the same range', async () => {
    fetchMock.mockResolvedValue(answer({
      data: {
        bucket: 'sample', enabled: true, intervalMinutes: 15, retentionDays: 400,
        lastSampledAt: '2026-10-14T11:45:00Z',
        periods: [period('2026-10-14T11:30:00Z', 1024), period('2026-10-14T11:45:00Z', 2048)],
      },
    }))

    renderWithProviders(<VdcUsageHistoryChart historyUrl={URL_BASE} quota={{ maxStorageMb: 4096 }} />)

    expect(await screen.findByText(/One sample every 15 min, kept 400 days/)).toBeInTheDocument()
    expect(screen.getByText('Usage history')).toBeInTheDocument()
    const url = fetchMock.mock.calls[0][0] as string

    expect(url.startsWith(`${URL_BASE}?`)).toBe(true)
    expect(new URLSearchParams(url.split('?')[1]).get('bucket')).toBe('sample')
    const csv = screen.getByRole('link', { name: /Export CSV/ })

    expect(csv.getAttribute('href')).toContain('format=csv')
    expect(csv.getAttribute('href')).toContain('bucket=sample')
    expect(csv).toHaveAttribute('download')
  })

  it('refetches with the bucket of the chosen range', async () => {
    fetchMock.mockResolvedValue(answer({ data: { bucket: 'sample', enabled: true, intervalMinutes: 15, retentionDays: 400, lastSampledAt: null, periods: [] } }))
    renderWithProviders(<VdcUsageHistoryChart historyUrl={URL_BASE} />)
    await screen.findByText(/No sample in this period yet/)

    fireEvent.click(screen.getByRole('button', { name: '12 months' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(new URLSearchParams((fetchMock.mock.calls[1][0] as string).split('?')[1]).get('bucket')).toBe('month')
    expect(screen.getByRole('link', { name: /Export CSV/ }).getAttribute('href')).toContain('bucket=month')
  })

  it('switches the counter without refetching', async () => {
    fetchMock.mockResolvedValue(answer({ data: { bucket: 'sample', enabled: true, intervalMinutes: 15, retentionDays: 400, lastSampledAt: null, periods: [period('2026-10-14T11:30:00Z', 1)] } }))
    renderWithProviders(<VdcUsageHistoryChart historyUrl={URL_BASE} />)
    await screen.findByText(/No sample yet/)

    const ram = screen.getByRole('button', { name: /RAM/ })

    fireEvent.click(ram)
    expect(ram).toHaveAttribute('aria-pressed', 'true')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('says when sampling is turned off', async () => {
    fetchMock.mockResolvedValue(answer({ data: { bucket: 'sample', enabled: false, intervalMinutes: 15, retentionDays: 400, lastSampledAt: null, periods: [] } }))
    renderWithProviders(<VdcUsageHistoryChart historyUrl={URL_BASE} bare />)

    expect((await screen.findAllByText(/Sampling is turned off/)).length).toBeGreaterThan(0)
    // The provider dialog carries its own title.
    expect(screen.queryByText('Usage history')).not.toBeInTheDocument()
  })

  it('says a deleted vDC keeps its samples, from the range it opens on', async () => {
    fetchMock.mockResolvedValue(answer({ data: { bucket: 'day', deleted: true, enabled: true, intervalMinutes: 15, retentionDays: 400, lastSampledAt: null, periods: [] } }))
    renderWithProviders(<VdcUsageHistoryChart historyUrl={URL_BASE} initialRange="30d" />)

    expect(await screen.findByText(/vDC deleted, samples kept 400 days/)).toBeInTheDocument()
    expect(screen.getByText('No sample of this vDC in this period.')).toBeInTheDocument()
    expect(new URLSearchParams((fetchMock.mock.calls[0][0] as string).split('?')[1]).get('bucket')).toBe('day')
  })

  it('shows the error of a failed request', async () => {
    fetchMock.mockResolvedValue(answer({ error: 'vDC not accessible' }, false))
    renderWithProviders(<VdcUsageHistoryChart historyUrl={URL_BASE} />)

    expect(await screen.findByText('vDC not accessible')).toBeInTheDocument()
  })

  it('treats the demo mode empty answer as no data', async () => {
    fetchMock.mockResolvedValue(answer({ data: [] }))
    renderWithProviders(<VdcUsageHistoryChart historyUrl={URL_BASE} />)

    expect(await screen.findByText(/No sample in this period yet/)).toBeInTheDocument()
  })
})
