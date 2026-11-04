/**
 * UA59: a zone card for a viewer (every action disabled with the read-only tooltip, the state chip not a button,
 * Details still opens) and a zone the draft removed (struck through, no action).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, within } from '@testing-library/react'

import { fireEvent, renderWithProviders, screen } from '@/__tests__/setup/renderWithProviders'

import { MicrosegWriteContext } from './microsegAccess'
import { web } from './policyTestKit'
import ZoneCard, { RemovedZoneCard } from './ZoneCard'

afterEach(cleanup)

const READ_ONLY = 'Read-only: you need node management rights'
const ACTIONS = ['Edit zone', 'Change state', 'New flow into web', 'Assign guests', 'Delete zone']

const props = () => ({
  zone: web(), members: [], membersKnown: true, flows: [], zonesById: new Map(), flowDiff: null, drifts: null, open: false,
  onToggle: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn(), onSetState: vi.fn(), onAssign: vi.fn(), onRemoveMember: vi.fn(),
  onAddFlow: vi.fn(), onEditFlow: vi.fn(), onDeleteFlow: vi.fn(),
})

describe('zone card for a viewer', () => {
  it('disables every action with the read-only tooltip and leaves the state chip inert', () => {
    const p = props()
    renderWithProviders(<MicrosegWriteContext.Provider value={false}><ZoneCard {...p} /></MicrosegWriteContext.Provider>)
    const card = screen.getByRole('listitem', { name: 'web' })
    for (const name of ACTIONS) {
      const button = within(card).getByRole('button', { name }) as HTMLButtonElement
      expect(button.disabled, name).toBe(true)
      expect(button.parentElement?.getAttribute('aria-label'), name).toBe(READ_ONLY)
    }
    const chip = within(card).getByText('Observation').closest('.MuiChip-root') as HTMLElement
    expect(chip.getAttribute('role')).toBeNull()
    expect(chip.getAttribute('aria-haspopup')).toBeNull()
    fireEvent.click(chip)
    expect(screen.queryByRole('menu')).toBeNull()

    // Reading is no write: Details still opens.
    fireEvent.click(within(card).getByRole('button', { name: 'Show details of web' }))
    expect(p.onToggle).toHaveBeenCalledTimes(1)
  })

  it('makes the state chip the state menu for a writer', () => {
    renderWithProviders(<ZoneCard {...props()} />)
    fireEvent.click(within(screen.getByRole('listitem', { name: 'web' })).getByRole('button', { name: 'Observation' }))
    expect(screen.getByRole('menu')).toBeTruthy()
  })
})

describe('removed zone card', () => {
  it('is struck through with its Removed badge, and offers no action', () => {
    renderWithProviders(<RemovedZoneCard zone={web({ label: 'Front web servers' })} />)
    const card = screen.getByRole('listitem', { name: 'web' })
    expect(card.getAttribute('data-removed')).toBe('true')
    expect(getComputedStyle(within(card).getByText('web')).textDecoration).toContain('line-through')
    expect(getComputedStyle(within(card).getByText('Front web servers')).textDecoration).toContain('line-through')
    expect(within(card).getByText('Removed')).toBeTruthy()
    expect(within(card).queryByRole('button')).toBeNull()
  })
})

describe('zone card traffic sparkline', () => {
  it('shows the uncovered traffic of the last 24 hours when the history is read', () => {
    const series = new Array<number>(24).fill(0)
    series[23] = 3
    renderWithProviders(<ZoneCard {...props()} uncovered={{ series, from: Date.parse('2026-11-04T00:00:00Z'), stepMs: 3_600_000 }} />)
    const card = screen.getByRole('listitem', { name: 'web' })
    expect(within(card).getByTestId('zone-sparkline-total').textContent).toBe('3 hits would be blocked')
  })

  it('has no sparkline when the history cannot be read', () => {
    renderWithProviders(<ZoneCard {...props()} uncovered={null} />)
    expect(screen.queryByTestId('zone-sparkline-total')).toBeNull()
  })
})
