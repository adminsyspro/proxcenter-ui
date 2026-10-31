/**
 * DatacenterDialog save flow: the datacenter row (POST or PUT) then its
 * assignments (PUT). A failed second step must not turn the retry into a
 * second POST, and closing the dialog after it must still refresh the list.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen, fireEvent, waitFor } from '@/__tests__/setup/renderWithProviders'
import DatacenterDialog from './DatacenterDialog'

function jsonRes(body: any, status = 200) {
  return { ok: status < 400, status, json: async () => body } as Response
}

let fetchMock: ReturnType<typeof vi.fn>
let failAssignments = 0

const writes = () =>
  fetchMock.mock.calls
    .filter(c => c[1]?.method && c[1].method !== 'GET')
    .map(c => `${c[1].method} ${String(c[0])}`)

beforeEach(() => {
  failAssignments = 0
  fetchMock = vi.fn(async (input: any, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method || 'GET'

    if (url === '/api/v1/admin/datacenters' && method === 'POST') {
      return jsonRes({ data: { id: 'dc-new', ...JSON.parse(String(init?.body)) } })
    }
    if (url === '/api/v1/admin/datacenters/dc-new' && method === 'PUT') {
      return jsonRes({ data: { id: 'dc-new', ...JSON.parse(String(init?.body)) } })
    }
    if (url.endsWith('/assignments') && method === 'PUT') {
      if (failAssignments > 0) {
        failAssignments--

        return jsonRes({ error: 'assignments refused' }, 500)
      }

      return jsonRes({ data: {} })
    }
    if (url === '/api/v1/connections?type=pve') return jsonRes({ data: [] })
    if (url === '/api/v1/admin/green-assignments') return jsonRes({ data: { clusters: {}, nodes: {} } })

    return jsonRes({ data: {} })
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function renderNew() {
  const onSaved = vi.fn()
  const onClose = vi.fn()

  renderWithProviders(<DatacenterDialog open initial={null} onSaved={onSaved} onClose={onClose} />)
  fireEvent.change(screen.getByRole('textbox', { name: /name/i }), { target: { value: 'Paris DC' } })

  return { onSaved, onClose, save: () => fireEvent.click(screen.getByRole('button', { name: /save/i })) }
}

describe('DatacenterDialog save', () => {
  it('creates the row then its assignments, and closes', async () => {
    const { onSaved, onClose, save } = renderNew()

    save()

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(writes()).toEqual(['POST /api/v1/admin/datacenters', 'PUT /api/v1/admin/datacenters/dc-new/assignments'])
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: 'dc-new', name: 'Paris DC' }))
  })

  it('retries a failed assignments step on the row already created, never a second POST', async () => {
    failAssignments = 1
    const { onSaved, onClose, save } = renderNew()

    save()
    expect(await screen.findByText('assignments refused')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()

    save()

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(writes()).toEqual([
      'POST /api/v1/admin/datacenters',
      'PUT /api/v1/admin/datacenters/dc-new/assignments',
      'PUT /api/v1/admin/datacenters/dc-new',
      'PUT /api/v1/admin/datacenters/dc-new/assignments',
    ])
    expect(onSaved).toHaveBeenCalledTimes(1)
  })

  it('still reports the created row when the dialog is cancelled after a failed second step', async () => {
    failAssignments = 1
    const { onSaved, onClose, save } = renderNew()

    save()
    expect(await screen.findByText('assignments refused')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))

    expect(onClose).toHaveBeenCalled()
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: 'dc-new' }))
  })

  it('reports nothing on cancel when nothing was created', () => {
    const { onSaved, onClose } = renderNew()

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))

    expect(onClose).toHaveBeenCalled()
    expect(onSaved).not.toHaveBeenCalled()
  })
})
