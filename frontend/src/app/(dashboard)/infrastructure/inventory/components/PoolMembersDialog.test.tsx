/**
 * Component tests for PoolMembersDialog: members read on open, the calls an
 * edit sends, the cluster choice and the vDC refusals.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, within } from '@testing-library/react'
import { renderWithProviders, screen, waitFor, fireEvent } from '@/__tests__/setup/renderWithProviders'
import { server, http, HttpResponse } from '@/__tests__/setup/msw-server'

import PoolMembersDialog, { type PoolMembersState } from './PoolMembersDialog'

afterEach(() => cleanup())

const PROD = { connId: 'c-prod', connName: 'PVE-PROD' }
const DR = { connId: 'c-dr', connName: 'PVE-DR' }

const members = (connId: string) => ({
  data: {
    poolid: 'team',
    comment: null,
    guests: connId === 'c-prod' ? [{ vmid: 101, type: 'qemu', node: 'n1', name: 'web', status: 'running', template: false }] : [],
    storages: connId === 'c-prod' ? [{ storage: 'ceph', type: 'rbd', shared: true, nodes: ['n1', 'n2'] }] : [{ storage: 'local', type: 'dir', shared: false, nodes: ['d1'] }],
  },
})

function setup(reply: (body: any) => Response = () => HttpResponse.json({ data: {} }), get: (connId: string) => Response = id => HttpResponse.json(members(id))) {
  const puts: { connId: string; body: any }[] = []

  server.use(
    http.get('*/api/v1/connections/:id/pools', ({ params }) => get(String(params.id))),
    http.put('*/api/v1/connections/:id/pools', async ({ request, params }) => {
      const body = await request.json()

      puts.push({ connId: String(params.id), body })

      return reply(body)
    }),
  )

  return puts
}

function open(state: PoolMembersState) {
  const onClose = vi.fn()
  const onDone = vi.fn()
  const guests = [
    { connId: 'c-prod', vmid: 101, type: 'qemu', node: 'n1', name: 'web', status: 'running', pool: 'team' },
    { connId: 'c-prod', vmid: 102, type: 'lxc', node: 'n2', name: 'cache', status: 'stopped', pool: 'other' },
    { connId: 'c-prod', vmid: 103, type: 'qemu', node: 'n2', name: 'held', status: 'running', pool: 'vdc-acme' },
    { connId: 'c-dr', vmid: 900, type: 'qemu', node: 'd1', name: 'dr', status: 'running', pool: null },
  ]
  const storages = [{ connId: 'c-prod', storage: 'ceph' }, { connId: 'c-prod', storage: 'nfs' }, { connId: 'c-dr', storage: 'local' }]

  renderWithProviders(
    <PoolMembersDialog state={state} guests={guests} storages={storages} nodeStatus={new Map([['c-prod:n1', 'online']])} onClose={onClose} onDone={onDone} />,
  )

  return { onClose, onDone }
}

const pick = async (label: string, option: RegExp) => {
  fireEvent.mouseDown(screen.getByLabelText(label))
  fireEvent.click(await screen.findByRole('option', { name: option }))
}

describe('PoolMembersDialog', () => {
  it('renders nothing without a state', () => {
    open(null)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('lists the members and keeps Save off until something changes', async () => {
    setup()
    open({ poolid: 'team', owners: [PROD] })

    expect(await screen.findByText('web')).toBeInTheDocument()
    expect(screen.getByText('ceph')).toBeInTheDocument()
    expect(screen.getByText('Shared')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('adds a guest from another pool with allow-move, adds a storage, removes a member', async () => {
    const puts = setup()
    const { onDone, onClose } = open({ poolid: 'team', owners: [PROD] })

    await screen.findByText('web')
    fireEvent.mouseDown(screen.getByLabelText('Add guests'))
    // A guest held by a vDC pool is never offered.
    expect(screen.queryByRole('option', { name: /held/ })).not.toBeInTheDocument()
    fireEvent.click(await screen.findByRole('option', { name: /cache/ }))
    expect(screen.getByText('1 guest leaves its current pool')).toBeInTheDocument()
    await pick('Add storages', /nfs/)
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove from the pool' })[0])
    expect(screen.getByRole('button', { name: 'Keep in the pool' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(onDone).toHaveBeenCalledWith('Members of pool team updated'))
    expect(puts).toEqual([
      { connId: 'c-prod', body: { poolid: 'team', vms: [102], storage: ['nfs'], allowMove: true } },
      { connId: 'c-prod', body: { poolid: 'team', vms: [101], delete: true } },
    ])
    expect(onClose).toHaveBeenCalled()
  })

  it('undoes a removal before saving', async () => {
    setup()
    open({ poolid: 'team', owners: [PROD] })

    await screen.findByText('web')
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove from the pool' })[0])
    fireEvent.click(screen.getByRole('button', { name: 'Keep in the pool' }))
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('reads the other cluster when the pool name exists on two', async () => {
    setup()
    open({ poolid: 'team', owners: [PROD, DR] })

    await screen.findByText('web')
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Cluster' }))
    fireEvent.click(within(screen.getByRole('listbox')).getByText('PVE-DR'))

    expect(await screen.findByText('local')).toBeInTheDocument()
    expect(screen.getByText('No guest in this pool')).toBeInTheDocument()
  })

  it.each([
    ['POOL_OWNED_BY_VDC', 'This pool belongs to a vDC: its members are managed by the vDC.'],
    ['GUEST_IN_VDC_POOL', 'A selected guest belongs to a vDC pool and cannot be moved from here.'],
    [undefined, 'nope'],
  ])('shows the refusal %s and stops after it', async (code, message) => {
    const puts = setup(() => HttpResponse.json({ error: 'nope', code }, { status: 409 }))
    const { onDone } = open({ poolid: 'team', owners: [PROD] })

    await screen.findByText('web')
    await pick('Add storages', /nfs/)
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove from the pool' })[0])
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(puts).toHaveLength(1)
    expect(onDone).not.toHaveBeenCalled()
  })

  it('shows a members read failure', async () => {
    setup(undefined, () => HttpResponse.json({ error: 'Pool not found' }, { status: 404 }))
    open({ poolid: 'team', owners: [PROD] })

    expect(await screen.findByText('Pool not found')).toBeInTheDocument()
  })
})
