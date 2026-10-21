import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen, fireEvent, waitFor } from '@/__tests__/setup/renderWithProviders'
import { useCephNoout, type CephNooutMode } from '@/hooks/useCephNoout'

import CephNooutOption from './CephNooutOption'

/*
   ui#1164: the block every maintenance dialog renders. Driven through the
   real hook so what the operator sees follows what the route answered.
*/

const toast = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => toast }))

const BASE = {
  hasCeph: true, crushHost: 'pve3', osds: [{ id: 2, status: 'up', in: true }, { id: 5, status: 'up', in: true }],
  noout: false, globalNoout: false, health: { status: 'HEALTH_OK', checks: [] as { code: string; severity: string; message: string }[] },
  otherHostsWithNoout: [] as string[], okToStop: { ok: true, osds: [2, 5], numOkPgs: 6, numNotOkPgs: 0, message: null as string | null },
}

const fetchMock = vi.fn()

function Harness({ mode, disabled }: Readonly<{ mode: CephNooutMode; disabled?: boolean }>) {
  const state = useCephNoout({ connId: 'c1', node: 'pve3', open: true, mode })
  return (
    <>
      <CephNooutOption state={state} disabled={disabled} />
      <span data-testid="blocked">{String(state.blocked)}</span>
      <span data-testid="active">{String(state.active)}</span>
      <span data-testid="loading">{String(state.loading)}</span>
    </>
  )
}

function answer(data: unknown) {
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ data }) })
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const loaded = () => waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'))

describe('CephNooutOption', () => {
  it('renders nothing without Ceph, without an OSD on the node, or on a demo payload', async () => {
    answer({ hasCeph: false })
    const { unmount } = renderWithProviders(<Harness mode="enter" />)
    await loaded()
    expect(screen.queryByTestId('ceph-noout-option')).toBeNull()
    unmount()

    answer({ ...BASE, crushHost: null, osds: [] })
    const second = renderWithProviders(<Harness mode="enter" />)
    await loaded()
    expect(screen.queryByTestId('ceph-noout-option')).toBeNull()
    second.unmount()

    answer([])
    renderWithProviders(<Harness mode="enter" />)
    await loaded()
    expect(screen.queryByTestId('ceph-noout-option')).toBeNull()
  })

  it('entering: the checkbox is on by default, names the host and the OSDs, and stays quiet on a clean cluster', async () => {
    answer(BASE)
    renderWithProviders(<Harness mode="enter" />)
    await screen.findByTestId('ceph-noout-option')

    const box = screen.getByRole('checkbox', { name: "Set Ceph noout on this node's OSDs (2)" })
    expect(box).toBeChecked()
    expect(screen.getByText(/ceph osd set-group noout pve3: Ceph keeps osd\.2, osd\.5 in/)).toBeInTheDocument()
    expect(screen.queryByTestId('ceph-noout-health')).toBeNull()
    expect(screen.queryByTestId('ceph-noout-other-hosts')).toBeNull()
    expect(screen.queryByTestId('ceph-noout-unsafe')).toBeNull()
    expect(screen.queryByTestId('ceph-noout-global')).toBeNull()
    expect(screen.getByTestId('active')).toHaveTextContent('true')
    expect(screen.getByTestId('blocked')).toHaveTextContent('false')

    fireEvent.click(box)
    expect(screen.getByTestId('active')).toHaveTextContent('false')
  })

  it('entering: shows the health, the other flagged hosts and the global flag, hidden once unchecked', async () => {
    answer({
      ...BASE,
      globalNoout: true,
      health: { status: 'HEALTH_WARN', checks: [{ code: 'MON_DISK_LOW', severity: 'HEALTH_WARN', message: 'mon pve1 is low on available space' }] },
      otherHostsWithNoout: ['pve1'],
    })
    renderWithProviders(<Harness mode="enter" />)
    await screen.findByTestId('ceph-noout-option')

    expect(screen.getByTestId('ceph-noout-health')).toHaveTextContent('Ceph health is HEALTH_WARN')
    expect(screen.getByTestId('ceph-noout-health')).toHaveTextContent('MON_DISK_LOW: mon pve1 is low on available space')
    expect(screen.getByTestId('ceph-noout-other-hosts')).toHaveTextContent('noout is already set on other hosts: pve1.')
    expect(screen.getByTestId('ceph-noout-global')).toBeInTheDocument()
    // The health is a warning, not a block.
    expect(screen.getByTestId('blocked')).toHaveTextContent('false')

    fireEvent.click(screen.getByRole('checkbox', { name: /Set Ceph noout/ }))
    expect(screen.queryByTestId('ceph-noout-health')).toBeNull()
    expect(screen.queryByTestId('ceph-noout-other-hosts')).toBeNull()
    expect(screen.queryByTestId('ceph-noout-global')).toBeNull()
  })

  it('entering: an unsafe verdict blocks until the explicit acknowledgement, with HEALTH_ERR as an error', async () => {
    answer({
      ...BASE,
      health: { status: 'HEALTH_ERR', checks: [] },
      okToStop: { ok: false, osds: [2, 5], numOkPgs: 0, numNotOkPgs: 33, message: null },
    })
    renderWithProviders(<Harness mode="enter" />)
    await screen.findByTestId('ceph-noout-unsafe')

    expect(screen.getByTestId('ceph-noout-unsafe')).toHaveTextContent('Stopping the OSDs of this node is not safe right now')
    expect(screen.getByTestId('ceph-noout-unsafe')).toHaveTextContent('33 placement group(s) that would go offline')
    expect(screen.getByTestId('ceph-noout-health')).toHaveClass('MuiAlert-standardError')
    expect(screen.getByTestId('blocked')).toHaveTextContent('true')

    fireEvent.click(screen.getByRole('checkbox', { name: 'I understand, proceed anyway' }))
    expect(screen.getByTestId('blocked')).toHaveTextContent('false')
  })

  it('entering: says when the precheck could not run, and a disabled option takes no click', async () => {
    answer({ ...BASE, okToStop: { ok: false, osds: [2, 5], numOkPgs: 0, numNotOkPgs: 0, message: 'ssh: connect refused' } })
    renderWithProviders(<Harness mode="enter" disabled />)
    await screen.findByTestId('ceph-noout-unsafe')
    expect(screen.getByTestId('ceph-noout-unsafe')).toHaveTextContent('ceph osd ok-to-stop could not be evaluated: ssh: connect refused')
    expect(screen.getByRole('checkbox', { name: /Set Ceph noout/ })).toBeDisabled()
    expect(screen.getByRole('checkbox', { name: 'I understand, proceed anyway' })).toBeDisabled()
  })

  it('leaving: offers the removal only while the host flag is set, and names the OSDs still down', async () => {
    answer({ ...BASE, okToStop: undefined })
    const { unmount } = renderWithProviders(<Harness mode="exit" />)
    await loaded()
    expect(screen.queryByTestId('ceph-noout-option')).toBeNull()
    unmount()

    answer({ ...BASE, noout: true, okToStop: undefined, osds: [{ id: 2, status: 'up', in: true }, { id: 5, status: 'down', in: true }] })
    renderWithProviders(<Harness mode="exit" />)
    await screen.findByTestId('ceph-noout-option')
    const box = screen.getByRole('checkbox', { name: "Remove Ceph noout from this node's OSDs (2)" })
    expect(box).toBeChecked()
    expect(screen.getByText(/ceph osd unset-group noout pve3/)).toBeInTheDocument()
    expect(screen.getByTestId('ceph-noout-osds-down')).toHaveTextContent('osd.5 is not up yet')
    expect(screen.queryByTestId('ceph-noout-unsafe')).toBeNull()

    fireEvent.click(box)
    expect(screen.queryByTestId('ceph-noout-osds-down')).toBeNull()
    expect(screen.getByTestId('active')).toHaveTextContent('false')
  })
})
