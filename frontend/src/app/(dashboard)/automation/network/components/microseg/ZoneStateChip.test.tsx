/**
 * The state of a zone as a coloured chip with an icon (UA40): the chip on its own, on the zone card, in the panel header
 * and in the state menu.
 */

import { describe, expect, it, vi } from 'vitest'
import { within } from '@testing-library/react'

import { renderWithProviders, screen, fireEvent, waitFor } from '@/__tests__/setup/renderWithProviders'
import type { ZoneState } from '@/lib/microseg/types'

import { installFreshMocks, web } from './policyTestKit'
import { node, setup } from './zoneMapTestKit'
import ZoneCard from './ZoneCard'
import ZoneStateChip from './ZoneStateChip'

installFreshMocks()

const CASES: Array<{ state: ZoneState; label: string; icon: string; colorClass: string; hint: string }> = [
  { state: 'observe', label: 'Observation', icon: 'ri-eye-line', colorClass: 'MuiChip-colorWarning', hint: 'Traffic is logged, nothing is blocked' },
  { state: 'enforce', label: 'Enforced', icon: 'ri-shield-check-line', colorClass: 'MuiChip-colorSuccess', hint: 'Only the allowed flows get in' },
  { state: 'disabled', label: 'Disabled', icon: 'ri-shield-cross-line', colorClass: 'MuiChip-colorDefault', hint: 'The zone is not applied' },
]

describe('ZoneStateChip', () => {
  it.each(CASES)('shows $state as an outlined $colorClass chip with $icon, and says what it does', async ({ state, label, icon, colorClass, hint }) => {
    renderWithProviders(<ZoneStateChip state={state} />)
    const chip = screen.getByText(label).closest('.MuiChip-root') as HTMLElement
    expect(chip.classList.contains(colorClass)).toBe(true)
    expect(chip.classList.contains('MuiChip-outlined')).toBe(true)
    expect(chip.classList.contains('MuiChip-sizeSmall')).toBe(true)
    expect(chip.querySelector(`i.${icon}`)).toBeTruthy()
    fireEvent.mouseOver(chip)
    expect(await screen.findByRole('tooltip')).toHaveProperty('textContent', hint)
  })

  it('keeps the state label as the accessible name, the hint only describes it', async () => {
    renderWithProviders(<ZoneStateChip state='enforce' />)
    const chip = screen.getByText('Enforced').closest('.MuiChip-root') as HTMLElement
    fireEvent.mouseOver(chip)
    await screen.findByRole('tooltip')
    expect(chip.getAttribute('aria-label')).toBeNull()
    expect(chip.getAttribute('title')).toBeNull()
    expect(chip.getAttribute('aria-describedby')).toBeTruthy()
  })
})

describe('where the state shows', () => {
  const rowProps = {
    members: [], membersKnown: true, flows: [], zonesById: new Map(),
    onEdit: vi.fn(), onDelete: vi.fn(), onSetState: vi.fn(), onAssign: vi.fn(), onRemoveMember: vi.fn(),
    flowDiff: null, open: false, onToggle: vi.fn(), onAddFlow: vi.fn(), onEditFlow: vi.fn(), onDeleteFlow: vi.fn(), drifts: null,
  }

  it('puts the chip on the zone card', () => {
    renderWithProviders(<ZoneCard zone={web({ state: 'enforce' })} {...rowProps} />)
    const chip = within(screen.getByRole('listitem', { name: 'web' })).getByText('Enforced').closest('.MuiChip-root') as HTMLElement
    expect(chip.classList.contains('MuiChip-colorSuccess')).toBe(true)
    expect(chip.querySelector('i.ri-shield-check-line')).toBeTruthy()
  })

  it('gives each option of the state menu its icon and keeps the current state disabled', async () => {
    renderWithProviders(<ZoneCard zone={web({ state: 'observe' })} {...rowProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'Change state' }))
    const observe = await screen.findByRole('menuitem', { name: 'Observe' })
    expect(observe.getAttribute('aria-disabled')).toBe('true')
    expect(observe.querySelector('i.ri-eye-line')).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Enforce' }).querySelector('i.ri-shield-check-line')).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Disable' }).querySelector('i.ri-shield-cross-line')).toBeTruthy()
  })

  it('puts the chip in the header of the zone panel', async () => {
    setup()
    fireEvent.click(await node('zone:zw'))
    const panel = await screen.findByRole('complementary', { name: 'Zone web' })
    await waitFor(() => expect(panel.querySelector('.MuiChip-colorWarning i.ri-eye-line')).toBeTruthy())
  })
})
