import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { renderWithProviders, screen, fireEvent, waitFor } from '@/__tests__/setup/renderWithProviders'

const licenseMock = vi.fn(() => ({ isEnterprise: true }))

vi.mock('@/contexts/LicenseContext', () => ({ useLicense: () => licenseMock() }))

import TopConsumersWidget, { buildTopConsumersQuery, formatCustomRange, formatTopValue, hasUsableWindow, listConnections, resolveSettings } from './TopConsumersWidget'

/**
 * #1129: the top consumers widget ranks guests live (dashboard payload, what
 * it always did) or over a window from the orchestrator's stored collections:
 * IO rates, the dashboard's range or a custom one. Community keeps the live
 * CPU / RAM toggle only.
 */

const jsonResponse = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => body })

const data = {
  clusters: [{ id: 'c1', name: 'PVE-PROD' }, { id: 'c2', name: 'PVE-DR' }],
  nodes: [
    { name: 'pve1', connectionId: 'c1', connection: 'PVE-PROD' },
    { name: 'pve1-dr', connectionId: 'c2', connection: 'PVE-DR' },
  ],
  topCpu: [
    { name: 'web-01', vmid: 100, node: 'pve1', connId: 'c1', type: 'qemu', value: 87.4 },
    { name: 'proxy-01', vmid: 200, node: 'pve1-dr', connId: 'c2', type: 'lxc', value: 12 },
  ],
  topRam: [{ name: 'db-01', vmid: 101, node: 'pve1', connId: 'c1', type: 'qemu', value: 63 }],
}

const historyItem = (over: Record<string, unknown> = {}) => ({
  connId: 'c1', connection: 'PVE-PROD', vmid: 300, name: 'hist-01', node: 'pve1', type: 'qemu', status: 'running', value: 42.25, samples: 50, ...over,
})

const history = (items: unknown[], over: Record<string, unknown> = {}) => ({
  metric: 'cpu', agg: 'avg', unit: 'percent', from: '2026-10-19T01:00:00.000Z', to: '2026-10-19T07:00:00.000Z', firstSampleAt: null, items, ...over,
})

const render = (settings: Record<string, unknown> = {}, props: Record<string, unknown> = {}) => {
  const onUpdateSettings = vi.fn()

  renderWithProviders(
    <TopConsumersWidget data={data} loading={false} config={{ settings }} onUpdateSettings={onUpdateSettings} timeRange='6h' {...props} />,
  )

  return onUpdateSettings
}

const fetchedUrl = () => new URL((vi.mocked(fetch).mock.calls[0][0] as string), 'http://test.local')

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(history([]))))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  localStorage.clear()
  licenseMock.mockReset().mockReturnValue({ isEnterprise: true })
})

describe('resolveSettings', () => {
  it('defaults to live CPU, top 10, average', () => {
    expect(resolveSettings(undefined, null)).toEqual({
      metric: 'cpu', period: 'live', agg: 'avg', limit: 10, customFrom: null, customTo: null, selectedConnections: [],
    })
  })

  it('seeds the metric from the pre-#1129 localStorage key only when the settings carry none', () => {
    const storage = { getItem: () => 'ram' }

    expect(resolveSettings({ settings: {} }, storage).metric).toBe('ram')
    expect(resolveSettings({ settings: { metric: 'netin' } }, storage).metric).toBe('netin')
    expect(resolveSettings({ settings: {} }, { getItem: () => { throw new Error('blocked') } }).metric).toBe('cpu')
  })

  it('drops anything it does not know', () => {
    const s = resolveSettings({ settings: { metric: 'gpu', period: 'yesterday', agg: 'p99', limit: 15, customFrom: 42, selectedConnections: ['c1', 7] } }, null)

    expect(s).toMatchObject({ metric: 'cpu', period: 'live', agg: 'avg', limit: 10, customFrom: null, selectedConnections: ['c1'] })
  })
})

describe('buildTopConsumersQuery', () => {
  const base = { metric: 'cpu', period: 'live', agg: 'max', limit: 20, customFrom: null, customTo: null, selectedConnections: [] }
  const now = Date.parse('2026-10-19T07:00:00.000Z')

  it('reads the payload for live CPU / RAM', () => {
    expect(hasUsableWindow(base)).toBe(false)
    expect(buildTopConsumersQuery(base, 'hour', now)).toBeNull()
    expect(buildTopConsumersQuery({ ...base, metric: 'ram' }, 'hour', now)).toBeNull()
    expect(hasUsableWindow({ ...base, period: 'dashboard' })).toBe(true)
  })

  it('averages the last five minutes for a live IO rate', () => {
    const q = new URLSearchParams(buildTopConsumersQuery({ ...base, metric: 'netin' }, 'hour', now) as string)

    expect(q.get('metric')).toBe('netin')
    expect(q.get('agg')).toBe('avg')
    expect(q.get('from')).toBe('2026-10-19T06:55:00.000Z')
    expect(q.get('to')).toBe('2026-10-19T07:00:00.000Z')
    expect(q.get('limit')).toBe('20')
    expect(q.has('connections')).toBe(false)
  })

  it('follows the dashboard range and carries the connection filter', () => {
    const q = new URLSearchParams(buildTopConsumersQuery({ ...base, period: 'dashboard', selectedConnections: ['c1', 'c2'] }, 'week', now) as string)

    expect(q.get('from')).toBe('2026-10-12T07:00:00.000Z')
    expect(q.get('agg')).toBe('max')
    expect(q.get('connections')).toBe('c1,c2')
  })

  it('uses the custom window as given and refuses an unusable one', () => {
    const custom = { ...base, period: 'custom', customFrom: '2026-10-19T05:00:00.000Z', customTo: '2026-10-19T06:00:00.000Z' }
    const q = new URLSearchParams(buildTopConsumersQuery(custom, 'hour', now) as string)

    expect(q.get('from')).toBe('2026-10-19T05:00:00.000Z')
    expect(q.get('to')).toBe('2026-10-19T06:00:00.000Z')
    expect(buildTopConsumersQuery({ ...custom, customTo: null }, 'hour', now)).toBeNull()
    expect(buildTopConsumersQuery({ ...custom, customFrom: custom.customTo }, 'hour', now)).toBeNull()
    expect(buildTopConsumersQuery({ ...custom, customFrom: 'never' }, 'hour', now)).toBeNull()
  })
})

describe('formatTopValue', () => {
  it('prints a percent with one decimal, capped at 100', () => {
    expect(formatTopValue(87.44, 'percent')).toBe('87.4%')
    expect(formatTopValue(12, 'percent')).toBe('12%')
    expect(formatTopValue(140, 'percent')).toBe('100%')
  })

  it('prints a byte rate in binary units', () => {
    expect(formatTopValue(1572864, 'bytes_per_second')).toBe('1.5 MB/s')
    expect(formatTopValue(512, 'bytes_per_second')).toBe('512 B/s')
    expect(formatTopValue(undefined, 'bytes_per_second')).toBe('-')
  })
})

describe('formatCustomRange', () => {
  it('repeats the day only when the window crosses midnight', () => {
    const d = (h: number, day = 19) => new Date(2026, 9, day, h, 0).toISOString()

    expect(formatCustomRange(d(7), d(9))).toBe('19/10 07:00 → 09:00')
    expect(formatCustomRange(d(22), d(2, 20))).toBe('19/10 22:00 → 20/10 02:00')
    expect(formatCustomRange('x', d(9))).toBe('')
  })
})

describe('listConnections', () => {
  it('names the connections the nodes expose', () => {
    expect(listConnections(data)).toEqual([{ id: 'c2', name: 'PVE-DR' }, { id: 'c1', name: 'PVE-PROD' }])
    expect(listConnections({ nodes: [{ connId: 'c9' }], clusters: [{ id: 'c9', name: 'Named' }] })).toEqual([{ id: 'c9', name: 'Named' }])
  })
})

describe('TopConsumersWidget', () => {
  it('keeps the live CPU / RAM toggle in Community, seeded from the old localStorage key', () => {
    licenseMock.mockReturnValue({ isEnterprise: false })
    localStorage.setItem('dashboard-top-consumers-mode', 'ram')
    const onUpdateSettings = render()

    expect(screen.getByText('db-01')).toBeInTheDocument()
    expect(screen.getByText('63%')).toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('CPU'))

    expect(screen.getByText('web-01')).toBeInTheDocument()
    expect(screen.getByText('87.4%')).toBeInTheDocument()
    expect(screen.getByText('#100')).toBeInTheDocument()
    expect(screen.getAllByTestId('top-consumers-row')).toHaveLength(2)
    expect(localStorage.getItem('dashboard-top-consumers-mode')).toBe('cpu')
    expect(onUpdateSettings).toHaveBeenCalledWith({ metric: 'cpu' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('ignores an IO metric left in the settings in Community', () => {
    licenseMock.mockReturnValue({ isEnterprise: false })
    render({ metric: 'netin', period: 'dashboard' })

    expect(screen.getByText('web-01')).toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('reads live CPU from the dashboard payload in Enterprise, without any history call', () => {
    render()

    expect(screen.getByRole('combobox', { name: 'Metric' })).toHaveTextContent('CPU')
    expect(screen.getByRole('combobox', { name: 'Period' })).toHaveTextContent('Live')
    expect(screen.getByText('web-01')).toBeInTheDocument()
    expect(screen.getByText('proxy-01')).toBeInTheDocument()
    expect(screen.queryByText('Avg')).not.toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('fetches the dashboard range with the chosen aggregation and size', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(history([historyItem()])))
    render({ period: 'dashboard', agg: 'max', limit: 20 })

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    const url = fetchedUrl()

    expect(url.pathname).toBe('/api/v1/dashboard/top-consumers')
    expect(url.searchParams.get('metric')).toBe('cpu')
    expect(url.searchParams.get('agg')).toBe('max')
    expect(url.searchParams.get('limit')).toBe('20')
    const span = Date.parse(url.searchParams.get('to') as string) - Date.parse(url.searchParams.get('from') as string)

    expect(span).toBe(6 * 3600 * 1000)
    expect(await screen.findByText('hist-01')).toBeInTheDocument()
    expect(screen.getByText('42.3%')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Period' })).toHaveTextContent('Dashboard (6h)')
    expect(screen.getByText('Peak')).toBeInTheDocument()
    expect(screen.getByText('50')).toBeInTheDocument()
  })

  it('fetches a custom window as given and shows it in the header', async () => {
    const customFrom = new Date(2026, 9, 19, 7, 0).toISOString()
    const customTo = new Date(2026, 9, 19, 9, 0).toISOString()

    render({ period: 'custom', customFrom, customTo })

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    const url = fetchedUrl()

    expect(url.searchParams.get('from')).toBe(customFrom)
    expect(url.searchParams.get('to')).toBe(customTo)
    expect(screen.getByTestId('top-consumers-range')).toHaveTextContent('19/10 07:00 → 09:00')
  })

  it('formats an IO rate and scales its bar on the largest row', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(history(
      [historyItem({ name: 'bulk-01', value: 1572864 }), historyItem({ vmid: 301, name: 'quiet-01', value: 786432 })],
      { metric: 'netin', unit: 'bytes_per_second' },
    )))
    render({ metric: 'netin' })

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    expect(fetchedUrl().searchParams.get('agg')).toBe('avg')
    expect(await screen.findByText('1.5 MB/s')).toBeInTheDocument()
    expect(screen.getByText('768.0 KB/s')).toBeInTheDocument()
    // Live hides the aggregation but offers the size.
    expect(screen.queryByText('Avg')).not.toBeInTheDocument()
    expect(screen.getByText('20')).toBeInTheDocument()
  })

  it('says the history needs the orchestrator when none answers', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ available: false, items: [] }))
    render({ period: 'dashboard' })

    expect(await screen.findByText('History needs the orchestrator')).toBeInTheDocument()
    expect(screen.queryByTestId('top-consumers-row')).not.toBeInTheDocument()
  })

  it('tells since when the history exists when the window starts before it', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(history([historyItem()], { firstSampleAt: '2026-10-19T03:00:00.000Z' })))
    render({ period: 'dashboard' })

    expect(await screen.findByText(/History available since/)).toBeInTheDocument()
  })

  it('shows no data on an empty history', async () => {
    render({ period: 'dashboard' })

    expect(await screen.findByText('No data')).toBeInTheDocument()
  })
})
