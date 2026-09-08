import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen, userEvent, waitFor, within } from '@/__tests__/setup/renderWithProviders'

import AlertThresholdsTab from './AlertThresholdsTab'

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

async function diskLatencyCard() {
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
    expect(retentionField(card)).toHaveValue(30)
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
    expect(retentionField(card)).toHaveValue(30)
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
