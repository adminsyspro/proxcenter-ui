/**
 * The exception dialog (sources, destinations, services), the table dialog that lists the exceptions of a zone, and the
 * zone dialog that carries them: what they hand to the save chain of `useZoneEdits`.
 */

import { useState, type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, renderHook, screen, waitFor, within } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { SWRConfig } from 'swr'

import { renderWithProviders } from '@/__tests__/setup/renderWithProviders'
import type { MicrosegException } from '@/lib/microseg/types'
import enMessages from '@/messages/en.json'

import ExceptionDialog, { type ExceptionClusters } from './ExceptionDialog'
import type { ExceptionDraft } from './exceptionModel'
import ExceptionsTableDialog from './ExceptionsTableDialog'
import { GUESTS_ROUTE, calls, mock, policy, reply, zone } from './microsegTestKit'
import { body, installFreshMocks, vm } from './policyTestKit'
import { useZoneEdits } from './useZoneEdits'
import ZoneDialog from './ZoneDialog'
import { useExceptionEditor } from './ZonePanelActions'
import type { ZoneFormValues } from './zoneForm'
import type { PolicyGuest, ZoneMember } from './zoneModel'

installFreshMocks()

const guest = (vmid: number, name: string, over: Partial<PolicyGuest> = {}): PolicyGuest => ({
  connectionId: 'c1', vmid, name, node: 'pve1', type: 'qemu', status: 'running', tags: [], ips: [`10.0.0.${vmid % 250}`], ...over,
})
const member = (g: PolicyGuest, pending = false): ZoneMember => ({ connectionId: g.connectionId, ref: { node: g.node, type: g.type, vmid: g.vmid }, guest: g, pending })
const refOf = (g: PolicyGuest) => ({ type: g.type, vmid: g.vmid, name: g.name })

const app1 = guest(101, 'app-01')
const app2 = guest(102, 'app-02')
const batch = guest(300, 'batch', { type: 'lxc' })
const db1 = guest(201, 'db-01')
const db2 = guest(202, 'db-02')
const guests = [db2, batch, app2, db1, app1]
const members = [member(db1), member(db2, true)]

const SOURCES = 'Source VMs'
const DESTINATIONS = 'Destination VMs'
const SERVICES = 'Allowed services'

const field = (dialog: HTMLElement, name: string) => within(dialog).getByRole('combobox', { name }) as HTMLInputElement
const openList = async (dialog: HTMLElement, name: string) => {
  fireEvent.mouseDown(field(dialog, name))
  return screen.findByRole('listbox')
}
const closeList = async (dialog: HTMLElement, name: string) => {
  fireEvent.keyDown(field(dialog, name), { key: 'Escape' })
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())
}
const pick = async (dialog: HTMLElement, name: string, ...options: RegExp[]) => {
  const list = await openList(dialog, name)
  for (const option of options) fireEvent.click(within(list).getByRole('option', { name: option }))
  await closeList(dialog, name)
}

function renderDialog(exception: ExceptionDraft | null = null, over: { guests?: PolicyGuest[]; members?: ZoneMember[] } = {}) {
  const onSave = vi.fn((_draft: ExceptionDraft) => undefined)
  const onClose = vi.fn()
  renderWithProviders(<ExceptionDialog open exception={exception} guests={over.guests ?? guests} members={over.members ?? members} onSave={onSave} onClose={onClose} />)
  return { onSave, onClose }
}

describe('ExceptionDialog', () => {
  it('creates an exception from one VM to one member on PostgreSQL', async () => {
    const { onSave } = renderDialog()
    const dialog = await screen.findByRole('dialog', { name: 'New exception' })
    const add = () => within(dialog).getByRole('button', { name: 'Add' }) as HTMLButtonElement
    expect(add().disabled).toBe(true)
    await pick(dialog, SOURCES, /^app-01/)
    await pick(dialog, DESTINATIONS, /^db-01/)
    expect(add().disabled).toBe(true)
    await pick(dialog, SERVICES, /^PostgreSQL/)
    expect(within(dialog).getByText('1 rule')).toBeTruthy()
    fireEvent.click(add())
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave.mock.calls[0][0]).toEqual({ sources: [refOf(app1)], destinations: [refOf(db1)], services: ['postgresql'], comment: '' })
  })

  it('lists the VMs by name with their icon and VMID, the members of the zone first among the destinations', async () => {
    renderDialog()
    const dialog = await screen.findByRole('dialog', { name: 'New exception' })
    const sources = await openList(dialog, SOURCES)
    expect(within(sources).getAllByRole('option').map(o => o.textContent)).toEqual(['app-01101', 'app-02102', 'batch300', 'db-01201', 'db-02202'])
    expect(within(sources).getAllByRole('option')[2].querySelector('i')?.className).toContain('ri-')
    await closeList(dialog, SOURCES)
    const destinations = await openList(dialog, DESTINATIONS)
    expect(within(destinations).getAllByRole('option').map(o => o.textContent)).toEqual(['db-01201', 'db-02202', 'app-01101', 'app-02102', 'batch300'])
    expect(destinations.textContent).toMatch(/Members of the zone.*db-02202.*Not members yet.*app-01/)
  })

  it('takes a destination that is not a member yet', async () => {
    const { onSave } = renderDialog(null, { members: [] })
    const dialog = await screen.findByRole('dialog', { name: 'New exception' })
    await pick(dialog, SOURCES, /^app-01/)
    await pick(dialog, DESTINATIONS, /^batch/)
    await pick(dialog, SERVICES, /^SSH/)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave.mock.calls[0][0].destinations).toEqual([{ type: 'lxc', vmid: 300, name: 'batch' }])
  })

  it('refuses the same VM on both sides', async () => {
    renderDialog()
    const dialog = await screen.findByRole('dialog', { name: 'New exception' })
    await pick(dialog, SOURCES, /^db-01/)
    const destinations = await openList(dialog, DESTINATIONS)
    const taken = within(destinations).getByRole('option', { name: /^db-01/ })
    expect(taken.getAttribute('aria-disabled')).toBe('true')
    expect(taken.textContent).toContain('Already a source')
    fireEvent.click(within(destinations).getByRole('option', { name: /^db-02/ }))
    await closeList(dialog, DESTINATIONS)
    const sources = await openList(dialog, SOURCES)
    expect(within(sources).getByRole('option', { name: /^db-02/ }).getAttribute('aria-disabled')).toBe('true')
    expect(within(sources).getByRole('option', { name: /^db-02/ }).textContent).toContain('Already a destination')
  })

  it('takes with Enter the first VM that matches what is typed, never one already on the other side', async () => {
    renderDialog()
    const dialog = await screen.findByRole('dialog', { name: 'New exception' })
    // The person is in the field: without the focus the field drops what is typed at each render.
    fireEvent.focus(field(dialog, SOURCES))
    fireEvent.change(field(dialog, SOURCES), { target: { value: 'db-02' } })
    expect(within(await screen.findByRole('listbox')).getAllByRole('option').map(o => o.textContent)).toEqual(['db-02202'])
    fireEvent.keyDown(field(dialog, SOURCES), { key: 'Enter' })
    expect(within(dialog).getByTestId('exception-sources-value').textContent).toBe('db-02')
    await closeList(dialog, SOURCES)
    // db-02 is a source: typed among the destinations, Enter skips it for the next match, and takes nothing when it is the only one.
    fireEvent.focus(field(dialog, DESTINATIONS))
    fireEvent.change(field(dialog, DESTINATIONS), { target: { value: 'db-02' } })
    await screen.findByRole('listbox')
    fireEvent.keyDown(field(dialog, DESTINATIONS), { key: 'Enter' })
    expect(within(dialog).queryByTestId('exception-destinations-value')?.textContent ?? '').toBe('')
    fireEvent.change(field(dialog, DESTINATIONS), { target: { value: 'db-0' } })
    await screen.findByRole('listbox')
    fireEvent.keyDown(field(dialog, DESTINATIONS), { key: 'Enter' })
    expect(within(dialog).getByTestId('exception-destinations-value').textContent).toBe('db-01')
    await closeList(dialog, DESTINATIONS)
    expect(within(dialog).getByTestId('exception-sources-value').textContent).toBe('db-02')
  })

  it('offers tcp and udp for ports typed alone, and takes what is typed', async () => {
    const { onSave } = renderDialog({ sources: [refOf(app1)], destinations: [refOf(db1)], services: [], comment: '' })
    const dialog = await screen.findByRole('dialog', { name: 'New exception' })
    fireEvent.change(field(dialog, SERVICES), { target: { value: '8443' } })
    expect(within(await screen.findByRole('listbox')).getAllByRole('option').map(o => o.textContent)).toEqual(['Add tcp/8443', 'Add udp/8443'])
    fireEvent.keyDown(field(dialog, SERVICES), { key: 'Enter' })
    // A listed service is found by its name, and by its port once one is typed.
    fireEvent.change(field(dialog, SERVICES), { target: { value: '5432' } })
    expect(within(await screen.findByRole('listbox')).getAllByRole('option').map(o => o.textContent)).toEqual(['Add tcp/5432', 'Add udp/5432', 'PostgreSQLtcp/5432'])
    fireEvent.change(field(dialog, SERVICES), { target: { value: 'UDP 5000:5010' } })
    fireEvent.blur(field(dialog, SERVICES))
    expect(within(dialog).getByTestId('exception-services-value').textContent).toBe('tcp/8443, udp/5000:5010')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave.mock.calls[0][0].services).toEqual(['tcp/8443', 'udp/5000:5010'])
  })

  it('refuses a whole protocol and an unknown text as typed input, and keeps what was picked', async () => {
    renderDialog({ sources: [refOf(app1)], destinations: [refOf(db1)], services: ['ssh'], comment: '' })
    const dialog = await screen.findByRole('dialog', { name: 'New exception' })
    for (const text of ['tcp', 'gopher']) {
      fireEvent.change(field(dialog, SERVICES), { target: { value: text } })
      fireEvent.keyDown(field(dialog, SERVICES), { key: 'Enter' })
      expect(within(dialog).getByText(/^Not a service/)).toBeTruthy()
      expect(within(dialog).getByTestId('exception-services-value').textContent).toBe('SSH')
      expect(field(dialog, SERVICES).value).toBe(text)
      expect((within(dialog).getByRole('button', { name: 'Add' }) as HTMLButtonElement).disabled).toBe(true)
    }
    // Erased, the refused text no longer holds the save.
    fireEvent.change(field(dialog, SERVICES), { target: { value: '' } })
    expect((within(dialog).getByRole('button', { name: 'Add' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('does not save while a typed text that is not a service is in the field, and keeps the error in sight', async () => {
    const { onSave } = renderDialog({ sources: [refOf(app1)], destinations: [refOf(db1)], services: ['ssh'], comment: '' })
    const dialog = await screen.findByRole('dialog', { name: 'New exception' })
    const add = () => within(dialog).getByRole('button', { name: 'Add' }) as HTMLButtonElement
    // Typed and left for the save button: the text is refused when the field loses the focus.
    fireEvent.change(field(dialog, SERVICES), { target: { value: 'gopher' } })
    fireEvent.blur(field(dialog, SERVICES))
    expect(within(dialog).getByText(/^Not a service/)).toBeTruthy()
    expect(field(dialog, SERVICES).value).toBe('gopher')
    expect(add().disabled).toBe(true)
    fireEvent.click(add())
    expect(onSave).not.toHaveBeenCalled()
    // Corrected, it is taken and the save is offered again.
    fireEvent.change(field(dialog, SERVICES), { target: { value: 'tcp/70' } })
    expect(within(dialog).queryByText(/^Not a service/)).toBeNull()
    fireEvent.blur(field(dialog, SERVICES))
    expect(add().disabled).toBe(false)
    fireEvent.click(add())
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave.mock.calls[0][0].services).toEqual(['ssh', 'tcp/70'])
  })

  it('disables the save beyond 50 rules and proposes a flow of the zone', async () => {
    const many = [app1, app2, batch].map(refOf)
    const targets = [db1, db2, guest(203, 'db-03')].map(refOf)
    renderDialog({ sources: many, destinations: targets, services: ['postgresql', 'mysql', 'redis', 'ssh', 'ping'], comment: '' })
    const dialog = await screen.findByRole('dialog', { name: 'New exception' })
    // 3 sources, 3 destinations, 6 stored services (a ping is two).
    expect(within(dialog).getByText('54 rules, 50 at most: allow a flow of the zone instead')).toBeTruthy()
    expect((within(dialog).getByRole('button', { name: 'Add' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('counts a service named twice once', async () => {
    renderDialog({ sources: [refOf(app1)], destinations: [refOf(db1)], services: ['postgresql', 'tcp/5432', 'ping'], comment: '' })
    const dialog = await screen.findByRole('dialog', { name: 'New exception' })
    expect(within(dialog).getByText('3 rules')).toBeTruthy()
  })

  it('edits a stored exception: its guests and services stay in their order, new picks go last, names are those of the inventory', async () => {
    const stored: ExceptionDraft = {
      id: 'e1',
      sources: [{ type: 'qemu', vmid: 102, name: 'old-name' }, refOf(app1), { type: 'qemu', vmid: 999, name: 'gone' }],
      destinations: [refOf(db2), refOf(db1)],
      // A whole protocol and an unknown one, as the orchestrator may store them.
      services: ['tcp', 'sctp/9000', 'postgresql'],
      comment: 'kept',
    }
    const { onSave } = renderDialog(stored)
    const dialog = await screen.findByRole('dialog', { name: 'Edit exception' })
    expect(within(dialog).getByTestId('exception-sources-value').textContent).toBe('app-02, app-01, gone')
    expect(within(dialog).getByTestId('exception-services-value').textContent).toBe('tcp, sctp/9000, PostgreSQL')
    await pick(dialog, SOURCES, /^batch/)
    await pick(dialog, SERVICES, /^SSH/)
    expect(within(dialog).queryByText(/^Not a service/)).toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave.mock.calls[0][0]).toEqual({
      id: 'e1',
      sources: [refOf(app2), refOf(app1), { type: 'qemu', vmid: 999, name: 'gone' }, refOf(batch)],
      destinations: [refOf(db2), refOf(db1)],
      services: ['tcp', 'sctp/9000', 'postgresql', 'ssh'],
      comment: 'kept',
    })
  })

  it('shows the error of a save that fails and stays open', async () => {
    const onSave = vi.fn(async () => { throw new Error('boom') })
    renderWithProviders(
      <ExceptionDialog open exception={{ sources: [refOf(app1)], destinations: [refOf(db1)], services: ['ssh'], comment: '' }} guests={guests} members={members} onSave={onSave} onClose={vi.fn()} />,
    )
    const dialog = await screen.findByRole('dialog', { name: 'New exception' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }))
    expect(await within(dialog).findByRole('alert')).toBeTruthy()
  })

  it('renders nothing while closed', () => {
    renderWithProviders(<ExceptionDialog open={false} exception={null} guests={guests} members={members} onSave={vi.fn()} onClose={vi.fn()} />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('ExceptionsTableDialog', () => {
  const first: ExceptionDraft = { id: 'e1', sources: [refOf(app1), refOf(app2)], destinations: [refOf(db1)], services: ['postgresql', 'tcp/8443'], comment: '' }
  const second: ExceptionDraft = { id: 'e2', sources: [refOf(batch)], destinations: [refOf(app1)], services: ['ping'], comment: '' }
  const wide: ExceptionDraft = { id: 'e3', sources: [refOf(app1), refOf(app2), refOf(batch), { type: 'qemu', vmid: 999, name: '' }], destinations: [refOf(db1), refOf(db2)], services: ['ssh'], comment: '' }

  function renderTable(values: ExceptionDraft[], over: { zoneState?: 'disabled' | 'observe' | 'enforce'; guestsKnown?: boolean; zoneName?: string } = {}) {
    const onChange = vi.fn((_next: ExceptionDraft[]) => undefined)
    const onClose = vi.fn()
    renderWithProviders(
      <ExceptionsTableDialog zoneName={over.zoneName ?? 'db'} zoneColor='#1976d2' values={values} guests={guests} members={members} zoneState={over.zoneState ?? 'observe'}
        guestsKnown={over.guestsKnown} onChange={onChange} onClose={onClose} />,
    )
    const dialog = screen.getByRole('dialog', { name: /^VM exceptions/ })
    return { onChange, onClose, dialog }
  }
  const bodyRows = (dialog: HTMLElement) => within(dialog).getAllByRole('row').slice(1)
  const cells = (row: HTMLElement) => within(row).getAllByRole('cell')
  const filter = (dialog: HTMLElement, text: string) => fireEvent.change(within(dialog).getByRole('textbox', { name: 'Filter by VM, VMID or service' }), { target: { value: text } })

  it('is titled with the zone and its icon, has its filter and its add button on one toolbar, and closes from its footer', () => {
    const { dialog, onClose } = renderTable([first])
    expect(screen.getByRole('dialog', { name: 'VM exceptions · db' })).toBe(dialog)
    expect(within(dialog).getByTestId('exceptions-table-icon').className).toContain('ri-shield-fill')
    const toolbar = within(dialog).getByTestId('exceptions-table-toolbar')
    expect(within(toolbar).getByRole('textbox', { name: 'Filter by VM, VMID or service' })).toBeTruthy()
    expect(within(toolbar).getByRole('button', { name: 'Add an exception' })).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('names the dialog without a zone that has no name yet', () => {
    renderTable([], { zoneName: '' })
    expect(screen.getByRole('dialog', { name: 'VM exceptions' })).toBeTruthy()
  })

  it('lists one row per exception: source VMs, destination VMs, services and status, a VM icon first in each VM cell', () => {
    const { dialog } = renderTable([first, second])
    expect(within(dialog).getAllByRole('columnheader').map(h => h.textContent)).toEqual(['Source VMs', 'Destination VMs', 'Services', 'Status', ''])
    const rows = bodyRows(dialog)
    expect(rows.map(r => r.getAttribute('aria-label'))).toEqual(['app-01, app-02 → db-01 · PostgreSQL, tcp/8443', 'batch → app-01 · Ping'])
    const [sources, destinations, services, status] = cells(rows[0])
    expect(sources.textContent).toBe('app-01, app-02')
    expect(sources.querySelector('i')?.className).toContain('ri-')
    expect(destinations.textContent).toBe('db-01')
    expect(destinations.querySelector('i')?.className).toContain('ri-')
    expect(services.textContent).toBe('PostgreSQL, tcp/8443')
    expect(status.textContent).toBe('')
    expect(cells(rows[1])[3].textContent).toBe('No destination in the zone')
  })

  it('shows two VMs then "+N", and every VM with its VMID in the tooltip of the "+N"', async () => {
    const { dialog } = renderTable([wide])
    const [sources, destinations] = cells(bodyRows(dialog)[0])
    expect(sources.textContent).toBe('app-01, app-02+2')
    // Exactly two destinations: no "+N".
    expect(destinations.textContent).toBe('db-01, db-02')
    fireEvent.mouseOver(within(sources).getByText('+2'))
    const tip = await screen.findByRole('tooltip')
    expect([...tip.querySelectorAll('[data-guest]')].map(l => l.textContent)).toEqual(['app-01 (101)', 'app-02 (102)', 'batch (300)', '999'])
  })

  it('says the status of an exception only when it does not read an unknown guest list', () => {
    const { dialog } = renderTable([second], { guestsKnown: false })
    expect(cells(bodyRows(dialog)[0])[3].textContent).toBe('')
  })

  it('marks every exception of a zone that is not applied, guest list known or not', () => {
    const { dialog } = renderTable([first], { zoneState: 'disabled', guestsKnown: false })
    expect(cells(bodyRows(dialog)[0])[3].textContent).toBe('Zone not applied')
  })

  it('filters on a VM name, a VMID or a service, whatever the case', () => {
    const { dialog } = renderTable([first, second, wide])
    const labels = () => bodyRows(dialog).map(r => r.getAttribute('aria-label'))
    filter(dialog, 'BATCH')
    expect(labels()).toEqual(['batch → app-01 · Ping', 'app-01, app-02, batch, 999 → db-01, db-02 · SSH'])
    filter(dialog, '202')
    expect(labels()).toEqual(['app-01, app-02, batch, 999 → db-01, db-02 · SSH'])
    filter(dialog, 'postgres')
    expect(labels()).toEqual(['app-01, app-02 → db-01 · PostgreSQL, tcp/8443'])
    filter(dialog, '8443')
    expect(labels()).toEqual(['app-01, app-02 → db-01 · PostgreSQL, tcp/8443'])
    filter(dialog, 'nothing-like-this')
    expect(within(dialog).getByText('No exception matches the filter')).toBeTruthy()
    expect(bodyRows(dialog)).toHaveLength(1)
  })

  it('says that the zone has no exception', () => {
    const { dialog } = renderTable([])
    expect(within(dialog).getByText('No exception')).toBeTruthy()
    expect(within(dialog).queryByText('No exception matches the filter')).toBeNull()
  })

  it('pages a long list, and goes back to the first page when the filter changes', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ ...(i === 11 ? second : first), id: `e${i}` }))
    const { dialog } = renderTable(many)
    expect(bodyRows(dialog)).toHaveLength(10)
    expect(within(dialog).getByText('1-10 of 12')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Next page' }))
    expect(bodyRows(dialog)).toHaveLength(2)
    expect(within(dialog).getByText('11-12 of 12')).toBeTruthy()
    filter(dialog, 'batch')
    expect(bodyRows(dialog).map(r => r.getAttribute('aria-label'))).toEqual(['batch → app-01 · Ping'])
    expect(within(dialog).queryByText(/of 12/)).toBeNull()
  })

  it('deletes an exception from its row, without a question (nothing is written before the zone is saved)', () => {
    const confirm = vi.spyOn(window, 'confirm')
    const { dialog, onChange } = renderTable([first, second])
    fireEvent.click(within(bodyRows(dialog)[0]).getByRole('button', { name: 'Delete exception' }))
    expect(onChange).toHaveBeenCalledWith([second])
    expect(confirm).not.toHaveBeenCalled()
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
  })

  it('deletes the right exception of a filtered list', () => {
    const { dialog, onChange } = renderTable([first, second])
    filter(dialog, 'batch')
    fireEvent.click(within(bodyRows(dialog)[0]).getByRole('button', { name: 'Delete exception' }))
    expect(onChange).toHaveBeenCalledWith([first])
  })

  it('edits an exception in the exception dialog, prefilled, and puts it back at its place', async () => {
    const { dialog, onChange } = renderTable([first, second])
    fireEvent.click(within(bodyRows(dialog)[0]).getByRole('button', { name: 'Edit exception' }))
    const edit = await screen.findByRole('dialog', { name: 'Edit exception' })
    expect(within(edit).getByTestId('exception-sources-value').textContent).toBe('app-01, app-02')
    await pick(edit, SERVICES, /^SSH/)
    fireEvent.click(within(edit).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1))
    expect(onChange.mock.calls[0][0]).toEqual([{ ...first, services: ['postgresql', 'tcp/8443', 'ssh'] }, second])
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit exception' })).toBeNull())
  })

  it('says the status in full in the tooltip of its chip, then explains it', async () => {
    const { dialog } = renderTable([second])
    fireEvent.mouseOver(within(cells(bodyRows(dialog)[0])[3]).getByText('No destination in the zone'))
    const tip = await screen.findByRole('tooltip')
    expect(within(tip).getByTestId('exception-status-label').textContent).toBe('No destination in the zone')
    expect(tip.textContent).toBe('No destination in the zoneNone of its destinations is a member of the zone: the exception allows nothing until one joins it.')
  })

  it('never cuts the status chip: its column fits it, the VM and service columns give way', () => {
    const { dialog } = renderTable([second])
    const row = cells(bodyRows(dialog)[0])
    const chip = within(row[3]).getByText('No destination in the zone').closest('.MuiChip-root')!
    expect(chip).toHaveStyle({ flexShrink: '0' })
    expect(chip).not.toHaveStyle({ maxWidth: '200px' })
    expect(within(dialog).getByRole('table')).not.toHaveStyle({ tableLayout: 'fixed' })
    const head = within(dialog).getAllByRole('columnheader')
    // The status column is as wide as its widest chip, on one line.
    expect(head[3]).toHaveStyle({ width: '1%', whiteSpace: 'nowrap' })
    expect(row[3]).toHaveStyle({ whiteSpace: 'nowrap' })
    // The three other columns share what is left and cut their text.
    for (const i of [0, 1, 2]) {
      expect(head[i]).toHaveStyle({ maxWidth: '0' })
      expect(row[i]).toHaveStyle({ maxWidth: '0' })
    }
  })

  it('clears the filter and shows the last page after an add, so that the new exception is in sight', async () => {
    // The parent holds the list, as the zone form does.
    function Held() {
      const [values, setValues] = useState<ExceptionDraft[]>(Array.from({ length: 10 }, (_, i) => ({ ...first, id: `e${i}` })))
      return <ExceptionsTableDialog zoneName='db' zoneColor='' values={values} guests={guests} members={members} zoneState='observe' onChange={setValues} onClose={vi.fn()} />
    }
    renderWithProviders(<Held />)
    const dialog = screen.getByRole('dialog', { name: 'VM exceptions · db' })
    filter(dialog, 'postgres')
    expect(bodyRows(dialog)).toHaveLength(10)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add an exception' }))
    const add = await screen.findByRole('dialog', { name: 'New exception' })
    await pick(add, SOURCES, /^batch/)
    await pick(add, DESTINATIONS, /^db-02/)
    await pick(add, SERVICES, /^SSH/)
    fireEvent.click(within(add).getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New exception' })).toBeNull())
    expect((within(dialog).getByRole('textbox', { name: 'Filter by VM, VMID or service' }) as HTMLInputElement).value).toBe('')
    expect(within(dialog).getByText('11-11 of 11')).toBeTruthy()
    expect(bodyRows(dialog).map(r => r.getAttribute('aria-label'))).toEqual(['batch → db-02 · SSH'])
  })

  it('adds an exception at the end of the list from an empty exception dialog', async () => {
    const { dialog, onChange } = renderTable([first])
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add an exception' }))
    const add = await screen.findByRole('dialog', { name: 'New exception' })
    expect(within(add).queryByTestId('exception-sources-value')?.textContent ?? '').toBe('')
    await pick(add, SOURCES, /^batch/)
    await pick(add, DESTINATIONS, /^db-02/)
    await pick(add, SERVICES, /^All protocols/)
    fireEvent.click(within(add).getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1))
    expect(onChange.mock.calls[0][0]).toEqual([first, { sources: [refOf(batch)], destinations: [refOf(db2)], services: ['all'], comment: '' }])
  })
})

describe('ZoneDialog exceptions', () => {
  const dbZone = zone('zd', { name: 'db', state: 'observe' })
  const stored = (id: string, over: Partial<MicrosegException> = {}): MicrosegException => ({
    id, policy_id: 'p1', connection_id: 'c1', zone_id: 'zd', sources: [refOf(app1)], destinations: [refOf(db1)], services: [{ proto: 'tcp', dport: '5432' }], comment: '', created_by: 'me', ...over,
  })
  const draft = policy({ zones: [dbZone], exceptions: [stored('e1'), stored('e2', { sources: [refOf(app2)] }), stored('e9', { zone_id: 'other' })] })

  const inventory = () => reply(200, { data: { vms: [vm(101, 'app-01', []), vm(102, 'app-02', []), vm(201, 'db-01', ['zone-db'])] } })

  function renderZone(z: typeof dbZone | null, p = draft, guestsAnswer: () => unknown = inventory) {
    mock.routes[`GET ${GUESTS_ROUTE}`] = guestsAnswer
    const onSave = vi.fn(async (_values: ZoneFormValues) => undefined)
    renderWithProviders(
      // The dialog reads the guests of the connection itself.
      <SWRConfig value={{ revalidateOnMount: true, dedupingInterval: 0, errorRetryCount: 0 }}>
        <ZoneDialog zone={z} connectionId='c1' readyAfterHours={24} onSave={onSave} onClose={vi.fn()} policy={p} />
      </SWRConfig>,
    )
    return { onSave }
  }
  const summary = (dialog: HTMLElement) => within(dialog).getByTestId('zone-exceptions-summary').textContent
  /** Opens the table of the exceptions from the zone dialog. */
  const manage = async (zoneDialog: HTMLElement) => {
    fireEvent.click(within(zoneDialog).getByRole('button', { name: 'Manage' }))
    return screen.findByRole('dialog', { name: /^VM exceptions/ })
  }
  const closeTable = async (table: HTMLElement) => {
    fireEvent.click(within(table).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /^VM exceptions/ })).toBeNull())
  }
  const tableRows = (table: HTMLElement) => within(table).getAllByRole('row').slice(1)

  it('sums up the exceptions of the zone on one row with the button that manages them, and lists none itself', async () => {
    renderZone(dbZone)
    const dialog = await screen.findByRole('dialog', { name: 'Edit zone' })
    expect(summary(dialog)).toBe('2 exceptions')
    expect(within(dialog).getByRole('button', { name: 'Manage' })).toBeTruthy()
    expect(within(dialog).queryAllByRole('listitem')).toHaveLength(0)
    expect(within(dialog).queryByRole('button', { name: 'Add an exception' })).toBeNull()
    expect(within(dialog).queryByRole('button', { name: 'Delete exception' })).toBeNull()
    const table = await manage(dialog)
    expect(screen.getByRole('dialog', { name: 'VM exceptions · db' })).toBe(table)
    await waitFor(() => expect(tableRows(table).map(r => r.getAttribute('aria-label'))).toEqual(['app-01 → db-01 · PostgreSQL', 'app-02 → db-01 · PostgreSQL']))
  })

  it('counts one exception in the singular', async () => {
    renderZone(dbZone, policy({ zones: [dbZone], exceptions: [stored('e1')] }))
    expect(summary(await screen.findByRole('dialog', { name: 'Edit zone' }))).toBe('1 exception')
  })

  it('marks the row when an exception is not active, once the guest list is known', async () => {
    // app-02 is not in this inventory: the second exception names a guest that is gone.
    renderZone(dbZone, draft, () => reply(200, { data: { vms: [vm(101, 'app-01', []), vm(201, 'db-01', ['zone-db'])] } }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit zone' })
    expect((await within(dialog).findByTestId('zone-exceptions-not-active')).textContent).toBe('1 not active')
  })

  it('does not mark the row while every exception is active', async () => {
    renderZone(dbZone)
    const dialog = await screen.findByRole('dialog', { name: 'Edit zone' })
    await waitFor(() => expect(calls(`GET ${GUESTS_ROUTE}`).length).toBeGreaterThan(0))
    const table = await manage(dialog)
    await waitFor(() => expect(tableRows(table)[0].querySelector('i.ri-question-line')).toBeNull())
    await closeTable(table)
    expect(within(dialog).queryByTestId('zone-exceptions-not-active')).toBeNull()
  })

  it('marks every exception of a zone that is not applied', async () => {
    const off = zone('zd', { name: 'db', state: 'disabled' })
    renderZone(off, policy({ zones: [off], exceptions: [stored('e1'), stored('e2', { sources: [refOf(app2)] })] }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit zone' })
    expect(within(dialog).getByTestId('zone-exceptions-not-active').textContent).toBe('2 not active')
  })

  it('hands the list and the removed ones to the save, once an exception is removed in the table', async () => {
    const { onSave } = renderZone(dbZone)
    const dialog = await screen.findByRole('dialog', { name: 'Edit zone' })
    const table = await manage(dialog)
    fireEvent.click(within(tableRows(table)[0]).getByRole('button', { name: 'Delete exception' }))
    // Nothing is written by the table.
    expect(onSave).not.toHaveBeenCalled()
    await closeTable(table)
    expect(summary(dialog)).toBe('1 exception')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave.mock.calls[0][0]).toMatchObject({
      exceptions: [{ id: 'e2', sources: [refOf(app2)], destinations: [refOf(db1)], services: ['postgresql'], comment: '' }],
      removed_exceptions: ['e1'],
    })
  })

  it('hands an exception edited in the table to the save, at its place and with its id', async () => {
    const { onSave } = renderZone(dbZone)
    const dialog = await screen.findByRole('dialog', { name: 'Edit zone' })
    const table = await manage(dialog)
    fireEvent.click(within(tableRows(table)[1]).getByRole('button', { name: 'Edit exception' }))
    const edit = await screen.findByRole('dialog', { name: 'Edit exception' })
    await pick(edit, SERVICES, /^SSH/)
    fireEvent.click(within(edit).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit exception' })).toBeNull())
    expect(tableRows(table)[1].getAttribute('aria-label')).toBe('app-02 → db-01 · PostgreSQL, SSH')
    expect(onSave).not.toHaveBeenCalled()
    await closeTable(table)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave.mock.calls[0][0]).toMatchObject({
      exceptions: [{ id: 'e1', services: ['postgresql'] }, { id: 'e2', sources: [refOf(app2)], services: ['postgresql', 'ssh'] }],
      removed_exceptions: [],
    })
  })

  it('shows no status chip and no mark on its exceptions while the guest list is unknown', async () => {
    renderZone(dbZone, draft, () => reply(500, { error: 'boom' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit zone' })
    await waitFor(() => expect(calls(`GET ${GUESTS_ROUTE}`).length).toBeGreaterThan(0))
    expect(within(dialog).queryByTestId('zone-exceptions-not-active')).toBeNull()
    const table = await manage(dialog)
    const rows = tableRows(table)
    expect(rows.map(r => r.getAttribute('aria-label'))).toEqual(['app-01 → db-01 · PostgreSQL', 'app-02 → db-01 · PostgreSQL'])
    expect(rows.flatMap(r => [...r.querySelectorAll('.MuiChip-root')])).toHaveLength(0)
    await closeTable(table)
    expect(within(dialog).queryByTestId('zone-exceptions-not-active')).toBeNull()
  })

  it('gives a new exception the id it was written with when a later step fails, so the next try does not create it again', async () => {
    mock.routes[`GET ${GUESTS_ROUTE}`] = () => reply(200, { data: { vms: [vm(101, 'app-01', []), vm(201, 'db-01', ['zone-db'])] } })
    let tries = 0
    const onSave = vi.fn(async (values: ZoneFormValues, created: (draft: ExceptionDraft, id: string) => void) => {
      if (++tries > 1) return
      created(values.exceptions[0], 'n1')
      throw new Error('boom')
    })
    renderWithProviders(
      <SWRConfig value={{ revalidateOnMount: true, dedupingInterval: 0, errorRetryCount: 0 }}>
        <ZoneDialog zone={dbZone} connectionId='c1' readyAfterHours={24} onSave={onSave} onClose={vi.fn()} policy={policy({ zones: [dbZone] })} />
      </SWRConfig>,
    )
    const zoneDialog = await screen.findByRole('dialog', { name: 'Edit zone' })
    expect(summary(zoneDialog)).toBe('No exception')
    const table = await manage(zoneDialog)
    fireEvent.click(within(table).getByRole('button', { name: 'Add an exception' }))
    const dialog = await screen.findByRole('dialog', { name: 'New exception' })
    await pick(dialog, SOURCES, /^app-01/)
    await pick(dialog, DESTINATIONS, /^db-01/)
    await pick(dialog, SERVICES, /^SSH/)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New exception' })).toBeNull())
    await closeTable(table)
    expect(summary(zoneDialog)).toBe('1 exception')
    const saveButton = () => within(zoneDialog).getByRole('button', { name: 'Save' }) as HTMLButtonElement
    fireEvent.click(saveButton())
    expect(await within(zoneDialog).findByRole('alert')).toBeTruthy()
    expect(onSave.mock.calls[0][0].exceptions[0].id).toBeUndefined()
    await waitFor(() => expect(saveButton().disabled).toBe(false))
    fireEvent.click(saveButton())
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2))
    expect(onSave.mock.calls[1][0]).toMatchObject({ exceptions: [{ id: 'n1', services: ['ssh'] }], removed_exceptions: [] })
    // Removed after that, it is one of the exceptions to delete.
    const again = await manage(zoneDialog)
    fireEvent.click(within(again).getByRole('button', { name: 'Delete exception' }))
    await closeTable(again)
    fireEvent.click(saveButton())
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(3))
    expect(onSave.mock.calls[2][0]).toMatchObject({ exceptions: [], removed_exceptions: ['n1'] })
  })

  it('hands no exception for a zone that has none', async () => {
    const { onSave } = renderZone(null)
    const dialog = await screen.findByRole('dialog', { name: 'New zone' })
    expect(summary(dialog)).toBe('No exception')
    expect(within(dialog).getByRole('button', { name: 'Manage' })).toBeTruthy()
    expect(within(dialog).queryByTestId('zone-exceptions-not-active')).toBeNull()
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Name' }), { target: { value: 'app' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave.mock.calls[0][0]).toMatchObject({ exceptions: [], removed_exceptions: [] })
  })

  it('adds an exception to a new zone, any VM offered as a destination', async () => {
    const { onSave } = renderZone(null)
    const zoneDialog = await screen.findByRole('dialog', { name: 'New zone' })
    fireEvent.change(within(zoneDialog).getByRole('textbox', { name: 'Name' }), { target: { value: 'app' } })
    const table = await manage(zoneDialog)
    expect(screen.getByRole('dialog', { name: 'VM exceptions · app' })).toBe(table)
    expect(within(table).getByText('No exception')).toBeTruthy()
    fireEvent.click(within(table).getByRole('button', { name: 'Add an exception' }))
    const dialog = await screen.findByRole('dialog', { name: 'New exception' })
    await pick(dialog, SOURCES, /^app-01/)
    await pick(dialog, DESTINATIONS, /^db-01/)
    await pick(dialog, SERVICES, /^PostgreSQL/)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New exception' })).toBeNull())
    await closeTable(table)
    fireEvent.click(within(zoneDialog).getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave.mock.calls[0][0].exceptions).toEqual([{ sources: [refOf(app1)], destinations: [refOf(db1)], services: ['postgresql'], comment: '' }])
  })

  it('cannot open the table while the zone is being saved', async () => {
    let release: () => void = () => undefined
    mock.routes[`GET ${GUESTS_ROUTE}`] = inventory
    const onSave = vi.fn(() => new Promise<void>(resolve => { release = resolve }))
    renderWithProviders(
      <SWRConfig value={{ revalidateOnMount: true, dedupingInterval: 0, errorRetryCount: 0 }}>
        <ZoneDialog zone={dbZone} connectionId='c1' readyAfterHours={24} onSave={onSave} onClose={vi.fn()} policy={draft} />
      </SWRConfig>,
    )
    const dialog = await screen.findByRole('dialog', { name: 'Edit zone' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect((within(dialog).getByRole('button', { name: 'Manage' }) as HTMLButtonElement).disabled).toBe(true))
    release()
    await waitFor(() => expect((within(dialog).getByRole('button', { name: 'Manage' }) as HTMLButtonElement).disabled).toBe(false))
  })
})

describe('exceptions of a policy shared by two clusters', () => {
  const NAMES: Record<string, string> = { c1: 'PVE-PROD', c2: 'PVE-DR' }
  const name = (id: string) => NAMES[id] ?? 'Another cluster'
  const both: ExceptionClusters = { options: [{ id: 'c2', name: 'PVE-DR' }, { id: 'c1', name: 'PVE-PROD' }], preferred: 'c2', name, readIds: ['c1', 'c2'], editIds: ['c1', 'c2'] }
  // The same VMIDs on both clusters are other VMs.
  const appDr = guest(101, 'app-dr', { connectionId: 'c2' })
  const dbDr = guest(201, 'db-dr', { connectionId: 'c2' })
  const webDr = guest(301, 'web-dr', { connectionId: 'c2' })
  const everyGuest = [app1, db1, appDr, dbDr, webDr]
  const everyMember = [member(db1), member(dbDr)]
  const CLUSTER = 'Cluster'

  function renderShared(exception: ExceptionDraft | null = null, clusters: ExceptionClusters = both) {
    const onSave = vi.fn((_draft: ExceptionDraft) => undefined)
    renderWithProviders(<ExceptionDialog open exception={exception} guests={everyGuest} members={everyMember} clusters={clusters} onSave={onSave} onClose={vi.fn()} />)
    return { onSave }
  }
  const options = async (dialog: HTMLElement, label: string) => {
    const list = await openList(dialog, label)
    const names = within(list).getAllByRole('option').map(o => o.textContent)
    await closeList(dialog, label)
    return names
  }
  const chooseCluster = (dialog: HTMLElement, clusterName: string) => {
    fireEvent.mouseDown(within(dialog).getByRole('combobox', { name: CLUSTER }))
    fireEvent.click(within(screen.getByRole('listbox')).getByRole('option', { name: clusterName }))
  }

  it('asks no cluster on a policy of one cluster', async () => {
    renderDialog()
    const dialog = await screen.findByRole('dialog', { name: 'New exception' })
    expect(within(dialog).queryByRole('combobox', { name: CLUSTER })).toBeNull()
  })

  it('starts on the cluster it was opened from, on the first line, and offers that cluster\'s guests only', async () => {
    renderShared()
    const dialog = await screen.findByRole('dialog', { name: 'New exception' })
    const lines = within(dialog).getAllByRole('combobox')
    expect(lines[0]).toBe(within(dialog).getByRole('combobox', { name: CLUSTER }))
    expect(lines[0].textContent).toBe('PVE-DR')
    expect(await options(dialog, DESTINATIONS)).toEqual(['db-dr201', 'app-dr101', 'web-dr301'])
    expect(await options(dialog, SOURCES)).toEqual(['app-dr101', 'db-dr201', 'web-dr301'])
  })

  it('empties both lists when the cluster changes, then offers the guests of the new one', async () => {
    renderShared()
    const dialog = await screen.findByRole('dialog', { name: 'New exception' })
    await pick(dialog, SOURCES, /^app-dr/)
    await pick(dialog, DESTINATIONS, /^db-dr/)
    chooseCluster(dialog, 'PVE-PROD')
    expect(within(dialog).queryByTestId('exception-sources-value')?.textContent ?? '').toBe('')
    expect(within(dialog).queryByTestId('exception-destinations-value')?.textContent ?? '').toBe('')
    expect(await options(dialog, DESTINATIONS)).toEqual(['db-01201', 'app-01101'])
  })

  it('hands the cluster chosen with the exception', async () => {
    const { onSave } = renderShared()
    const dialog = await screen.findByRole('dialog', { name: 'New exception' })
    chooseCluster(dialog, 'PVE-PROD')
    await pick(dialog, SOURCES, /^app-01/)
    await pick(dialog, DESTINATIONS, /^db-01/)
    await pick(dialog, SERVICES, /^SSH/)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    expect(onSave.mock.calls[0][0]).toMatchObject({ connectionId: 'c1', sources: [refOf(app1)], destinations: [refOf(db1)] })
  })

  it('keeps an existing exception on its cluster, named with the guests of that cluster', async () => {
    renderShared({ id: 'e1', connectionId: 'c2', sources: [refOf(appDr)], destinations: [refOf(dbDr)], services: ['ssh'], comment: '' })
    const dialog = await screen.findByRole('dialog', { name: 'Edit exception' })
    const select = within(dialog).getByRole('combobox', { name: CLUSTER })
    expect(select.textContent).toBe('PVE-DR')
    expect(select.getAttribute('aria-disabled')).toBe('true')
    expect(within(dialog).getByTestId('exception-sources-value').textContent).toBe('app-dr')
  })

  it('says it when the cluster it was opened from is not applied yet, and starts on an applied one', async () => {
    renderShared(null, { options: [{ id: 'c1', name: 'PVE-PROD' }], preferred: 'c2', name, readIds: ['c1', 'c2'], editIds: ['c1', 'c2'] })
    const dialog = await screen.findByRole('dialog', { name: 'New exception' })
    expect(within(dialog).getByRole('combobox', { name: CLUSTER }).textContent).toBe('PVE-PROD')
    expect(within(dialog).getByText('PVE-DR is not applied yet: an exception there would protect nothing.')).toBeTruthy()
  })

  it('shows the cluster of each exception in the table, its guests named from that cluster', () => {
    const onDr: ExceptionDraft = { id: 'e2', connectionId: 'c2', sources: [refOf(appDr)], destinations: [refOf(dbDr)], services: ['ssh'], comment: '' }
    const onProd: ExceptionDraft = { id: 'e1', connectionId: 'c1', sources: [refOf(app1)], destinations: [refOf(db1)], services: ['ssh'], comment: '' }
    renderWithProviders(
      <ExceptionsTableDialog zoneName='db' zoneColor='' values={[onProd, onDr]} guests={everyGuest} members={everyMember} zoneState='enforce' clusters={both} onChange={vi.fn()} onClose={vi.fn()} />,
    )
    const rows = screen.getAllByRole('row').slice(1)
    expect(rows.map(r => r.getAttribute('aria-label'))).toEqual(['app-01 → db-01 · SSH', 'app-dr → db-dr · SSH'])
    expect(within(rows[0]).getByText('PVE-PROD')).toBeTruthy()
    expect(within(rows[1]).getByText('PVE-DR')).toBeTruthy()
    // Every guest found on its own cluster: no status to say.
    expect(rows.flatMap(r => [...r.querySelectorAll('.MuiChip-colorWarning')])).toHaveLength(0)
  })

  it('lists, without a status and without its edit and delete, an exception of a cluster the user cannot see', () => {
    const far: ExceptionDraft = { id: 'e3', connectionId: 'c3', sources: [{ type: 'qemu', vmid: 101, name: 'far' }], destinations: [refOf(dbDr)], services: ['ssh'], comment: '' }
    renderWithProviders(
      <ExceptionsTableDialog zoneName='db' zoneColor='' values={[far]} guests={everyGuest} members={everyMember} zoneState='enforce' clusters={both} onChange={vi.fn()} onClose={vi.fn()} />,
    )
    const [row] = screen.getAllByRole('row').slice(1)
    expect(within(row).getByText('Another cluster')).toBeTruthy()
    expect(row.querySelectorAll('.MuiChip-colorWarning')).toHaveLength(0)
    expect((within(row).getByRole('button', { name: 'Edit exception' }) as HTMLButtonElement).disabled).toBe(true)
    expect((within(row).getByRole('button', { name: 'Delete exception' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows no cluster column on a policy of one cluster', () => {
    renderWithProviders(<ExceptionsTableDialog zoneName='db' zoneColor='' values={[]} guests={guests} members={members} zoneState='enforce' onChange={vi.fn()} onClose={vi.fn()} />)
    expect(screen.queryByRole('columnheader', { name: CLUSTER })).toBeNull()
  })

  it('reads the guests of every cluster in the zone dialog: a queued member of the other cluster is offered first', async () => {
    const dbZone = zone('zd', { name: 'db', state: 'observe' })
    const links = ['c1', 'c2'].map(connection_id => ({ connection_id, active: true, stop_cluster_disabled: false, policy_id: 'p1', created_at: '', activated_at: null }))
    mock.routes[`GET ${GUESTS_ROUTE}`] = () => reply(200, { data: { vms: [vm(101, 'app-01', []), vm(201, 'db-01', ['zone-db'])] } })
    mock.routes['GET /api/v1/vms?connId=c2'] = () => reply(200, { data: { vms: [vm(101, 'app-dr', []), vm(202, 'db-dr', [])] } })
    const p = policy({ zones: [dbZone], clusters: links, pending_members: [{ id: 'pm1', policy_id: 'p1', connection_id: 'c2', node: 'pve1', type: 'qemu', vmid: 202, zone_id: 'zd' }] })
    renderWithProviders(
      <SWRConfig value={{ revalidateOnMount: true, dedupingInterval: 0, errorRetryCount: 0 }}>
        <ZoneDialog zone={dbZone} connectionId='c1' readyAfterHours={24} onSave={vi.fn()} onClose={vi.fn()} policy={p} clusterName={id => NAMES[id] ?? id} />
      </SWRConfig>,
    )
    const zoneDialog = await screen.findByRole('dialog', { name: 'Edit zone' })
    await waitFor(() => expect(calls('GET /api/v1/vms?connId=c2').length).toBeGreaterThan(0))
    fireEvent.click(within(zoneDialog).getByRole('button', { name: 'Manage' }))
    const table = await screen.findByRole('dialog', { name: /^VM exceptions/ })
    fireEvent.click(within(table).getByRole('button', { name: 'Add an exception' }))
    const dialog = await screen.findByRole('dialog', { name: 'New exception' })
    chooseCluster(dialog, 'PVE-DR')
    const list = await openList(dialog, DESTINATIONS)
    expect(list.textContent).toMatch(/^Members of the zone.*db-dr202.*Not members yet.*app-dr101/)
    expect(list.textContent).not.toContain('Not in the inventory')
  })
})

describe('the writes of the exceptions of a shared policy', () => {
  const C2 = '/api/v1/firewall/microseg/c2'
  const app = { type: 'qemu' as const, vmid: 101, name: 'app-01' }
  const db = { type: 'qemu' as const, vmid: 201, name: 'db-01' }
  const onDr = (id: string): MicrosegException => ({
    id, policy_id: 'p1', connection_id: 'c2', zone_id: 'zw', sources: [app], destinations: [db], services: [{ proto: 'tcp', dport: '22' }], comment: '', created_by: 'me',
  })
  const draft = policy({ zones: [zone('zw', { name: 'web', state: 'disabled' })], exceptions: [onDr('e2')] })

  function wrapper({ children }: { children: ReactNode }) {
    return (
      <NextIntlClientProvider locale='en' messages={enMessages as Record<string, unknown>}>
        <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
      </NextIntlClientProvider>
    )
  }
  const setup = () => renderHook(() => useZoneEdits({ connectionId: 'c1', policy: draft, reloadPolicy: vi.fn(async () => undefined), startRun: vi.fn() }), { wrapper })

  it('writes a new exception through the cluster chosen', async () => {
    mock.routes[`POST ${C2}/exceptions`] = () => reply(200, { version: 4, exception: {} })
    const { result } = setup()
    await act(() => result.current.saveException('zw', { connectionId: 'c2', sources: [app], destinations: [db], services: ['ssh'], comment: '' }))
    expect(calls('POST /exceptions')).toHaveLength(0)
    expect(body(calls(`POST ${C2}/exceptions`)[0][1] as RequestInit)).toMatchObject({ version: 3, zone_id: 'zw' })
  })

  it('updates and deletes an exception through its own cluster', async () => {
    mock.routes[`PUT ${C2}/exceptions/e2`] = () => reply(200, { version: 4, exception: {} })
    mock.routes[`DELETE ${C2}/exceptions/e2`] = () => reply(200, { version: 5 })
    const { result } = setup()
    await act(() => result.current.saveException('zw', { id: 'e2', connectionId: 'c2', sources: [app], destinations: [db], services: ['https'], comment: '' }))
    await act(() => result.current.deleteException('e2'))
    expect(calls('PUT /exceptions/e2')).toHaveLength(0)
    expect(calls('DELETE /exceptions/e2')).toHaveLength(0)
    expect(calls(`PUT ${C2}/exceptions/e2`)).toHaveLength(1)
    expect(calls(`DELETE ${C2}/exceptions/e2`)).toHaveLength(1)
  })

  it('writes the exceptions of a zone each through its cluster, each with the version the write before returned', async () => {
    let v = 3
    mock.routes['PUT /zones/zw'] = () => reply(200, { version: ++v, zone: {} })
    mock.routes[`DELETE ${C2}/exceptions/e2`] = () => reply(200, { version: ++v })
    mock.routes['POST /exceptions'] = () => reply(200, { version: ++v, exception: {} })
    mock.routes[`POST ${C2}/exceptions`] = () => reply(200, { version: ++v, exception: {} })
    const { result } = setup()
    const values = {
      name: 'web', label: '', color: '#ef4444', isolate_members: false, state: 'disabled' as const, egress_state: 'off' as const, egress_mode: 'local' as const, gateway: '', gateway_services: [],
      exceptions: [
        { connectionId: 'c1', sources: [app], destinations: [db], services: ['ssh'], comment: '' },
        { connectionId: 'c2', sources: [app], destinations: [db], services: ['https'], comment: '' },
      ],
      removed_exceptions: ['e2'],
    }
    await act(() => result.current.saveZone(draft.zones[0], values))
    expect(body(calls(`DELETE ${C2}/exceptions/e2`)[0][1] as RequestInit)).toEqual({ version: 4 })
    expect(body(calls('POST /exceptions')[0][1] as RequestInit).version).toBe(5)
    expect(body(calls(`POST ${C2}/exceptions`)[0][1] as RequestInit).version).toBe(6)
  })
})

describe('the exceptions of a zone panel on a shared policy', () => {
  const NAMES: Record<string, string> = { c1: 'PVE-PROD', c2: 'PVE-DR' }
  const C3_GUESTS = 'GET /api/v1/vms?connId=c3'
  const web = zone('zw', { name: 'web', state: 'enforce' })
  const links = ['c1', 'c2', 'c3'].map(connection_id => ({ connection_id, active: true, stop_cluster_disabled: false, policy_id: 'p1', created_at: '', activated_at: null }))
  const on = (id: string, connection_id: string, sources: { type: 'qemu'; vmid: number; name: string }[]): MicrosegException => ({
    id, policy_id: 'p1', connection_id, zone_id: 'zw', sources, destinations: [{ type: 'qemu', vmid: 201, name: '' }], services: [{ proto: 'tcp', dport: '22' }], comment: '', created_by: 'me',
  })
  const shared = policy({
    zones: [web], clusters: links,
    exceptions: [on('e1', 'c1', [{ type: 'qemu', vmid: 101, name: 'app-01' }]), on('e2', 'c2', [{ type: 'qemu', vmid: 101, name: 'app-dr' }]), on('e3', 'c3', [{ type: 'qemu', vmid: 101, name: 'far' }])],
  })
  const members: ZoneMember[] = [
    { connectionId: 'c1', ref: { node: 'pve1', type: 'qemu', vmid: 201 }, guest: null, pending: false },
    { connectionId: 'c2', ref: { node: 'pve1', type: 'qemu', vmid: 201 }, guest: null, pending: false },
  ]

  function Panel({ p, clusterName }: { p: typeof shared; clusterName?: (id: string) => string }) {
    const edits = useZoneEdits({ connectionId: 'c1', policy: p, reloadPolicy: async () => undefined, startRun: () => undefined, clusterName })
    const editor = useExceptionEditor(edits, web, members, true)
    return (
      <>
        <button type='button' onClick={editor.create}>New</button>
        {editor.list(10)}
        {editor.dialogs}
      </>
    )
  }
  const renderPanel = (p = shared, clusterName: ((id: string) => string) | undefined = id => NAMES[id] ?? id) => {
    mock.routes[`GET ${GUESTS_ROUTE}`] = () => reply(200, { data: { vms: [vm(101, 'app-01', []), vm(201, 'db-01', ['zone-web'])] } })
    mock.routes['GET /api/v1/vms?connId=c2'] = () => reply(200, { data: { vms: [vm(101, 'app-dr', []), vm(201, 'db-dr', ['zone-web'])] } })
    renderWithProviders(
      <SWRConfig value={{ revalidateOnMount: true, dedupingInterval: 0, errorRetryCount: 0 }}>
        <Panel p={p} clusterName={clusterName} />
      </SWRConfig>,
    )
  }
  const line = (label: RegExp) => screen.getAllByRole('listitem').find(l => label.test(l.getAttribute('aria-label') ?? ''))!

  it('shows the cluster of each exception after its icon, names its guests from that cluster, and edits none of a cluster the user cannot see', async () => {
    renderPanel()
    await waitFor(() => expect(screen.getAllByRole('listitem').map(l => l.getAttribute('aria-label'))).toEqual(['app-01 → db-01 · SSH', 'app-dr → db-dr · SSH', 'far → 201 · SSH']))
    expect(within(line(/^app-01/)).getByText('PVE-PROD')).toBeTruthy()
    expect(within(line(/^app-dr/)).getByText('PVE-DR')).toBeTruthy()
    expect(within(line(/^far/)).getByText('Another cluster')).toBeTruthy()
    // Its guests are not read: no status is said of it rather than a false one.
    expect(line(/^far/).querySelectorAll('.MuiChip-colorWarning')).toHaveLength(0)
    expect((within(line(/^far/)).getByRole('button', { name: 'Edit exception' }) as HTMLButtonElement).disabled).toBe(true)
    expect((within(line(/^app-dr/)).getByRole('button', { name: 'Edit exception' }) as HTMLButtonElement).disabled).toBe(false)
    // The guests of a cluster outside the user scope are not read.
    expect(calls(C3_GUESTS)).toHaveLength(0)
  })

  it('locks an exception whose cluster left the group, in the panel and in the table of the zone dialog alike', async () => {
    const gone = policy({ zones: [web], clusters: links.slice(0, 2), exceptions: [on('e1', 'c1', [{ type: 'qemu', vmid: 101, name: 'app-01' }]), on('e9', 'c2b', [{ type: 'qemu', vmid: 101, name: 'left' }])] })
    renderPanel(gone, id => ({ ...NAMES, c2b: 'PVE-OLD' } as Record<string, string>)[id] ?? id)
    await waitFor(() => expect(line(/^left/)).toBeTruthy())
    expect((within(line(/^left/)).getByRole('button', { name: 'Edit exception' }) as HTMLButtonElement).disabled).toBe(true)
    expect((within(line(/^app-01/)).getByRole('button', { name: 'Edit exception' }) as HTMLButtonElement).disabled).toBe(false)
    cleanup()
    const clusters: ExceptionClusters = { options: [{ id: 'c1', name: 'PVE-PROD' }], preferred: 'c1', name: id => NAMES[id] ?? 'Another cluster', readIds: ['c1', 'c2', 'c2b'], editIds: ['c1', 'c2'] }
    renderWithProviders(
      <ExceptionsTableDialog zoneName='web' zoneColor='' values={[{ id: 'e9', connectionId: 'c2b', sources: [], destinations: [], services: ['ssh'], comment: '' }]} guests={[]} members={[]} zoneState='enforce' clusters={clusters} onChange={vi.fn()} onClose={vi.fn()} />,
    )
    const [row] = screen.getAllByRole('row').slice(1)
    expect((within(row).getByRole('button', { name: 'Edit exception' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('opens a new exception on the tab\'s cluster, the clusters the user sees offered', async () => {
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'New' }))
    const dialog = await screen.findByRole('dialog', { name: 'New exception' })
    expect(within(dialog).getByRole('combobox', { name: 'Cluster' }).textContent).toBe('PVE-PROD')
    fireEvent.mouseDown(within(dialog).getByRole('combobox', { name: 'Cluster' }))
    expect(within(screen.getByRole('listbox')).getAllByRole('option').map(o => o.textContent)).toEqual(['PVE-DR', 'PVE-PROD'])
  })

  it('opens an existing exception on its own cluster and writes it through that cluster', async () => {
    mock.routes['PUT /api/v1/firewall/microseg/c2/exceptions/e2'] = () => reply(200, { version: 4, exception: {} })
    renderPanel()
    await waitFor(() => expect(line(/^app-dr/)).toBeTruthy())
    fireEvent.click(within(line(/^app-dr/)).getByRole('button', { name: 'Edit exception' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit exception' })
    expect(within(dialog).getByRole('combobox', { name: 'Cluster' }).textContent).toBe('PVE-DR')
    await pick(dialog, SERVICES, /^HTTPS/)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls('PUT /api/v1/firewall/microseg/c2/exceptions/e2')).toHaveLength(1))
    expect(calls('PUT /exceptions/e2')).toHaveLength(0)
  })

  it('shows no chip and asks no cluster on a policy of one cluster', async () => {
    renderPanel(policy({ zones: [web], exceptions: [on('e1', 'c1', [{ type: 'qemu', vmid: 101, name: 'app-01' }])] }), undefined)
    await waitFor(() => expect(screen.getAllByRole('listitem').map(l => l.getAttribute('aria-label'))).toEqual(['app-01 → db-01 · SSH']))
    expect(within(line(/^app-01/)).queryByText('c1')).toBeNull()
    expect(document.querySelectorAll('[role="listitem"] .MuiChip-root')).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'New' }))
    const dialog = await screen.findByRole('dialog', { name: 'New exception' })
    expect(within(dialog).queryByRole('combobox', { name: 'Cluster' })).toBeNull()
  })
})
