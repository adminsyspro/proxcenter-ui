import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

import CopyRateLimitFields from './CopyRateLimitFields'

vi.mock('next-intl', () => ({
  useTranslations: () => (k: string, vals?: Record<string, unknown>) => (vals ? `${k} ${JSON.stringify(vals)}` : k),
}))

afterEach(() => cleanup())

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone

describe('CopyRateLimitFields', () => {
  it('gives no cap back as null', () => {
    const onChange = vi.fn()
    render(<CopyRateLimitFields value={{ mbps: 50 }} onChange={onChange} />)
    fireEvent.change(screen.getByTestId('copy-rate-input'), { target: { value: '' } })
    expect(onChange).toHaveBeenLastCalledWith(null)
  })

  it('sets a plain cap', () => {
    const onChange = vi.fn()
    render(<CopyRateLimitFields value={null} onChange={onChange} />)
    fireEvent.change(screen.getByTestId('copy-rate-input'), { target: { value: '40' } })
    expect(onChange).toHaveBeenLastCalledWith({ mbps: 40 })
  })

  it('hides the window rows until the window is turned on', () => {
    render(<CopyRateLimitFields value={{ mbps: 50 }} onChange={vi.fn()} />)
    expect(screen.queryByTestId('copy-rate-off-hours-row')).not.toBeInTheDocument()
    expect(screen.queryByTestId('copy-rate-from')).not.toBeInTheDocument()
  })

  it('turns the window on with office hours, the browser time zone and no cap outside', () => {
    const onChange = vi.fn()
    render(<CopyRateLimitFields value={{ mbps: 50 }} onChange={onChange} />)
    fireEvent.click(screen.getByTestId('copy-rate-schedule'))
    expect(onChange).toHaveBeenLastCalledWith({ mbps: 50, schedule: { from: '08:00', to: '19:00', tz: TZ, offHoursMbps: 0 } })
  })

  it('shows the window and the off-hours cap of a cap that has one, and edits them', () => {
    const onChange = vi.fn()
    const value = { mbps: 50, schedule: { from: '08:00', to: '19:00', tz: 'Europe/Paris', offHoursMbps: 0 } }
    render(<CopyRateLimitFields value={value} onChange={onChange} />)
    expect(screen.getByTestId('copy-rate-off-hours-row')).toBeInTheDocument()
    fireEvent.change(screen.getByTestId('copy-rate-from'), { target: { value: '07:30' } })
    expect(onChange).toHaveBeenLastCalledWith({ ...value, schedule: { ...value.schedule, from: '07:30' } })
    fireEvent.change(screen.getByTestId('copy-rate-off-hours-input'), { target: { value: '200' } })
    expect(onChange).toHaveBeenLastCalledWith({ ...value, schedule: { ...value.schedule, offHoursMbps: 200 } })
    // the zone is told by the info icon of the window, so the window fits a narrow dialog
    expect(screen.getByTestId('copy-rate-tz')).toHaveAttribute('aria-label', 'copyRate.timeZone {"tz":"Europe/Paris"}')
  })

  it('turns the window off and keeps the cap', () => {
    const onChange = vi.fn()
    render(<CopyRateLimitFields value={{ mbps: 50, schedule: { from: '08:00', to: '19:00', tz: 'Europe/Paris', offHoursMbps: 0 } }} onChange={onChange} />)
    fireEvent.click(screen.getByTestId('copy-rate-schedule'))
    expect(onChange).toHaveBeenLastCalledWith({ mbps: 50 })
  })

  it('keeps a window whose cap inside is unlimited (null only without a window)', () => {
    const onChange = vi.fn()
    const value = { mbps: 50, schedule: { from: '19:00', to: '07:00', tz: 'Europe/Paris', offHoursMbps: 20 } }
    render(<CopyRateLimitFields value={value} onChange={onChange} />)
    fireEvent.change(screen.getByTestId('copy-rate-input'), { target: { value: '' } })
    expect(onChange).toHaveBeenLastCalledWith({ mbps: 0, schedule: value.schedule })
  })

  it('says the cap is shared in a batch', () => {
    render(<CopyRateLimitFields value={null} onChange={vi.fn()} shared />)
    expect(screen.getByText('copyRate.sharedHelp')).toBeInTheDocument()
  })

  it('tells its parent when one of its fields holds an invalid value', () => {
    const onValidityChange = vi.fn()
    render(<CopyRateLimitFields value={{ mbps: 50, schedule: { from: '08:00', to: '19:00', tz: 'Europe/Paris', offHoursMbps: 0 } }} onChange={vi.fn()} onValidityChange={onValidityChange} />)
    fireEvent.change(screen.getByTestId('copy-rate-off-hours-input'), { target: { value: 'abc' } })
    expect(onValidityChange).toHaveBeenLastCalledWith(false)
    fireEvent.change(screen.getByTestId('copy-rate-off-hours-input'), { target: { value: '' } })
    expect(onValidityChange).toHaveBeenLastCalledWith(true)
  })
})
