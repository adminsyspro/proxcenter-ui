/**
 * Component tests for PoolDialog: the request each mode sends, the cluster
 * choice for a same-named pool, and how a refusal is surfaced.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { renderWithProviders, screen, waitFor, fireEvent } from '@/__tests__/setup/renderWithProviders'
import { server, http, HttpResponse } from '@/__tests__/setup/msw-server'

import PoolDialog, { type PoolDialogState } from './PoolDialog'

afterEach(() => {
  cleanup()
})

const PROD = { connId: 'c-prod', connName: 'PVE-PROD', comment: 'prod comment' }
const DR = { connId: 'c-dr', connName: 'PVE-DR', comment: 'dr comment' }

function capture(method: 'post' | 'put' | 'delete', reply: () => Response = () => HttpResponse.json({ data: {} })) {
  const calls: { connId: string; url: string; body: any }[] = []

  server.use(http[method]('*/api/v1/connections/:id/pools', async ({ request, params }) => {
    calls.push({ connId: String(params.id), url: request.url, body: method === 'delete' ? null : await request.json() })

    return reply()
  }))

  return calls
}

function open(state: PoolDialogState) {
  const onClose = vi.fn()
  const onDone = vi.fn()

  renderWithProviders(<PoolDialog state={state} onClose={onClose} onDone={onDone} />)

  return { onClose, onDone }
}

const submit = (name: string) => fireEvent.click(screen.getByRole('button', { name }))

describe('PoolDialog', () => {
  it('renders nothing without a state', () => {
    open(null)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('creates a pool on the only cluster, without asking which one', async () => {
    const calls = capture('post')
    const { onDone, onClose } = open({ mode: 'create', clusters: [PROD] })

    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Pool ID'), { target: { value: 'team' } })
    fireEvent.change(screen.getByLabelText('Comment'), { target: { value: 'the team' } })
    submit('Create')

    await waitFor(() => expect(onDone).toHaveBeenCalledWith('Pool team created'))
    expect(calls).toEqual([{ connId: 'c-prod', url: expect.any(String), body: { poolid: 'team', comment: 'the team' } }])
    expect(onClose).toHaveBeenCalled()
  })

  it('keeps Create disabled until the id is one Proxmox accepts', () => {
    open({ mode: 'create', clusters: [PROD] })
    const create = screen.getByRole('button', { name: 'Create' })

    expect(create).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Pool ID'), { target: { value: '1abc' } })
    expect(create).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Pool ID'), { target: { value: 'abc' } })
    expect(create).toBeEnabled()
  })

  it('prefills a sub-pool id with its parent', () => {
    open({ mode: 'create', clusters: [PROD], parent: 'team' })
    expect(screen.getByLabelText('Pool ID')).toHaveValue('team/')
  })

  it('edits the comment of the cluster picked for a same-named pool', async () => {
    const calls = capture('put')
    const { onDone } = open({ mode: 'edit', poolid: 'shared', owners: [PROD, DR] })

    expect(screen.getByLabelText('Comment')).toHaveValue('prod comment')
    fireEvent.mouseDown(screen.getByRole('combobox'))
    fireEvent.click(await screen.findByRole('option', { name: /PVE-DR/ }))
    expect(screen.getByLabelText('Comment')).toHaveValue('dr comment')

    fireEvent.change(screen.getByLabelText('Comment'), { target: { value: '' } })
    submit('Save')

    await waitFor(() => expect(onDone).toHaveBeenCalledWith('Pool shared updated'))
    expect(calls).toEqual([{ connId: 'c-dr', url: expect.any(String), body: { poolid: 'shared', comment: '' } }])
  })

  it('deletes with the pool id as a query parameter', async () => {
    const calls = capture('delete')
    const { onDone } = open({ mode: 'delete', poolid: 'team/dev', owners: [PROD] })

    expect(screen.getByText(/Proxmox refuses to delete a pool/)).toBeInTheDocument()
    submit('Delete')

    await waitFor(() => expect(onDone).toHaveBeenCalledWith('Pool team/dev deleted'))
    expect(new URL(calls[0].url).searchParams.get('poolid')).toBe('team/dev')
  })

  it("shows Proxmox's refusal and stays open", async () => {
    capture('delete', () => HttpResponse.json({ error: "pool 'team' is not empty" }, { status: 500 }))
    const { onDone, onClose } = open({ mode: 'delete', poolid: 'team', owners: [PROD] })

    submit('Delete')

    expect(await screen.findByText("pool 'team' is not empty")).toBeInTheDocument()
    expect(onDone).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeEnabled()
  })

  it('names the vDC that owns the pool', async () => {
    capture('delete', () => HttpResponse.json({ error: 'Pool belongs to a vDC', code: 'POOL_OWNED_BY_VDC', vdc: 'Acme' }, { status: 409 }))
    open({ mode: 'delete', poolid: 'vdc-acme', owners: [PROD] })

    submit('Delete')

    expect(await screen.findByText(/belongs to the vDC Acme/)).toBeInTheDocument()
  })

  it('falls back to the HTTP status when the error has no body', async () => {
    capture('post', () => new HttpResponse('boom', { status: 502 }))
    open({ mode: 'create', clusters: [PROD] })

    fireEvent.change(screen.getByLabelText('Pool ID'), { target: { value: 'team' } })
    submit('Create')

    expect(await screen.findByText('HTTP 502')).toBeInTheDocument()
  })

  it('reports a network failure', async () => {
    server.use(http.put('*/api/v1/connections/:id/pools', () => HttpResponse.error()))
    open({ mode: 'edit', poolid: 'team', owners: [PROD] })

    submit('Save')

    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })
})
