import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen, userEvent, waitFor, within } from '@/__tests__/setup/renderWithProviders'

import AlertThresholdsTab, { formatCalm, formatSeconds } from './AlertThresholdsTab'

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }))

const endpoint = '/api/v1/settings/alerts/thresholds'

beforeEach(() => {
  fetchMock.mockReset().mockImplementation(async (_url: string, options?: RequestInit) => ({
    ok: true,
    json: async () => options?.method === 'PUT'
      ? JSON.parse(options.body as string)
      : { disk_latency_warning: 0, disk_latency_critical: 100, disk_latency_window_minutes: 5 },
  }))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

// The families sit on sub-tabs and only the active one is rendered: open the
// one that holds the card before looking for it. A plain DOM click reaches the
// MUI Tab's onChange, no user-event session needed.
async function openSection(name: string) {
  ;(await screen.findByRole('tab', { name })).click()
}

async function diskLatencyCard() {
  await openSection('Performance & replication')
  const title = await screen.findByText('Guest disk latency')

  return within(title.closest('.MuiCard-root') as HTMLElement)
}

// The card carries two switches (the alert toggle in its title, the collection
// switch in its foot) and two number fields (window, retention): pick by order
// and by accessible name rather than by role alone.
const alertSwitch = (card: ReturnType<typeof within>) => card.getAllByRole('switch')[0]
const collectionSwitch = (card: ReturnType<typeof within>) => card.getByRole('switch', { name: /Collect the latency/ })
const windowField = (card: ReturnType<typeof within>) => card.getAllByRole('spinbutton')[0]
const retentionField = (card: ReturnType<typeof within>) => card.getAllByRole('spinbutton').slice(-1)[0]

describe('AlertThresholdsTab guest disk latency', () => {
  it('renders Disabled when the fetched warning threshold is zero', async () => {
    renderWithProviders(<AlertThresholdsTab />)
    const card = await diskLatencyCard()

    expect(fetchMock).toHaveBeenCalledWith(endpoint)
    expect(card.getByText('Disabled')).toBeInTheDocument()
    expect(alertSwitch(card)).not.toBeChecked()
    expect(card.queryByRole('slider')).not.toBeInTheDocument()
    // The window also frames the peak check and the max figures of the lists,
    // so it sits in the foot with the retention, whatever the alert toggle.
    expect(card.getAllByRole('spinbutton')).toHaveLength(2)
    expect(windowField(card)).toHaveValue(5)
    expect(retentionField(card)).toHaveValue(7)
  })

  it('shows the latency slider, description and five-minute window when enabled', async () => {
    const user = userEvent.setup()

    renderWithProviders(<AlertThresholdsTab />)
    const card = await diskLatencyCard()

    await user.click(alertSwitch(card))

    expect(alertSwitch(card)).toBeChecked()
    expect(card.queryByText('Disabled')).not.toBeInTheDocument()
    expect(card.getAllByRole('slider').map(slider => slider.getAttribute('aria-valuenow'))).toEqual(['30', '100'])
    expect(card.getByText('Alert when a virtual disk, or a whole storage, stays slower than these values for the window below')).toBeInTheDocument()
    expect(card.getByText('minutes of window: how long the average must hold, and how long a peak is remembered')).toBeInTheDocument()
    expect(windowField(card)).toHaveValue(5)
  })

  it('saves an edited window with enabled thresholds, then saves zero warning when disabled again', async () => {
    const user = userEvent.setup()

    renderWithProviders(<AlertThresholdsTab />)
    const card = await diskLatencyCard()

    await user.click(alertSwitch(card))
    await user.clear(windowField(card))
    await user.type(windowField(card), '10')
    expect(windowField(card)).toHaveValue(10)
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(endpoint, expect.objectContaining({
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: expect.any(String),
    })))
    const puts = () => fetchMock.mock.calls.filter(([, options]) => options?.method === 'PUT')

    expect(puts()).toHaveLength(1)
    expect(JSON.parse(puts()[0][1].body)).toMatchObject({
      disk_latency_window_minutes: 10, disk_latency_warning: 30, disk_latency_critical: 100,
    })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled())
    await user.click(alertSwitch(card))
    expect(card.getByText('Disabled')).toBeInTheDocument()
    expect(alertSwitch(card)).not.toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(puts()).toHaveLength(2))
    expect(JSON.parse(puts()[1][1].body)).toMatchObject({
      disk_latency_window_minutes: 10, disk_latency_warning: 0, disk_latency_critical: 100,
    })
  })

  it('keeps the collection switch and the retention field whatever the alert toggle, and saves them', async () => {
    const user = userEvent.setup()

    renderWithProviders(<AlertThresholdsTab />)
    const card = await diskLatencyCard()

    expect(alertSwitch(card)).not.toBeChecked()
    expect(collectionSwitch(card)).toBeChecked()
    expect(retentionField(card)).toHaveValue(7)
    expect(retentionField(card)).toBeEnabled()

    await user.clear(retentionField(card))
    await user.type(retentionField(card), '45')
    await user.click(collectionSwitch(card))
    expect(collectionSwitch(card)).not.toBeChecked()
    expect(retentionField(card)).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'PUT')).toBe(true))
    const put = fetchMock.mock.calls.find(([, options]) => options?.method === 'PUT')
    expect(JSON.parse(put[1].body)).toMatchObject({
      disk_latency_collection: 0, disk_latency_retention_days: 45, disk_latency_warning: 0,
    })
  })
})

async function peakCard() {
  await openSection('Performance & replication')
  const title = await screen.findByText('Guest disk latency peak')

  return within(title.closest('.MuiCard-root') as HTMLElement)
}

describe('AlertThresholdsTab guest disk latency peak', () => {
  it('is disabled by default, independently of the average check', async () => {
    renderWithProviders(<AlertThresholdsTab />)
    const card = await peakCard()

    expect(card.getByText('Disabled')).toBeInTheDocument()
    expect(card.getByRole('switch')).not.toBeChecked()
    expect(card.queryByRole('slider')).not.toBeInTheDocument()
  })

  it('offers 100 / 500 ms on a 5 / 500 / 1000 ms scale once enabled, says a peak is one collection interval, and leaves the average pair alone', async () => {
    const user = userEvent.setup()

    renderWithProviders(<AlertThresholdsTab />)
    const card = await peakCard()

    await user.click(card.getByRole('switch'))

    expect(card.getAllByRole('slider').map(slider => slider.getAttribute('aria-valuenow'))).toEqual(['100', '500'])
    expect(card.getByText(/worst collection interval of the window/)).toBeInTheDocument()
    expect(card.getByText('A peak is the latency of one collection interval (1 min), not of a single I/O')).toBeInTheDocument()
    expect(['5 ms', '500 ms', '1000 ms'].every(mark => card.getAllByText(mark).length > 0)).toBe(true)
    expect(card.queryByText('503 ms')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'PUT')).toBe(true))
    const put = fetchMock.mock.calls.find(([, options]) => options?.method === 'PUT')
    expect(JSON.parse(put[1].body)).toMatchObject({
      disk_latency_peak_warning: 100, disk_latency_peak_critical: 500, disk_latency_warning: 0, disk_latency_critical: 100,
    })
  })
})

// The card is a slider bounded to what the orchestrator accepts (30 s to
// 10 min, 30 s steps): the bounds are the control, nothing can be typed outside
// them. Driven from the keyboard, the way a slider is testable.
describe('AlertThresholdsTab metrics collection interval', () => {
  const intervalSlider = () => screen.getByRole('slider', { name: 'Collection interval' })

  it('shows the default cadence and its recovery caption, and saves a value moved by one step', async () => {
    const user = userEvent.setup()

    renderWithProviders(<AlertThresholdsTab />)
    await openSection('Collection & recovery')
    await screen.findByText('Collection interval')

    expect(intervalSlider()).toHaveValue('60')
    expect(screen.getAllByText('1 min').length).toBeGreaterThan(0)
    expect(screen.getByText(/3 recovery confirmations, an alert resolves after 3 min/)).toBeInTheDocument()

    intervalSlider().focus()
    await user.keyboard('{ArrowRight}{ArrowRight}')
    expect(intervalSlider()).toHaveValue('120')
    expect(screen.getByText(/resolves after 6 min/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'PUT')).toBe(true))
    const put = fetchMock.mock.calls.find(([, options]) => options?.method === 'PUT')
    expect(JSON.parse(put[1].body)).toMatchObject({ metrics_interval_seconds: 120 })
  })

  it('keeps 14 days of history by default and saves an edited retention, capped at 365', async () => {
    const user = userEvent.setup()

    renderWithProviders(<AlertThresholdsTab />)
    await openSection('Collection & recovery')
    const retention = await screen.findByRole('spinbutton', { name: 'days of metrics history kept' })

    expect(retention).toHaveValue(14)
    await user.clear(retention)
    await user.type(retention, '500')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'PUT')).toBe(true))
    const put = fetchMock.mock.calls.find(([, options]) => options?.method === 'PUT')
    expect(JSON.parse(put[1].body)).toMatchObject({ metrics_retention_days: 365 })
  })

  it('cannot leave the 30 s to 10 min range', async () => {
    const user = userEvent.setup()

    renderWithProviders(<AlertThresholdsTab />)
    await openSection('Collection & recovery')
    await screen.findByText('Collection interval')

    expect(intervalSlider()).toHaveAttribute('min', '30')
    expect(intervalSlider()).toHaveAttribute('max', '600')
    intervalSlider().focus()
    await user.keyboard('{End}{ArrowRight}')
    expect(intervalSlider()).toHaveValue('600')
    expect(screen.getByText(/resolves after 30 min/)).toBeInTheDocument()
    await user.keyboard('{Home}{ArrowLeft}')
    expect(intervalSlider()).toHaveValue('30')
    expect(screen.getByText(/resolves after 1 min 30 s/)).toBeInTheDocument()
  })

  it('formats durations and the calm before recovery the way an operator says them', () => {
    expect(formatSeconds(30)).toBe('30 s')
    expect(formatSeconds(60)).toBe('1 min')
    expect(formatSeconds(150)).toBe('2 min 30 s')
    expect(formatCalm(60, 3)).toBe('3 min')
    expect(formatCalm(30, 3)).toBe('1 min 30 s')
    expect(formatCalm(30, 0)).toBe('30 s')
  })
})

describe('AlertThresholdsTab sub-tabs', () => {
  it('opens on resource usage and shows one family at a time', async () => {
    renderWithProviders(<AlertThresholdsTab />)

    expect(await screen.findByText('CPU')).toBeInTheDocument()
    expect(screen.getAllByRole('tab').map(tab => tab.textContent)).toEqual([
      'Resource Usage', 'Performance & replication', 'Snapshots', 'Collection & recovery', 'Network Flows',
    ])
    expect(screen.queryByText('Guest disk latency')).not.toBeInTheDocument()

    await openSection('Snapshots')
    expect(await screen.findByText('Stale Snapshots')).toBeInTheDocument()
    expect(screen.queryByText('CPU')).not.toBeInTheDocument()
  })

  it('saves every family, including the ones on other sub-tabs', async () => {
    const user = userEvent.setup()

    renderWithProviders(<AlertThresholdsTab />)
    await openSection('Collection & recovery')
    screen.getByRole('slider', { name: 'Collection interval' }).focus()
    await user.keyboard('{End}')
    await openSection('Resource Usage')
    await screen.findByText('CPU')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'PUT')).toBe(true))
    const put = fetchMock.mock.calls.find(([, options]) => options?.method === 'PUT')
    expect(JSON.parse(put[1].body)).toMatchObject({ metrics_interval_seconds: 600, cpu_warning: 80, snapshot_max_age_days: 7 })
  })
})

// roadmap#52: the telemetry delays are set here, in seconds, and saved with
// the rest. 0 s of timeout means the orchestrator derives it from polling.
describe('AlertThresholdsTab sFlow telemetry', () => {
  async function telemetryCard() {
    await openSection('Network Flows')
    const title = await screen.findByText('sFlow telemetry')

    return within(title.closest('.MuiCard-root') as HTMLElement)
  }

  it('is on by default with the automatic timeout and five minutes of grace', async () => {
    renderWithProviders(<AlertThresholdsTab />)
    const card = await telemetryCard()

    expect(card.getByRole('switch')).toBeChecked()
    expect(card.getByRole('spinbutton', { name: /seconds of silence/ })).toHaveValue(0)
    expect(card.getByRole('spinbutton', { name: /seconds of grace/ })).toHaveValue(300)
    expect(card.getByText(/Automatic: four counter polls/)).toBeInTheDocument()
    expect(card.getByText(/may stay silent for 5 min/)).toBeInTheDocument()
  })

  it('explains a fixed timeout and saves both delays, then zero when switched off', async () => {
    const user = userEvent.setup()
    renderWithProviders(<AlertThresholdsTab />)
    const card = await telemetryCard()

    const timeout = card.getByRole('spinbutton', { name: /seconds of silence/ })
    await user.clear(timeout)
    await user.type(timeout, '600')
    expect(card.getByText(/silent for more than 10 min is reported missing/)).toBeInTheDocument()
    const grace = card.getByRole('spinbutton', { name: /seconds of grace/ })
    await user.clear(grace)
    await user.type(grace, '900')

    await user.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(endpoint, expect.objectContaining({ method: 'PUT' })))
    const saved = JSON.parse((fetchMock.mock.calls.find(c => c[1]?.method === 'PUT')![1] as RequestInit).body as string)
    expect(saved).toMatchObject({ sflow_telemetry_alerts: 1, sflow_telemetry_timeout_seconds: 600, sflow_telemetry_grace_seconds: 900 })

    fetchMock.mockClear()
    await user.click(card.getByRole('switch'))
    expect(card.getByText('Disabled')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(endpoint, expect.objectContaining({ method: 'PUT' })))
    const off = JSON.parse((fetchMock.mock.calls.find(c => c[1]?.method === 'PUT')![1] as RequestInit).body as string)
    expect(off).toMatchObject({ sflow_telemetry_alerts: 0, sflow_telemetry_timeout_seconds: 600, sflow_telemetry_grace_seconds: 900 })
  })

  it('runs the telemetry check right after a save', async () => {
    const user = userEvent.setup()
    renderWithProviders(<AlertThresholdsTab />)
    await telemetryCard()
    await user.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/v1/orchestrator/sflow/health/check', { method: 'POST' }))
  })
})
