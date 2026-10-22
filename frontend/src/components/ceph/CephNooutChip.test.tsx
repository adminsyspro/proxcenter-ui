import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen, fireEvent, waitFor, within } from '@/__tests__/setup/renderWithProviders'
import { useCephNoout } from '@/hooks/useCephNoout'

import CephNooutChip from './CephNooutChip'

/*
   ui#1164: the node header chip. Shown while the host flag is set, removed
   from its delete icon; an OSD still down keeps the flag and opens the force
   dialog.
*/

const toast = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => toast }))

const FLAGGED = {
  hasCeph: true, crushHost: 'pve3', osds: [{ id: 2, status: 'up', in: true }, { id: 5, status: 'down', in: true }],
  noout: true, globalNoout: false, health: { status: 'HEALTH_WARN', checks: [] }, otherHostsWithNoout: [],
}

const fetchMock = vi.fn()
const json = (data: unknown, status = 200) => ({ ok: status < 400, status, json: async () => data })
const deletes = () => fetchMock.mock.calls.filter(([, init]) => init?.method === 'DELETE').map(([url]) => String(url))

function Harness({ canManage = true, inline = false }: Readonly<{ canManage?: boolean; inline?: boolean }>) {
  const state = useCephNoout({ connId: 'c1', node: 'pve3', open: true, mode: 'exit' })
  return (
    <>
      <CephNooutChip state={state} canManage={canManage} inline={inline} />
      <span data-testid="loading">{String(state.loading)}</span>
    </>
  )
}

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockResolvedValue(json({ data: FLAGGED }))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

const removeNoout = () => screen.getByRole('button', { name: 'Remove noout from pve3' })

describe('CephNooutChip', () => {
  it('renders nothing while the host has no flag', async () => {
    fetchMock.mockResolvedValue(json({ data: { ...FLAGGED, noout: false, hostFlags: [] } }))
    renderWithProviders(<Harness />)
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'))
    expect(screen.queryByTestId('ceph-noout-chip')).toBeNull()
  })

  it('shows the Ceph logo and the host flag with its tooltip, without remove buttons for a viewer', async () => {
    renderWithProviders(<Harness canManage={false} />)
    const box = await screen.findByTestId('ceph-noout-chip')
    expect(box).toHaveTextContent('Ceph')
    expect(box.querySelector('img')).toHaveAttribute('src', '/images/ceph-logo.svg')
    expect(screen.getByLabelText('noout is set on CRUSH host pve3: Ceph keeps osd.2, osd.5 in while they are down. Remove it once the node is back.')).toBeInTheDocument()
    expect(screen.getByTestId('ceph-host-flags')).toHaveTextContent('noout')
    expect(screen.queryByRole('button', { name: 'Remove noout from pve3' })).toBeNull()
  })

  it('lists every flag of the host, noout first, and removes them all from one button', async () => {
    fetchMock.mockResolvedValue(json({ data: { ...FLAGGED, osds: [{ id: 2, status: 'up', in: true }], hostFlags: ['nodown', 'noup', 'noout', 'noin'] } }))
    renderWithProviders(<Harness inline />)
    await screen.findByTestId('ceph-noout-chip')
    expect(screen.getByTestId('ceph-host-flags')).toHaveTextContent('noout · noin · noup · nodown')

    fetchMock.mockReset()
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/ceph/flags') && String(init?.body).includes('"noup"')) return json({ error: 'nope' }, 500)
      return json({ success: true })
    })
    fireEvent.click(screen.getByRole('button', { name: 'Remove noout, noin, noup, nodown from pve3' }))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Ceph noout removed from pve3'))
    const removals = fetchMock.mock.calls.filter(([, init]) => init?.method === 'DELETE')
    // The others first, through the flags route, then noout through the maintenance route.
    expect(removals.map(([url, init]) => `${url} ${init?.body ?? ''}`)).toEqual([
      '/api/v1/connections/c1/ceph/flags {"flag":"noin","host":"pve3"}',
      '/api/v1/connections/c1/ceph/flags {"flag":"noup","host":"pve3"}',
      '/api/v1/connections/c1/ceph/flags {"flag":"nodown","host":"pve3"}',
      '/api/v1/connections/c1/nodes/pve3/ceph/noout ',
    ])
    expect(toast.success).toHaveBeenCalledWith('noin removed from pve3')
    expect(toast.error).toHaveBeenCalledWith('Ceph noout could not be removed: noup')
    expect(screen.getByTestId('ceph-host-flags')).toHaveTextContent('noup')
  })

  it('removes noout through the maintenance route and disappears', async () => {
    renderWithProviders(<Harness />)
    await screen.findByTestId('ceph-noout-chip')
    fetchMock.mockResolvedValueOnce(json({ success: true }))
    fireEvent.click(removeNoout())
    await waitFor(() => expect(screen.queryByTestId('ceph-noout-chip')).toBeNull())
    expect(deletes()).toEqual(['/api/v1/connections/c1/nodes/pve3/ceph/noout'])
    expect(toast.success).toHaveBeenCalledWith('Ceph noout removed from pve3')
  })

  it('keeps noout on osds_down and offers to remove it anyway, which forces', async () => {
    renderWithProviders(<Harness />)
    await screen.findByTestId('ceph-noout-chip')
    fetchMock.mockResolvedValueOnce(json({ error: 'osd.5 of this node are not up yet: noout kept', code: 'osds_down', osds: [5] }, 409))
    fireEvent.click(removeNoout())

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('Remove Ceph noout from pve3')
    expect(dialog).toHaveTextContent('osd.5 is not up yet.')
    expect(screen.getByTestId('ceph-noout-chip')).toBeInTheDocument()

    // Cancel keeps everything as it is.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(deletes()).toEqual(['/api/v1/connections/c1/nodes/pve3/ceph/noout'])

    fetchMock.mockResolvedValueOnce(json({ error: 'kept', code: 'osds_down', osds: [5] }, 409))
    fireEvent.click(removeNoout())
    const again = await screen.findByRole('dialog')
    fetchMock.mockResolvedValueOnce(json({ success: true }))
    fireEvent.click(within(again).getByRole('button', { name: 'Remove anyway' }))
    await waitFor(() => expect(screen.queryByTestId('ceph-noout-chip')).toBeNull())
    expect(deletes().at(-1)).toBe('/api/v1/connections/c1/nodes/pve3/ceph/noout?force=1')
    expect(toast.success).toHaveBeenCalledWith('Ceph noout removed from pve3')
  })

  it('says why when the removal fails for another reason, and keeps the flag', async () => {
    renderWithProviders(<Harness />)
    await screen.findByTestId('ceph-noout-chip')
    fetchMock.mockResolvedValueOnce(json({ error: 'This cluster is outside the license' }, 403))
    fireEvent.click(removeNoout())
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Ceph noout could not be removed: This cluster is outside the license'))
    expect(screen.getByTestId('ceph-noout-chip')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
