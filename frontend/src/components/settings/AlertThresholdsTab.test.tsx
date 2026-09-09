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
    // Only the retention field of the foot remains: the window field goes with the slider.
    expect(card.getAllByRole('spinbutton')).toHaveLength(1)
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
    expect(card.getByText('minutes of sustained latency before alerting')).toBeInTheDocument()
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
      'Resource Usage', 'Performance & replication', 'Snapshots', 'Collection & recovery',
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
