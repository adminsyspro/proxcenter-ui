import { cleanup, fireEvent, waitFor } from '@testing-library/react'
import { useTheme } from '@mui/material/styles'
import { afterEach, describe, expect, it } from 'vitest'

import { renderWithProviders, screen } from '@/__tests__/setup/renderWithProviders'

import AvailabilityTimeline from './AvailabilityTimeline'
import { makeResult } from './fixtures'

afterEach(cleanup)

const rows = [
  { label: 'pve1', result: makeResult('pve1', ['up', 'down', 'maintenance', 'unobserved', 'absent'], { availability: 99.93, incidents: [{ from: 'a', to: 'b', state: 'down' }] }) },
]

describe('AvailabilityTimeline', () => {
  it('renders one element per slot, colored by its state', () => {
    let palette: ReturnType<typeof useTheme>['palette'] | undefined

    function Probe() {
      palette = useTheme().palette

      return null
    }

    const { container } = renderWithProviders(<><Probe /><AvailabilityTimeline rows={rows} /></>)
    const slots = Array.from(container.querySelectorAll('[data-state]'))

    expect(slots.map(s => s.getAttribute('data-state'))).toEqual(['up', 'down', 'maintenance', 'unobserved', 'absent'])
    expect(slots[0]).toHaveStyle({ backgroundColor: palette!.success.main })
    expect(slots[1]).toHaveStyle({ backgroundColor: palette!.error.main })
    expect(slots[2]).toHaveStyle({ backgroundColor: palette!.info.main })
    expect(slots[3]).toHaveStyle({ backgroundColor: palette!.grey[400] })
    const absent = getComputedStyle(slots[4])

    expect(absent.backgroundColor).toMatch(/^(transparent|rgba\(0, 0, 0, 0\))?$/)
    expect(absent.borderTopStyle).toBe('solid')
  })

  it('gives each row one summary label instead of one label per slot', () => {
    renderWithProviders(<AvailabilityTimeline rows={rows} />)

    expect(screen.getByRole('img', { name: 'pve1: 99.93% available, 1 incident' })).toBeInTheDocument()
    expect(screen.getAllByRole('img')).toHaveLength(1)
  })

  it('says not measured, never 0%, for a null availability', () => {
    const r = makeResult('pve2', ['unobserved'], { availability: null, coverage: null })

    renderWithProviders(<AvailabilityTimeline rows={[{ label: 'pve2', result: r }]} />)

    expect(screen.getByRole('img', { name: 'pve2: not measured' })).toBeInTheDocument()
    expect(screen.queryByText('0%')).not.toBeInTheDocument()
  })

  it('tells the period under the pointer in a tooltip, without a click', async () => {
    renderWithProviders(<AvailabilityTimeline rows={rows} to='2026-10-27T10:05:00.000Z' />)

    const bar = screen.getByRole('img')

    bar.getBoundingClientRect = () => ({ left: 100, width: 500, top: 0, right: 600, bottom: 20, height: 20, x: 100, y: 0, toJSON: () => ({}) })
    fireEvent.mouseMove(bar, { clientX: 100 + 150 })

    const tip = await screen.findByRole('tooltip')
    expect(tip).toHaveTextContent(/^Down · .* → .* · 1m$/)

    fireEvent.mouseLeave(bar)
    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument())
  })

  it('shows a legend for the five states', () => {
    renderWithProviders(<AvailabilityTimeline rows={rows} />)

    for (const name of ['Up', 'Down', 'Maintenance', 'Not observed', 'Absent']) {
      expect(screen.getByText(name)).toBeInTheDocument()
    }
  })
})
