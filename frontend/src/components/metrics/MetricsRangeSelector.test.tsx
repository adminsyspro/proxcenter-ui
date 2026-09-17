import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen, fireEvent, waitFor } from '@/__tests__/setup/renderWithProviders'

import MetricsRangeSelector from './MetricsRangeSelector'

const NOW = 1_800_000_000

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(NOW * 1000)
})

afterEach(() => {
  // The suite has no global auto-cleanup, so renders would stack up.
  cleanup()
  vi.useRealTimers()
})

// The local-time round-trip the datetime-local fields expect (a UTC slice
// would shift the window by the container's offset).
function toInputValue(epochSeconds: number) {
  const d = new Date(epochSeconds * 1000)
  const p = (n: number) => String(n).padStart(2, '0')

  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

describe('MetricsRangeSelector', () => {
  it('reports a preset pick with no window', () => {
    const onChange = vi.fn()

    renderWithProviders(<MetricsRangeSelector timeframe="hour" window={null} onChange={onChange} />)

    fireEvent.click(screen.getByText('24h'))

    expect(onChange).toHaveBeenCalledWith({ timeframe: 'day', window: null })
  })

  it('turns a picked window into the archive that can serve it', async () => {
    const onChange = vi.fn()

    renderWithProviders(<MetricsRangeSelector timeframe="hour" window={null} onChange={onChange} />)

    fireEvent.click(screen.getByTestId('metrics-range-custom'))

    const from = NOW - 7_200
    const to = NOW - 6_600

    fireEvent.change(await screen.findByLabelText('From'), { target: { value: toInputValue(from) } })
    fireEvent.change(screen.getByLabelText('To'), { target: { value: toInputValue(to) } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))

    await waitFor(() => expect(onChange).toHaveBeenCalled())

    const value = onChange.mock.calls[0][0]

    // Two hours back: still inside the 24 h archive, which keeps the 60 s step.
    expect(value.timeframe).toBe('day')
    expect(value.window.from).toBeCloseTo(from, -2)
    expect(value.window.to).toBeCloseTo(to, -2)
  })

  it('refuses to apply a window that ends before it starts', async () => {
    const onChange = vi.fn()

    renderWithProviders(<MetricsRangeSelector timeframe="hour" window={null} onChange={onChange} />)

    fireEvent.click(screen.getByTestId('metrics-range-custom'))
    fireEvent.change(await screen.findByLabelText('From'), { target: { value: toInputValue(NOW - 600) } })
    fireEvent.change(screen.getByLabelText('To'), { target: { value: toInputValue(NOW - 1_200) } })

    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled()
    expect(screen.getByText('The end of the range must come after its start.')).toBeTruthy()
  })

  it('says so when the served window came back empty', () => {
    const window = { from: NOW - 3_630, to: NOW - 3_610 }

    renderWithProviders(
      <MetricsRangeSelector
        timeframe="day"
        window={window}
        meta={{ timeframe: 'day', stepSeconds: 60, from: window.from, to: window.to, points: 0, truncated: false }}
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByTestId('metrics-range-notice').textContent).toBe('No data point in this range.')
  })

  it('clears the window from the chip', () => {
    const onChange = vi.fn()
    const window = { from: NOW - 3_600, to: NOW }

    renderWithProviders(<MetricsRangeSelector timeframe="day" window={window} onChange={onChange} />)

    fireEvent.click(screen.getByTestId('CancelIcon'))

    expect(onChange).toHaveBeenCalledWith({ timeframe: 'day', window: null })
  })

  it('hides the custom entry where the source cannot honour a window', () => {
    renderWithProviders(<MetricsRangeSelector timeframe="hour" window={null} onChange={vi.fn()} allowCustom={false} />)

    expect(screen.queryByTestId('metrics-range-custom')).toBeNull()
  })
})
