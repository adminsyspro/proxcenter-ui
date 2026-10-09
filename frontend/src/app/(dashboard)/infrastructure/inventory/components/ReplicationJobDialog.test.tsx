/**
 * Component tests for ReplicationJobDialog: a free schedule, the targets a
 * guest already replicates to, the edit request, and Proxmox's refusal.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, within } from '@testing-library/react'
import { renderWithProviders, screen, waitFor, fireEvent } from '@/__tests__/setup/renderWithProviders'
import { server, http, HttpResponse } from '@/__tests__/setup/msw-server'

import ReplicationJobDialog, { REPLICATION_SCHEDULE_PRESETS, type ReplicationJobDialogState, type ReplicationJob } from './ReplicationJobDialog'

afterEach(() => {
  cleanup()
})

const TARGETS = [
  { node: 'pve2', online: true },
  { node: 'pve3', online: true },
  { node: 'pve4', online: false },
]

const JOB: ReplicationJob = { id: '100-0', guest: 100, target: 'pve2', schedule: '*/15', rate: 50, comment: 'nightly', enabled: true }

function capture(method: 'post' | 'put', reply: () => Response = () => HttpResponse.json({ success: true })) {
  const calls: { connId: string; node: string; body: any }[] = []

  server.use(http[method]('*/api/v1/connections/:id/nodes/:node/replication', async ({ request, params }) => {
    calls.push({ connId: String(params.id), node: String(params.node), body: await request.json() })

    return reply()
  }))

  return calls
}

function open(state: ReplicationJobDialogState, jobs: ReplicationJob[] = []) {
  const onClose = vi.fn()
  const onSaved = vi.fn()

  renderWithProviders(
    <ReplicationJobDialog state={state} connId="c-1" node="pve1" targets={TARGETS} jobs={jobs} onClose={onClose} onSaved={onSaved} />
  )

  return { onClose, onSaved }
}

async function pickTarget(name: string) {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Target' }))
  fireEvent.click(await screen.findByRole('option', { name }))
}

function typeSchedule(value: string) {
  fireEvent.change(screen.getByRole('combobox', { name: 'Schedule' }), { target: { value } })
}

describe('ReplicationJobDialog', () => {
  it('renders nothing without a state', () => {
    open(null)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('creates a job with a schedule that is not in the presets', async () => {
    const calls = capture('post')
    const { onSaved, onClose } = open({ mode: 'create', guest: '100' })

    await pickTarget('pve3')
    typeSchedule('*/3')
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(calls).toEqual([{ connId: 'c-1', node: 'pve1', body: { guest: '100', target: 'pve3', schedule: '*/3', enabled: true } }])
    expect(onClose).toHaveBeenCalled()
  })

  it('does not offer a target the guest already replicates to, nor an offline node', async () => {
    open({ mode: 'create', guest: '100' }, [JOB])

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Target' }))
    const list = await screen.findByRole('listbox')

    expect(within(list).getByRole('option', { name: /pve2 \(already replicated\)/ })).toHaveAttribute('aria-disabled', 'true')
    expect(within(list).getByRole('option', { name: /pve4 \(offline\)/ })).toHaveAttribute('aria-disabled', 'true')
    expect(within(list).getByRole('option', { name: 'pve3' })).not.toHaveAttribute('aria-disabled', 'true')
  })

  it('shows the Proxmox refusal and keeps the dialog open', async () => {
    capture('post', () => HttpResponse.json({ error: 'schedule: unable to parse calendar event' }, { status: 500 }))
    const { onSaved, onClose } = open({ mode: 'create', guest: '100' })

    await pickTarget('pve3')
    typeSchedule('toto')
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    expect(await screen.findByText('schedule: unable to parse calendar event')).toBeInTheDocument()
    expect(onSaved).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('edits a job and sends a cleared rate so that Proxmox removes it', async () => {
    const calls = capture('put')
    const { onSaved } = open({ mode: 'edit', job: JOB })

    expect(screen.getByRole('combobox', { name: 'Schedule' })).toHaveValue('*/15')
    expect(screen.getByLabelText('Target')).toHaveValue('pve2')
    typeSchedule('*/3')
    fireEvent.change(screen.getByLabelText('Rate Limit (MB/s)'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(calls[0].body).toEqual({ jobId: '100-0', schedule: '*/3', rate: '', comment: 'nightly', enabled: true })
  })

  it('lets the node tab pick the guest, then filters its targets', async () => {
    open({ mode: 'create', guests: [{ vmid: 100, name: 'web', type: 'qemu' }, { vmid: 101, name: 'db', type: 'qemu' }] }, [JOB])

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'CT/VM ID' }))
    fireEvent.click(await screen.findByRole('option', { name: '101 - db (qemu)' }))

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Target' }))
    expect(await screen.findByRole('option', { name: 'pve2' })).not.toHaveAttribute('aria-disabled', 'true')
  })

  it('only offers presets the Proxmox calendar parser accepts', () => {
    // Vérifiées avec PVE::CalendarEvent::parse_calendar_event sur PVE 9.2 ;
    // "0 *", "0 */2" et "0 0", proposées avant, y sont refusées.
    expect(REPLICATION_SCHEDULE_PRESETS.map(p => p.value)).toEqual(['*/1', '*/5', '*/10', '*/15', '*/30', 'hourly', '*/2:00', '*/6:00', '*/12:00', 'daily'])
  })
})
