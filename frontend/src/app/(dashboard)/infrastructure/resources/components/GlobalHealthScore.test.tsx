import { describe, it, expect, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen, fireEvent, userEvent } from '@/__tests__/setup/renderWithProviders'

import type { KpiData, PredictiveAlert } from '../types'
import type { HealthScoreBreakdown } from '../algorithms/healthScore'
import GlobalHealthScore from './GlobalHealthScore'

afterEach(cleanup)

const kpis: KpiData = {
  cpu: { used: 41.4, allocated: 120, total: 64, trend: 0 },
  ram: { used: 67.6, allocated: 500, total: 512, trend: 0 },
  storage: { used: 300, total: 1000, trend: 0 },
  vms: { total: 12, running: 9, stopped: 3 },
  efficiency: 73,
}

function alert(resource: PredictiveAlert['resource'], severity: PredictiveAlert['severity']): PredictiveAlert {
  return { resource, currentValue: 80, predictedValue: 95, daysToThreshold: 10, threshold: 90, trend: 'up', severity }
}

const breakdown: HealthScoreBreakdown = {
  cpu: { penalty: 0, reason: '41% (good)' },
  ram: { penalty: -4, reason: '86% (warning)' },
  storage: { penalty: -12, reason: '95% (critical)' },
  alerts: { penalty: -10, reason: '2 critical, 1 warning' },
  efficiency: { penalty: 5, reason: '73% (excellent)' },
  stoppedVms: { penalty: 0, reason: '3 stopped' },
}

describe('GlobalHealthScore', () => {
  it('shows a skeleton while loading', () => {
    renderWithProviders(<GlobalHealthScore score={88} kpis={kpis} alerts={[]} breakdown={breakdown} loading />)

    expect(screen.queryByText('88')).toBeNull()
    expect(screen.queryByText('Infrastructure Health')).toBeNull()
  })

  it.each([
    [92, 'Excellent'],
    [80, 'Excellent'],
    [65, 'Good'],
    [45, 'Needs monitoring'],
    [12, 'Critical'],
  ])('labels a score of %i as %s', (score, label) => {
    renderWithProviders(<GlobalHealthScore score={score} kpis={kpis} alerts={[]} breakdown={null} />)

    expect(screen.getByText(String(score))).toBeInTheDocument()
    expect(screen.getByText(label)).toBeInTheDocument()
  })

  it('shows guests, efficiency, alert counts and the three usage bars', () => {
    const alerts = [alert('cpu', 'critical'), alert('ram', 'critical'), alert('storage', 'warning'), alert('cpu', 'ok')]

    renderWithProviders(<GlobalHealthScore score={70} kpis={kpis} alerts={alerts} breakdown={null} />)

    expect(screen.getByText('9')).toBeInTheDocument()
    expect(screen.getByText('/ 12')).toBeInTheDocument()
    expect(screen.getByText('73%')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('41%')).toBeInTheDocument()
    expect(screen.getByText('68%')).toBeInTheDocument()
    expect(screen.getByText('30%')).toBeInTheDocument()
    expect(screen.getAllByRole('progressbar').filter(p => p.classList.contains('MuiLinearProgress-root'))).toHaveLength(3)
    // No breakdown, no button to open it.
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('falls back to zeros without KPIs and shows a green zero without alerts', () => {
    const empty: KpiData = { ...kpis, storage: { used: 0, total: 0, trend: 0 } }
    const { rerender } = renderWithProviders(<GlobalHealthScore score={50} kpis={null} alerts={[]} breakdown={null} />)

    expect(screen.getByText('/ 0')).toBeInTheDocument()
    expect(screen.getByText('0%', { selector: 'h6' })).toBeInTheDocument()
    expect(screen.getAllByText('0%')).toHaveLength(4)
    // Running guests and alerts both read 0; the alert zero is the green one.
    const zeros = screen.getAllByText('0', { selector: 'h6' })

    expect(zeros).toHaveLength(2)
    expect(zeros[1]).toHaveStyle({ color: 'rgb(34, 197, 94)' })

    rerender(<GlobalHealthScore score={50} kpis={empty} alerts={[]} breakdown={null} />)
    expect(screen.getAllByText('0%')).toHaveLength(1)
  })

  it('opens the score breakdown with translated reasons and signed penalties', () => {
    renderWithProviders(<GlobalHealthScore score={70} kpis={kpis} alerts={[]} breakdown={breakdown} />)

    const toggle = screen.getByRole('button', { name: 'Show score breakdown' })

    fireEvent.click(toggle)
    expect(screen.getByRole('button', { name: 'Hide details' })).toBeInTheDocument()

    expect(screen.getByText('Score Breakdown')).toBeInTheDocument()
    expect(screen.getByText('41% (Good)')).toBeInTheDocument()
    expect(screen.getByText('86% (Warning)')).toBeInTheDocument()
    expect(screen.getByText('95% (Critical)')).toBeInTheDocument()
    expect(screen.getByText('2 Critical, 1 Warning')).toBeInTheDocument()
    expect(screen.getByText('73% (Excellent)')).toBeInTheDocument()
    expect(screen.getByText('3 stopped')).toBeInTheDocument()

    expect(screen.getByText('+5')).toBeInTheDocument()
    expect(screen.getByText('-4')).toBeInTheDocument()
    expect(screen.getByText('-12')).toBeInTheDocument()
    expect(screen.getByText('-10')).toBeInTheDocument()
    expect(screen.getAllByText('0', { selector: '.MuiChip-label' })).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', { name: 'Hide details' }))
    expect(screen.getByRole('button', { name: 'Show score breakdown' })).toBeInTheDocument()
  })

  it('summarises the calculation in the tooltip of the score dial', async () => {
    const user = userEvent.setup()
    const quiet: HealthScoreBreakdown = {
      ...breakdown,
      cpu: { penalty: 3, reason: '20% (underused)' },
      alerts: { penalty: 0, reason: 'No alerts' },
    }

    renderWithProviders(<GlobalHealthScore score={70} kpis={kpis} alerts={[]} breakdown={quiet} />)
    await user.hover(screen.getByText('70'))

    const tooltip = await screen.findByRole('tooltip')

    expect(tooltip).toHaveTextContent('Score calculation (base 100)')
    expect(tooltip).toHaveTextContent('CPU: 20% (underused) (+3)')
    expect(tooltip).toHaveTextContent('RAM: 86% (Warning) (-4)')
    expect(tooltip).toHaveTextContent('Storage: 95% (Critical) (-12)')
    expect(tooltip).toHaveTextContent('Alerts: No alerts (OK)')
    expect(tooltip).toHaveTextContent('Efficiency: 73% (Excellent) (+5)')
    expect(tooltip).toHaveTextContent('VMs off: 3 stopped (OK)')
  })

  it('shows the alert and stopped-guest penalties in the tooltip when they apply', async () => {
    const user = userEvent.setup()
    const heavy: HealthScoreBreakdown = {
      ...breakdown,
      cpu: { penalty: -2, reason: '85% (warning)' },
      ram: { penalty: 0, reason: '50% (good)' },
      storage: { penalty: 0, reason: '50% (good)' },
      efficiency: { penalty: -3, reason: '20%' },
      stoppedVms: { penalty: -5, reason: '9 stopped' },
    }

    renderWithProviders(<GlobalHealthScore score={30} kpis={kpis} alerts={[]} breakdown={heavy} />)
    await user.hover(screen.getByText('30'))

    const tooltip = await screen.findByRole('tooltip')

    expect(tooltip).toHaveTextContent('CPU: 85% (Warning) (-2)')
    expect(tooltip).toHaveTextContent('RAM: 50% (Good) (OK)')
    expect(tooltip).toHaveTextContent('Storage: 50% (Good) (OK)')
    expect(tooltip).toHaveTextContent('Alerts: 2 Critical, 1 Warning (-10)')
    expect(tooltip).toHaveTextContent('Efficiency: 20% (-3)')
    expect(tooltip).toHaveTextContent('VMs off: 9 stopped (-5)')
  })
})
