import { describe, it, expect, afterEach, vi } from 'vitest'
import { cleanup, fireEvent } from '@testing-library/react'
import { ResponsiveContainer } from 'recharts'

import { renderWithProviders, screen } from '@/__tests__/setup/renderWithProviders'

// jsdom gives every element a zero size; a fixed container lets the chart mount.
vi.mock('@/components/ChartContainer', () => ({
  default: ({ children }: { children: React.ReactElement }) => (
    <ResponsiveContainer width={600} height={300}>{children}</ResponsiveContainer>
  ),
}))

import ProjectionChart from './ProjectionChart'

afterEach(cleanup)

const data = [{ t: '1 Oct', cpu: 20, ram: 40 }, { t: '2 Oct', cpu: 21, ram: 41 }]

describe('ProjectionChart history window', () => {
  it('shows the window choice and reports the picked one', () => {
    const onChange = vi.fn()

    renderWithProviders(<ProjectionChart data={data} windowDays={180} onWindowDaysChange={onChange} />)

    const selected = screen.getByRole('button', { name: /^180/ })

    expect(selected).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /^90/ })).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(screen.getByRole('button', { name: /^365/ }))
    expect(onChange).toHaveBeenCalledWith(365)

    fireEvent.click(selected)
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('hides the window choice when the page does not offer it', () => {
    renderWithProviders(<ProjectionChart data={data} />)

    expect(screen.queryByRole('button', { name: /^365/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'CPU' })).toBeInTheDocument()
  })
})
