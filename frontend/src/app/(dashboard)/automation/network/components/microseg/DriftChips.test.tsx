/**
 * Drifts sub-tab (UA41, UA60): a coloured chip with an icon per drift kind (group headers and the summary strip), and
 * the zone glyph in the Zone column of the drifts that name a zone.
 */

import { describe, expect, it, vi } from 'vitest'
import { within } from '@testing-library/react'
import { Table, TableBody } from '@mui/material'

import { renderWithProviders, screen } from '@/__tests__/setup/renderWithProviders'
import type { MicrosegDrift, MicrosegZone } from '@/lib/microseg/types'

import { zoneOfDrift } from './driftLabels'
import DriftRow, { KindChip } from './DriftRow'
import { installFreshMocks, web } from './policyTestKit'

installFreshMocks()

const g = { node: 'pve1', type: 'qemu' as const, vmid: 101 }

const KINDS: Array<{ drift: MicrosegDrift; chip: string; colorClass: string; icon: string }> = [
  { drift: { kind: 'unzoned_running', guest: g }, chip: 'No zone', colorClass: 'MuiChip-colorWarning', icon: 'ri-question-line' },
  { drift: { kind: 'member_without_ip', guest: g }, chip: 'No IP', colorClass: 'MuiChip-colorWarning', icon: 'ri-map-pin-line' },
  { drift: { kind: 'ambiguous_zone', guest: g }, chip: 'Several zones', colorClass: 'MuiChip-colorWarning', icon: 'ri-git-merge-line' },
  { drift: { kind: 'nic_firewall_off', guest: g }, chip: 'Firewall off', colorClass: 'MuiChip-colorError', icon: 'ri-shield-flash-line' },
  { drift: { kind: 'ipset_out_of_sync', object: 'pcz-web' }, chip: 'Out of sync', colorClass: 'MuiChip-colorInfo', icon: 'ri-database-2-line' },
  { drift: { kind: 'foreign_accept', object: 'pcz-web' }, chip: 'Foreign rule', colorClass: 'MuiChip-colorError', icon: 'ri-alert-line' },
  { drift: { kind: 'object_collision', object: 'pcz-db' }, chip: 'Name taken', colorClass: 'MuiChip-colorError', icon: 'ri-alert-line' },
  { drift: { kind: 'brand_new_kind', object: 'x' }, chip: 'Drift', colorClass: 'MuiChip-colorError', icon: 'ri-alert-line' },
]

function renderRow(drift: MicrosegDrift, zone: MicrosegZone | null = null) {
  const label = { title: 'Some title', detail: 'Some detail', fixable: false, fix: null, hint: null }
  renderWithProviders(
    <Table><TableBody>
      <DriftRow
        drift={drift} label={label} subject='subject' guest={null} zone={zone} since='-' ignored={false} hasZones selected={false}
        onSelect={vi.fn()} onFix={vi.fn()} onIgnore={vi.fn()} onRestore={vi.fn()}
      />
    </TableBody></Table>,
  )
  return screen.getByRole('row')
}

describe('drift kind chip', () => {
  it.each(KINDS)('shows $chip for $drift.kind in its colour with its icon', ({ drift, chip, colorClass, icon }) => {
    renderWithProviders(<KindChip kind={drift.kind} />)
    const el = screen.getByText(chip).closest('.MuiChip-root') as HTMLElement
    expect(el.classList.contains(colorClass)).toBe(true)
    expect(el.querySelector(`i.${icon}`)).toBeTruthy()
  })

  it('carries its count as a filter, pressed when it is the kind shown', () => {
    const onClick = vi.fn()
    renderWithProviders(<KindChip kind='unzoned_running' count={10} selected onClick={onClick} />)
    const el = screen.getByTestId('drift-kind-filter-unzoned_running')
    expect(el.textContent).toBe('No zone · 10')
    expect(el.getAttribute('aria-pressed')).toBe('true')
  })
})

describe('drift zone', () => {
  it('shows the shield in the zone colour with its state dot and the name', () => {
    const line = renderRow({ kind: 'member_without_ip', guest: g, detail: { zone: 'web' } }, web({ state: 'enforce' }))
    const zone = within(line).getByTestId('drift-zone')
    expect((zone.querySelector('i.ri-shield-fill') as HTMLElement).style.color).toBe('rgb(59, 130, 246)')
    expect(zone.querySelector('[data-state="enforce"]')).toBeTruthy()
    expect(within(zone).getByText('web')).toBeTruthy()
  })

  it('says none on a drift that names no zone', () => {
    const line = renderRow({ kind: 'nic_firewall_off', guest: g })
    expect(within(line).queryByTestId('drift-zone')).toBeNull()
    expect(within(line).getByText('none')).toBeTruthy()
  })

  it('finds the zone by name or id, and none when the policy lacks it', () => {
    const zones = [web()]
    expect(zoneOfDrift({ kind: 'member_without_ip', detail: { zone: 'web' } }, zones)?.id).toBe('zw')
    expect(zoneOfDrift({ kind: 'member_without_ip', detail: { zone: 'zw' } }, zones)?.id).toBe('zw')
    expect(zoneOfDrift({ kind: 'member_without_ip', detail: { zone: 'gone' } }, zones)).toBeNull()
    expect(zoneOfDrift({ kind: 'nic_firewall_off' }, zones)).toBeNull()
  })
})
