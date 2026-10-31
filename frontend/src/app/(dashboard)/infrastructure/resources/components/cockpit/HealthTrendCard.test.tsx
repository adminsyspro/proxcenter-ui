import { describe, it, expect, afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { ResponsiveContainer } from 'recharts'

import { renderWithProviders, screen } from '@/__tests__/setup/renderWithProviders'

// jsdom gives every element a zero size; a fixed container lets the chart mount.
vi.mock('@/components/ChartContainer', () => ({
  default: ({ children }: { children: React.ReactElement }) => (
    <ResponsiveContainer width={600} height={150}>{children}</ResponsiveContainer>
  ),
}))

import type { HealthScoreHistoryEntry } from '../../types'
import HealthTrendCard from './HealthTrendCard'

afterEach(cleanup)

const history = (scores: number[]): HealthScoreHistoryEntry[] =>
  scores.map((score, i) => ({ date: `2026-10-${String(i + 1).padStart(2, '0')}`, score }))

describe('HealthTrendCard', () => {
  it('waits for a second snapshot before drawing a trend', () => {
    const { container } = renderWithProviders(<HealthTrendCard history={history([80])} />)

    expect(screen.getByText('1 daily snapshots')).toBeInTheDocument()
    expect(screen.getByText('The trend appears after two days of snapshots')).toBeInTheDocument()
    expect(screen.queryByText(/^Low /)).toBeNull()
    expect(screen.queryByText('+0')).toBeNull()
    expect(container.querySelector('.recharts-surface')).toBeNull()
  })

  it('shows nothing to compare on an empty history', () => {
    renderWithProviders(<HealthTrendCard history={[]} />)

    expect(screen.getByText('0 daily snapshots')).toBeInTheDocument()
    expect(screen.getByText('The trend appears after two days of snapshots')).toBeInTheDocument()
  })

  it('draws the trend with the gain since the first day, the low and the high', () => {
    const { container } = renderWithProviders(<HealthTrendCard history={history([70, 64, 82, 75])} />)

    expect(screen.getByText('4 daily snapshots')).toBeInTheDocument()
    expect(screen.getByText('+5')).toBeInTheDocument()
    expect(screen.getByText('Low 64')).toBeInTheDocument()
    expect(screen.getByText('High 82')).toBeInTheDocument()
    expect(container.querySelector('.recharts-surface')).not.toBeNull()
  })

  it('shows a drop in red', () => {
    renderWithProviders(<HealthTrendCard history={history([90, 81])} />)

    expect(screen.getByText('-9')).toHaveStyle({ color: 'rgb(239, 68, 68)' })
  })
})
