import { describe, it, expect, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen, userEvent } from '@/__tests__/setup/renderWithProviders'

import type { PredictiveAlert } from '../types'
import PredictiveAlertsCard from './PredictiveAlertsCard'

afterEach(cleanup)

const RED = 'rgb(239, 68, 68)'
const ORANGE = 'rgb(245, 158, 11)'

function alert(resource: PredictiveAlert['resource'], over: Partial<PredictiveAlert> = {}): PredictiveAlert {
  return {
    resource,
    currentValue: 40,
    predictedValue: 55,
    daysToThreshold: 200,
    threshold: 90,
    trend: 'up',
    severity: 'ok',
    ...over,
  }
}

const dials = (container: HTMLElement) => Array.from(container.querySelectorAll('svg[viewBox="0 0 132 132"]'))

describe('PredictiveAlertsCard', () => {
  it('shows skeletons and no error figure while loading', () => {
    const { container } = renderWithProviders(<PredictiveAlertsCard alerts={[alert('cpu', { forecastError: 2 })]} loading />)

    expect(screen.getByText('30-day forecast')).toBeInTheDocument()
    expect(screen.queryByText(/measured error/)).toBeNull()
    expect(screen.queryByText('now')).toBeNull()
    expect(container.querySelectorAll('.MuiSkeleton-circular')).toHaveLength(3)
  })

  it('shows one dial per resource with its value now, its forecast and its runway', () => {
    const alerts = [
      alert('cpu', { currentValue: 62.4, predictedValue: 77.6, daysToThreshold: 20 }),
      alert('ram', { currentValue: 70, predictedValue: 80, daysToThreshold: 60 }),
      alert('storage', { currentValue: 30, predictedValue: 31, daysToThreshold: null }),
    ]

    renderWithProviders(<PredictiveAlertsCard alerts={alerts} />)

    expect(screen.getByText('CPU')).toBeInTheDocument()
    expect(screen.getByText('Memory')).toBeInTheDocument()
    expect(screen.getByText('Storage')).toBeInTheDocument()
    expect(screen.getByText('62%')).toBeInTheDocument()
    expect(screen.getByText('→ 78%')).toBeInTheDocument()

    expect(screen.getByText('20 d before 90%')).toHaveStyle({ color: RED })
    expect(screen.getByText('60 d before 90%')).toHaveStyle({ color: ORANGE })
    expect(screen.getByText('beyond a year')).toBeInTheDocument()

    expect(screen.getByText('now')).toBeInTheDocument()
    expect(screen.getByText('in 30 days')).toBeInTheDocument()
    expect(screen.getByText('past the critical threshold')).toBeInTheDocument()
  })

  it('says a crossed threshold in red and keeps a far runway neutral', () => {
    renderWithProviders(<PredictiveAlertsCard alerts={[alert('cpu', { daysToThreshold: 0, threshold: 85 }), alert('ram', { daysToThreshold: 200 })]} />)

    expect(screen.getByText('85% threshold crossed')).toHaveStyle({ color: RED })
    expect(screen.getByText('200 d before 90%')).not.toHaveStyle({ color: RED })
    expect(screen.getByText('200 d before 90%')).not.toHaveStyle({ color: ORANGE })
  })

  it('draws the threshold zone, the forecast and the usage arcs only when they have a length', () => {
    const { container } = renderWithProviders(
      <PredictiveAlertsCard
        alerts={[
          // Track, red zone, forecast extension, usage now.
          alert('cpu', { currentValue: 40, predictedValue: 60, threshold: 90 }),
          // A falling forecast and a threshold at 100: track and usage only.
          alert('ram', { currentValue: 50, predictedValue: 30, threshold: 100 }),
          // Nothing used yet: track, red zone and the forecast.
          alert('storage', { currentValue: 0, predictedValue: 5, threshold: 90 }),
        ]}
      />,
    )

    expect(dials(container).map(svg => svg.querySelectorAll('path').length)).toEqual([4, 2, 3])
  })

  it('reports the measured error range in the header', () => {
    renderWithProviders(
      <PredictiveAlertsCard alerts={[alert('cpu', { forecastError: 1.24 }), alert('ram', { forecastError: 3.06 }), alert('storage', { forecastError: null })]} />,
    )

    expect(screen.getByText('measured error ±1.2 to ±3.1 pts')).toBeInTheDocument()
  })

  it('reports a single error when every forecast missed by the same', () => {
    renderWithProviders(<PredictiveAlertsCard alerts={[alert('cpu', { forecastError: 2 }), alert('ram', { forecastError: 2.04 })]} />)

    expect(screen.getByText('measured error ±2 pts')).toBeInTheDocument()
  })

  it('shows no error figure on a short history', () => {
    renderWithProviders(<PredictiveAlertsCard alerts={[alert('cpu')]} />)

    expect(screen.queryByText(/measured error/)).toBeNull()
  })

  it('explains trend, slope and error of a dial on hover', async () => {
    const user = userEvent.setup()

    renderWithProviders(
      <PredictiveAlertsCard alerts={[alert('cpu', { currentValue: 40, predictedValue: 55, trendType: 'accelerating', forecastError: 1.5 })]} />,
    )
    await user.hover(screen.getByText('CPU'))

    const tooltip = await screen.findByRole('tooltip')

    expect(tooltip).toHaveTextContent('Trend: Accelerating')
    expect(tooltip).toHaveTextContent('Slope: +0.50 points a day')
    expect(tooltip).toHaveTextContent('Mean error measured 14 days ahead: ±1.5 points')
  })

  it('shows a falling slope and leaves out what the alert does not carry', async () => {
    const user = userEvent.setup()

    renderWithProviders(<PredictiveAlertsCard alerts={[alert('ram', { currentValue: 60, predictedValue: 45 })]} />)
    await user.hover(screen.getByText('Memory'))

    const tooltip = await screen.findByRole('tooltip')

    expect(tooltip).toHaveTextContent('Slope: -0.50 points a day')
    expect(tooltip).not.toHaveTextContent('Trend:')
    expect(tooltip).not.toHaveTextContent('Mean error')
  })

  it('names an unknown resource by its key, without an icon', () => {
    const odd = { ...alert('cpu'), resource: 'gpu' } as unknown as PredictiveAlert
    const { container } = renderWithProviders(<PredictiveAlertsCard alerts={[odd]} />)

    expect(screen.getByText('gpu')).toBeInTheDocument()
    expect(container.querySelector('.ri-cpu-line')).toBeNull()
  })
})
