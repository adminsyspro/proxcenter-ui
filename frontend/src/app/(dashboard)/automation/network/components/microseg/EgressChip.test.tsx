/**
 * The outbound state of a zone as a chip with its readiness: where it shows (zone card, zone panel).
 */

import { describe, expect, it, vi } from 'vitest'
import { within } from '@testing-library/react'

import { renderWithProviders, screen } from '@/__tests__/setup/renderWithProviders'
import type { EgressState } from '@/lib/microseg/types'

import EgressChip from './EgressChip'
import { installFreshMocks, web } from './policyTestKit'
import ZoneCard from './ZoneCard'

installFreshMocks()

const CASES: Array<{ state: EgressState; ready: boolean; label: string; colorClass: string }> = [
  { state: 'off', ready: false, label: 'Outbound: off', colorClass: 'MuiChip-colorDefault' },
  { state: 'observe', ready: false, label: 'Outbound: observing', colorClass: 'MuiChip-colorInfo' },
  { state: 'observe', ready: true, label: 'Outbound: ready', colorClass: 'MuiChip-colorSuccess' },
  { state: 'enforce', ready: false, label: 'Outbound: blocking', colorClass: 'MuiChip-colorError' },
]

describe('EgressChip', () => {
  it.each(CASES)('shows $state (ready: $ready) as $label', ({ state, ready, label, colorClass }) => {
    renderWithProviders(<EgressChip state={state} ready={ready} />)
    const chip = screen.getByText(label).closest('.MuiChip-root') as HTMLElement
    expect(chip.classList.contains(colorClass)).toBe(true)
    expect(chip.classList.contains('MuiChip-outlined')).toBe(true)
    expect(chip.querySelector('i.ri-logout-box-r-line')).toBeTruthy()
  })

  it('ignores the readiness once the outbound is blocking', () => {
    renderWithProviders(<EgressChip state='enforce' ready />)
    expect(screen.getByText('Outbound: blocking')).toBeTruthy()
  })
})

describe('on the zone card', () => {
  const rowProps = {
    members: [], membersKnown: true, flows: [], zonesById: new Map(),
    onEdit: vi.fn(), onDelete: vi.fn(), onSetState: vi.fn(), onAssign: vi.fn(), onRemoveMember: vi.fn(),
    flowDiff: null, open: false, onToggle: vi.fn(), onAddFlow: vi.fn(), onEditFlow: vi.fn(), onDeleteFlow: vi.fn(), drifts: null,
  }

  it('shows the outbound chip of the zone, with its readiness', () => {
    renderWithProviders(<ZoneCard zone={web({ egress_state: 'observe' })} egressReady {...rowProps} />)
    expect(within(screen.getByRole('listitem', { name: 'web' })).getByText('Outbound: ready')).toBeTruthy()
  })

  it('says off for a zone without outbound control, whatever its old data holds', () => {
    renderWithProviders(<ZoneCard zone={web({ state: 'disabled', egress_state: 'enforce' })} {...rowProps} />)
    expect(within(screen.getByRole('listitem', { name: 'web' })).getByText('Outbound: off')).toBeTruthy()
  })
})
