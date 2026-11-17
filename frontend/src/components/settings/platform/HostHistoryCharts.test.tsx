import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { SWRConfig } from 'swr'

import { renderWithProviders, screen, waitFor, fireEvent } from '@/__tests__/setup/renderWithProviders'
import type { HostHistory, HostHistoryRange } from '@/lib/platform/types'

import { useState } from 'react'

import HostHistoryCharts, { HistoryRangeToggle } from './HostHistoryCharts'

const GIB = 2 ** 30
const NOW = Date.parse('2026-11-17T08:00:00.000Z')

const history = (range: HostHistoryRange, points: number): HostHistory => ({
  range,
  from: NOW - 3600_000,
  to: NOW,
  intervalSeconds: 30,
  cpus: 8,
  memTotalBytes: 16 * GIB,
  samples: Array.from({ length: points }, (_, i) => ({ t: NOW - (points - i) * 30_000, load1: 1 + i, load5: 1, load15: 1, memUsedBytes: 6 * GIB }))
})

const json = (body: unknown, code = 200) => new Response(JSON.stringify(body), { status: code })

function mockHistory(answer: (range: string) => Response) {
  const fn = vi.fn(async (url: string) => answer(new URL(String(url), 'http://localhost').searchParams.get('range') ?? ''))

  vi.stubGlobal('fetch', fn)

  return fn
}

// The selector lives in the Host section header; this harness wires the two
// the way the section does.
function Harness() {
  const [range, setRange] = useState<HostHistoryRange>('1h')

  return (
    <>
      <HistoryRangeToggle value={range} onChange={setRange} />
      <HostHistoryCharts range={range} />
    </>
  )
}

const renderCharts = () =>
  renderWithProviders(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, revalidateOnMount: true }}>
      <Harness />
    </SWRConfig>
  )

const requested = (fetchMock: ReturnType<typeof mockHistory>) => fetchMock.mock.calls.map(([url]) => String(url))

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('HostHistoryCharts', () => {
  it('draws the load and the memory of the last hour, with what each line is', async () => {
    const fetchMock = mockHistory(range => json(history(range as HostHistoryRange, 12)))

    renderCharts()

    expect(await screen.findByText('Load average')).toBeInTheDocument()
    expect(screen.getByText('1 min')).toBeInTheDocument()
    expect(screen.getByText('5 min')).toBeInTheDocument()
    expect(screen.getByText('15 min')).toBeInTheDocument()
    expect(screen.getByText('8 cores')).toBeInTheDocument()
    expect(screen.getByText('Memory')).toBeInTheDocument()
    expect(screen.getByText('Used')).toBeInTheDocument()
    expect(screen.getByText('Total 16 GiB')).toBeInTheDocument()
    expect(requested(fetchMock)).toEqual(['/api/v1/system/status/history?range=1h'])
  })

  it('asks for the range the administrator picks', async () => {
    const fetchMock = mockHistory(range => json(history(range as HostHistoryRange, 12)))

    renderCharts()
    await screen.findByText('Load average')

    fireEvent.click(screen.getByRole('button', { name: '24 h' }))
    await waitFor(() => expect(requested(fetchMock)).toContain('/api/v1/system/status/history?range=24h'))
    expect(screen.getByRole('button', { name: '24 h' })).toHaveAttribute('aria-pressed', 'true')

    // Clicking the active range again keeps it: a period is always selected.
    fireEvent.click(screen.getByRole('button', { name: '24 h' }))
    expect(screen.getByRole('button', { name: '24 h' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(screen.getByRole('button', { name: '6 h' }))
    await waitFor(() => expect(requested(fetchMock)).toContain('/api/v1/system/status/history?range=6h'))
  })

  it('says the history is filling right after a start, instead of drawing one point', async () => {
    mockHistory(range => json(history(range as HostHistoryRange, 1)))
    renderCharts()

    expect(await screen.findByText(/The history starts when ProxCenter starts/)).toBeInTheDocument()
    expect(screen.queryByText('Load average')).not.toBeInTheDocument()
  })

  it('says so when the history cannot be loaded', async () => {
    mockHistory(() => json({ error: 'forbidden' }, 403))
    renderCharts()

    expect(await screen.findByText('The history could not be loaded.')).toBeInTheDocument()
  })

  it('leaves the memory total out of the scale when the host does not report it', async () => {
    mockHistory(range => json({ ...history(range as HostHistoryRange, 5), cpus: 0, memTotalBytes: 0 }))
    renderCharts()

    expect(await screen.findByText('0 cores')).toBeInTheDocument()
    expect(screen.getByText('Total 0 B')).toBeInTheDocument()
  })
})
