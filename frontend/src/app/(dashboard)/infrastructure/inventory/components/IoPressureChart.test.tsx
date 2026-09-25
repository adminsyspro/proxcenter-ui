import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { ResponsiveContainer } from 'recharts'

import { renderWithProviders, screen } from '@/__tests__/setup/renderWithProviders'

import IoPressureChart, { IoPressureTooltip } from './IoPressureChart'

// ChartContainer renders nothing under jsdom (zero size); a fixed-size
// ResponsiveContainer lets the areas mount.
vi.mock('@/components/ChartContainer', () => ({
  default: ({ children }: { children: React.ReactNode }) => <ResponsiveContainer width={600} height={300}>{children}</ResponsiveContainer>,
}))

const labels = { title: 'IO Pressure Stall', heading: 'IO pressure', some: 'Some', full: 'Full' }
const series = [0, 60, 120].map(offset => ({ t: 1_790_000_000_000 + offset * 1000, psiIoSome: offset / 10, psiIoFull: offset / 20 }))

afterEach(cleanup)

describe('IoPressureChart (#1011)', () => {
  it('draws the two shares under the chart title, with the axes in percent', () => {
    const { container } = renderWithProviders(<IoPressureChart series={series} tf="hour" labels={labels} dragProps={{}} dragSelection={null} />)

    expect(screen.getByText('IO Pressure Stall')).toBeInTheDocument()
    expect(container.querySelectorAll('.recharts-area')).toHaveLength(2)
    expect(container.querySelector('.recharts-yAxis')).not.toBeNull()
  })
})

describe('IoPressureTooltip', () => {
  it('renders nothing while inactive or empty', () => {
    const { container } = renderWithProviders(<><IoPressureTooltip active={false} payload={[{ dataKey: 'psiIoSome', value: 1 }]} tf="hour" labels={labels} /><IoPressureTooltip active payload={[]} tf="hour" labels={labels} /></>)

    expect(container.textContent).toBe('')
  })

  it('names each share and prints it as a percentage, skipping empty points', () => {
    renderWithProviders(<IoPressureTooltip active label={1_790_000_000} payload={[{ dataKey: 'psiIoSome', value: 12.345, color: '#f59e0b' }, { dataKey: 'psiIoFull', value: 0.5 }, { dataKey: 'other', value: null }]} tf="hour" labels={labels} />)

    expect(screen.getByText('IO pressure')).toBeInTheDocument()
    expect(screen.getByText('Some')).toBeInTheDocument()
    expect(screen.getByText('12.3%')).toBeInTheDocument()
    expect(screen.getByText('Full')).toBeInTheDocument()
    expect(screen.getByText('0.5%')).toBeInTheDocument()
    expect(screen.queryByText('other')).not.toBeInTheDocument()
  })
})
