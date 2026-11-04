/**
 * Drifts sub-tab (UA60): the table grouped by kind read from GET /drifts, the strip of kinds, the labels, the fix that
 * goes to the assign dialog or the plan, the bulk assign and ignore, and the local "Ignore".
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, within } from '@testing-library/react'

import { screen, fireEvent, waitFor } from '@/__tests__/setup/renderWithProviders'
import type { MicrosegDrift } from '@/lib/microseg/types'

import { calls, mock, policy, renderTab, reply, status, zone, REVISION_HEAD, GUESTS_ROUTE } from './microsegTestKit'
import { installFreshMocks, vm } from './policyTestKit'

installFreshMocks()

// Dates are formatted in the zone of the process: pin it so the expected strings do not depend on the machine.
const originalTZ = process.env.TZ
beforeAll(() => { process.env.TZ = 'UTC' })
afterAll(() => {
  if (originalTZ === undefined) delete process.env.TZ
  else process.env.TZ = originalTZ
})

const g = (vmid: number, type: 'qemu' | 'lxc' = 'qemu') => ({ node: 'pve1', type, vmid })

const DRIFTS: MicrosegDrift[] = [
  { kind: 'unzoned_running', guest: g(101), detail: { name: 'web-1' } },
  { kind: 'nic_firewall_off', guest: g(102), detail: { nics: ['net0'] } },
  { kind: 'foreign_accept', guest: g(102), detail: { pos: 3, source: '10.0.0.0/8', proto: 'tcp', dport: '22' } },
  { kind: 'foreign_accept', object: 'pcz-web', detail: { pos: 2 } },
  { kind: 'ipset_out_of_sync', object: 'pcz-web', detail: { desired: ['10.0.0.1/32'], actual: [] } },
  { kind: 'member_without_ip', guest: g(103), detail: { zone: 'web' } },
  { kind: 'ambiguous_zone', guest: g(104) },
  { kind: 'object_collision', object: 'pcz-db' },
]

const VMS = [
  vm(101, 'web-1', []), vm(102, 'db-1', [], { status: 'stopped' }), vm(103, 'app-1', []), vm(104, 'dual-1', ['zone-web', 'zone-db']),
]

function setup(drifts: MicrosegDrift[] = DRIFTS, over: { lastFull?: string | null; zones?: ReturnType<typeof zone>[] } = {}) {
  window.localStorage.setItem('microseg.subTab', 'drifts')
  const zones = over.zones ?? [zone('zw', { name: 'web' }), zone('zd', { name: 'db' })]
  mock.routes['GET /policy'] = () => reply(200, policy({ zones, last_revision: REVISION_HEAD }))
  mock.routes['GET /drifts'] = () => reply(200, { drifts })
  mock.routes[`GET ${GUESTS_ROUTE}`] = () => reply(200, { data: { vms: VMS } })
  mock.routes['GET /status'] = () => reply(200, status({
    engine: {
      paused_until: null, held: false, last_log: null,
      last_runs: over.lastFull === null ? {} : { full: { started_at: over.lastFull ?? '2026-11-02T12:00:00Z', status: 'done', api_calls: 10, writes: 0 } },
    },
  }))
  return renderTab()
}

const row = (name: RegExp | string) => screen.findByRole('row', { name })
/** The drift rows of the table: the group headers and the column head carry no "title: subject" name. */
const driftRows = () => screen.queryAllByRole('row').filter(r => (r.getAttribute('aria-label') ?? '').includes(': '))
const differs = (line: HTMLElement) => within(line).getByTestId('drift-differs').textContent

describe('drift list', () => {
  it('groups the drifts by kind in a table, a header per kind with its count, one row per drift', async () => {
    setup()
    expect((await screen.findByTestId('drift-group-unzoned_running')).textContent).toBe('Running guests in no zone (1)')
    const groups = [...document.querySelectorAll('tbody[data-group]')].map(g => g.getAttribute('data-group'))
    expect(groups).toEqual(['unzoned_running', 'nic_firewall_off', 'foreign_accept', 'ipset_out_of_sync', 'member_without_ip', 'ambiguous_zone', 'object_collision'])
    expect(screen.getByTestId('drift-group-foreign_accept').textContent).toBe('Rules changed by hand (2)')
    expect(driftRows()).toHaveLength(8)
    const head = within(screen.getByRole('table', { name: 'Drifts' })).getAllByRole('columnheader').map(h => h.textContent)
    expect(head).toEqual(['', 'Object', 'Zone', 'What differs', 'Since', 'Actions'])
  })

  it('counts the drifts of each kind in a strip of chips, a click showing that kind only, again showing all', async () => {
    setup()
    const strip = await screen.findByTestId('drift-kinds')
    expect(within(strip).getByTestId('drift-kind-filter-all').textContent).toBe('All · 8')
    expect(within(strip).getByTestId('drift-kind-filter-foreign_accept').textContent).toBe('Foreign rule · 2')
    fireEvent.click(within(strip).getByTestId('drift-kind-filter-foreign_accept'))
    await waitFor(() => expect(driftRows()).toHaveLength(2))
    expect(within(strip).getByTestId('drift-kind-filter-foreign_accept').getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(within(strip).getByTestId('drift-kind-filter-all'))
    await waitFor(() => expect(driftRows()).toHaveLength(8))
  })

  it('gives the object with its vmid and node, the zone or none, and the run time as Since', async () => {
    setup()
    const line = await row('Member without a known IP: app-1')
    expect(line.textContent).toContain('103 · pve1')
    expect(within(line).getByTestId('drift-zone').textContent).toBe('web')
    expect(within(await row('Network card firewall off: db-1')).getByText('none')).toBeTruthy()
    expect(line.textContent).toMatch(/Nov 2, 2026, 12:00\sPM/)
  })

  it('names a guest with its status glyph, taken from the inventory by type and vmid', async () => {
    setup()
    const running = await row('Running guest without a zone: web-1')
    expect(within(running).getByText('web-1')).toBeTruthy()
    expect(running.querySelector('i.ri-computer-fill')).toBeTruthy()
    const nic = await row('Network card firewall off: db-1')
    expect(nic.querySelector('i.ri-computer-fill')).toBeTruthy()
  })

  it('shows the object of a cluster drift and the group of a foreign rule', async () => {
    setup()
    const rule = await row('Rule not managed by ProxCenter: pcz-web')
    expect(within(rule).getByText('pcz-web')).toBeTruthy()
    expect(rule.querySelector('i.ri-shield-line')).toBeTruthy()
    expect(within(await row('Name already used in Proxmox: pcz-db')).getByText('pcz-db')).toBeTruthy()
  })

  it('says what differs in its row', async () => {
    setup()
    expect(differs(await row('Network card firewall off: db-1'))).toBe('The firewall is off on net0: the rules do not apply there.')
    expect(differs(await row('IP set out of sync: pcz-web'))).toBe('pcz-web holds - instead of 10.0.0.1/32.')
  })

  it('folds a group', async () => {
    setup()
    const header = await screen.findByTestId('drift-group-foreign_accept')
    fireEvent.click(within(header.closest('tr')!).getByRole('button', { name: 'Fold the group' }))
    await waitFor(() => expect(driftRows()).toHaveLength(6))
  })

  it('says it reads the last full run, with its time', async () => {
    setup()
    expect(await screen.findByText(/As of the last full run, Nov 2, 2026, 12:00\sPM/)).toBeTruthy()
  })

  it('says so when no full run happened yet', async () => {
    setup([], { lastFull: null })
    expect(await screen.findByText('No full run yet: drifts appear after the first one.')).toBeTruthy()
  })

  it('waits for the first full check after a restart instead of saying there is no drift', async () => {
    setup()
    mock.routes['GET /drifts'] = () => reply(200, { drifts: [], computed: false })
    expect(await screen.findByText('Waiting for the first full check')).toBeTruthy()
    expect(screen.queryByText('No drift: Proxmox matches the policy.')).toBeNull()
    expect(driftRows()).toHaveLength(0)
  })

  it('says there is no drift', async () => {
    setup([])
    expect(await screen.findByText('No drift: Proxmox matches the policy.')).toBeTruthy()
  })

  it('pages each group 10 rows at a time', async () => {
    const many: MicrosegDrift[] = Array.from({ length: 23 }, (_, i) => ({ kind: 'object_collision', object: `pcz-${String(i).padStart(2, '0')}` }))
    setup(many)
    expect(await screen.findByText('pcz-00')).toBeTruthy()
    expect(driftRows()).toHaveLength(10)
    expect(screen.getByText('1-10 of 23')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /next page/i }))
    expect(await screen.findByText('pcz-10')).toBeTruthy()
    expect(screen.queryByText('pcz-00')).toBeNull()
  })

  it('shows the error of a failed read with a retry', async () => {
    setup()
    mock.routes['GET /drifts'] = () => reply(502, { code: 'ORCHESTRATOR_ERROR', error: 'x' })
    expect(await screen.findByText(/orchestrator/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
  })
})

describe('drifts without a fix', () => {
  const NO_FIX = [
    ['Rule not managed by ProxCenter: db-1', 'An ACCEPT rule added outside micro-segmentation opens this guest: review it in Proxmox.'],
    ['Rule not managed by ProxCenter: pcz-web', 'An ACCEPT rule added outside micro-segmentation opens this group: review it in Proxmox.'],
    ['Member without a known IP: app-1', 'No IP known: install the QEMU guest agent or set an IP in cloud-init / the container network.'],
    ['Name already used in Proxmox: pcz-db', 'An object named pcz-* exists in Proxmox without the micro-segmentation marker: rename or delete it in Proxmox.'],
  ]

  it.each(NO_FIX)('shows %s with its hint on what differs and no Fix button', async (name, hint) => {
    setup()
    const line = await row(name)
    fireEvent.mouseOver(within(line).getByTestId('drift-differs'))
    expect((await screen.findByRole('tooltip')).textContent).toContain(hint)
    expect(within(line).queryByRole('button', { name: 'Open the plan' })).toBeNull()
    expect(within(line).queryByRole('button', { name: 'Assign to a zone' })).toBeNull()
    expect(within(line).getByRole('button', { name: 'Ignore' })).toBeTruthy()
  })

  it('keeps the plan fix for the NIC and ipset drifts, and the assign fix for the guests without a zone', async () => {
    setup()
    expect(within(await row('Network card firewall off: db-1')).getByRole('button', { name: 'Open the plan' })).toBeTruthy()
    expect(within(await row('IP set out of sync: pcz-web')).getByRole('button', { name: 'Open the plan' })).toBeTruthy()
    expect(within(await row('Running guest without a zone: web-1')).getByRole('button', { name: 'Assign to a zone' })).toBeTruthy()
    expect(within(await row('Guest in several zones: dual-1')).getByRole('button', { name: 'Assign to a zone' })).toBeTruthy()
  })

  it('writes the rule of a foreign accept in its detail', async () => {
    setup()
    const line = await row('Rule not managed by ProxCenter: db-1')
    expect(differs(line)).toMatch(/position 3 \(10\.0\.0\.0\/8 SSH\)/)
  })
})

describe('fixing a drift', () => {
  it('opens the plan for a drift the plan realigns', async () => {
    setup()
    mock.routes['POST /plan'] = () => reply(202, { run_id: 'p1' })
    mock.routes['GET /runs/p1'] = () => reply(200, { id: 'p1', policy_id: 'p1', kind: 'plan', status: 'running', started_at: '2026-11-02T09:00:00Z', duration_ms: 0, api_calls: 0, writes: 0, result: null, error: '' })
    const line = await row('Network card firewall off: db-1')
    fireEvent.click(within(line).getByRole('button', { name: 'Open the plan' }))
    expect(await screen.findByRole('dialog', { name: 'Micro-segmentation plan' })).toBeTruthy()
    expect(calls('POST /plan')).toHaveLength(1)
  })

  it('opens the assign dialog with the guest selected for the zone chosen from the menu', async () => {
    setup()
    const line = await row('Running guest without a zone: web-1')
    fireEvent.click(within(line).getByRole('button', { name: 'Assign to a zone' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'db' }))
    const dialog = await screen.findByRole('dialog', { name: 'Assign guests to db' })
    const box = await within(dialog).findByRole('checkbox', { name: 'web-1' }) as HTMLInputElement
    expect(box.checked).toBe(true)
    expect((within(dialog).getByRole('checkbox', { name: 'db-1' }) as HTMLInputElement).checked).toBe(false)
    expect(within(dialog).getByRole('button', { name: 'Assign 1 guest' })).toBeTruthy()
  })

  it('adds the assignment to the draft only (pending member), no plan, no apply', async () => {
    setup()
    mock.routes['POST /members'] = () => reply(200, { version: 4 })
    const line = await row('Running guest without a zone: web-1')
    fireEvent.click(within(line).getByRole('button', { name: 'Assign to a zone' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'web' }))
    const dialog = await screen.findByRole('dialog', { name: 'Assign guests to web' })
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Assign 1 guest' }))
    await waitFor(() => expect(calls('POST /members')).toHaveLength(1))
    expect(JSON.parse(String(calls('POST /members')[0][1]?.body))).toEqual({
      version: 3, zone_id: 'zw', guests: [{ node: 'pve1', type: 'qemu', vmid: 101 }],
    })
    expect(calls('POST /plan')).toHaveLength(0)
    expect(calls('POST /apply')).toHaveLength(0)
  })

  it('lets a guest in several zones be assigned to one of them even though it carries its tag', async () => {
    setup()
    const line = await row('Guest in several zones: dual-1')
    fireEvent.click(within(line).getByRole('button', { name: 'Assign to a zone' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'web' }))
    const dialog = await screen.findByRole('dialog', { name: 'Assign guests to web' })
    const box = await within(dialog).findByRole('checkbox', { name: 'dual-1' }) as HTMLInputElement
    expect(box.checked).toBe(true)
    expect(box.disabled).toBe(false)
  })

  it('assigns the guests selected to a zone at once: the bulk bar opens the assign dialog with all of them', async () => {
    setup()
    for (const name of ['Select web-1', 'Select dual-1', 'Select pcz-db']) fireEvent.click(await screen.findByRole('checkbox', { name }))
    const bar = screen.getByTestId('drift-bulk')
    expect(bar.textContent).toContain('3 drifts selected')
    fireEvent.click(within(bar).getByRole('button', { name: 'Assign 2 guests to a zone…' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'web' }))
    const dialog = await screen.findByRole('dialog', { name: 'Assign guests to web' })
    expect((await within(dialog).findByRole('checkbox', { name: 'web-1' }) as HTMLInputElement).checked).toBe(true)
    expect((within(dialog).getByRole('checkbox', { name: 'dual-1' }) as HTMLInputElement).checked).toBe(true)
    expect(within(dialog).getByRole('button', { name: 'Assign 2 guests' })).toBeTruthy()
  })

  it('selects a whole group from its header and ignores the selection at once', async () => {
    setup()
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select every drift of Rules changed by hand (2)' }))
    const bar = screen.getByTestId('drift-bulk')
    expect(bar.textContent).toContain('2 drifts selected')
    // No guest to assign among them? db-1 is one: the assign button counts it.
    expect(within(bar).getByRole('button', { name: 'Assign 1 guest to a zone…' })).toBeTruthy()
    fireEvent.click(within(bar).getByRole('button', { name: 'Ignore 2' }))
    await waitFor(() => expect(screen.queryByTestId('drift-group-foreign_accept')).toBeNull())
    expect(screen.queryByTestId('drift-bulk')).toBeNull()
    expect(JSON.parse(window.localStorage.getItem('microseg.ignoredDrifts.c1') ?? '[]')).toHaveLength(2)
  })

  it('cannot assign without a zone and says why', async () => {
    setup(DRIFTS, { zones: [] })
    const line = await row('Running guest without a zone: web-1')
    const button = within(line).getByRole('button', { name: 'Assign to a zone' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
  })
})

describe('ignoring a drift', () => {
  it('hides it, keeps it hidden after a reload, and can show it again', async () => {
    const view = setup()
    const line = await row('Name already used in Proxmox: pcz-db')
    fireEvent.click(within(line).getByRole('button', { name: 'Ignore' }))
    await waitFor(() => expect(screen.queryByTestId('drift-group-object_collision')).toBeNull())
    expect(driftRows()).toHaveLength(7)
    expect(JSON.parse(window.localStorage.getItem('microseg.ignoredDrifts.c1') ?? '[]')).toHaveLength(1)

    view.unmount()
    cleanup()
    setup()
    expect(await screen.findByTestId('drift-group-unzoned_running')).toBeTruthy()
    expect(screen.queryByTestId('drift-group-object_collision')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Show ignored (1)' }))
    const again = await row('Name already used in Proxmox: pcz-db')
    expect(within(again).getByText('Ignored')).toBeTruthy()
    fireEvent.click(within(again).getByRole('button', { name: 'Show again' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: /Show ignored/ })).toBeNull())
    expect(screen.getByTestId('drift-group-object_collision')).toBeTruthy()
    expect(JSON.parse(window.localStorage.getItem('microseg.ignoredDrifts.c1') ?? '[]')).toEqual([])
  })

  it('ignores one foreign rule without hiding the other one of the same guest', async () => {
    setup()
    fireEvent.click(within(await row('Rule not managed by ProxCenter: pcz-web')).getByRole('button', { name: 'Ignore' }))
    await waitFor(() => expect(driftRows()).toHaveLength(7))
    expect(screen.getByTestId('drift-group-foreign_accept').textContent).toBe('Rules changed by hand (1)')
    expect(screen.getByRole('row', { name: 'Rule not managed by ProxCenter: db-1' })).toBeTruthy()
  })

  it('still ignores for the session when the storage is blocked', async () => {
    setup()
    const blocked = vi.spyOn(window.Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    try {
      fireEvent.click(within(await row('Name already used in Proxmox: pcz-db')).getByRole('button', { name: 'Ignore' }))
      await waitFor(() => expect(screen.queryByTestId('drift-group-object_collision')).toBeNull())
    } finally {
      blocked.mockRestore()
    }
  })
})
