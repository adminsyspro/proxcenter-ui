/**
 * Drifts sub-tab (UA41): a coloured chip with an icon per drift kind at the start of the row, and the zone glyph with
 * its state chip on the drifts that name a zone.
 */

import { describe, expect, it, vi } from 'vitest'
import { within } from '@testing-library/react'

import { renderWithProviders, screen } from '@/__tests__/setup/renderWithProviders'
import type { MicrosegDrift, MicrosegZone } from '@/lib/microseg/types'

import { zoneOfDrift } from './driftLabels'
import DriftRow from './DriftRow'
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
    <DriftRow
      drift={drift} label={label} subject='subject' guest={null} zone={zone} ignored={false} hasZones
      onFix={vi.fn()} onIgnore={vi.fn()} onRestore={vi.fn()}
    />,
  )
  return screen.getByRole('listitem')
}

describe('drift kind chip', () => {
  it.each(KINDS)('shows $chip for $drift.kind in its colour with its icon, before the title', ({ drift, chip, colorClass, icon }) => {
    const line = renderRow(drift)
    const el = within(line).getByText(chip).closest('.MuiChip-root') as HTMLElement
    expect(el.classList.contains(colorClass)).toBe(true)
    expect(el.querySelector(`i.${icon}`)).toBeTruthy()
    const title = within(line).getByText('Some title')
    expect(el.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

describe('drift zone', () => {
  it('shows the shield in the zone colour with its state dot, the name, then the state chip', () => {
    const line = renderRow({ kind: 'member_without_ip', guest: g, detail: { zone: 'web' } }, web({ state: 'enforce' }))
    const zone = within(line).getByTestId('drift-zone')
    expect((zone.querySelector('i.ri-shield-fill') as HTMLElement).style.color).toBe('rgb(59, 130, 246)')
    expect(zone.querySelector('[data-state="enforce"]')).toBeTruthy()
    expect(within(zone).getByText('web')).toBeTruthy()
    const chip = within(zone).getByText('Enforced').closest('.MuiChip-root') as HTMLElement
    expect(chip.classList.contains('MuiChip-colorSuccess')).toBe(true)
    expect(chip.querySelector('i.ri-shield-check-line')).toBeTruthy()
  })

  it('shows no zone block on a drift that names none', () => {
    expect(within(renderRow({ kind: 'nic_firewall_off', guest: g })).queryByTestId('drift-zone')).toBeNull()
  })

  it('finds the zone by name or id, and none when the policy lacks it', () => {
    const zones = [web()]
    expect(zoneOfDrift({ kind: 'member_without_ip', detail: { zone: 'web' } }, zones)?.id).toBe('zw')
    expect(zoneOfDrift({ kind: 'member_without_ip', detail: { zone: 'zw' } }, zones)?.id).toBe('zw')
    expect(zoneOfDrift({ kind: 'member_without_ip', detail: { zone: 'gone' } }, zones)).toBeNull()
    expect(zoneOfDrift({ kind: 'nic_firewall_off' }, zones)).toBeNull()
  })
})
