/**
 * Preflight panel: one line per check with its verdict, the fix that opens the
 * deployment wizard, and the errors of GET /preflight (404, 502, 409 BUSY).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, within } from '@testing-library/react'

import { screen, fireEvent, renderWithProviders, waitFor } from '@/__tests__/setup/renderWithProviders'
import type { PreflightCheck } from '@/lib/microseg/types'

import { calls, mock, reply, resetMocks } from './microsegTestKit'
import PreflightPanel from './PreflightPanel'

beforeEach(resetMocks)
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const CHECKS: PreflightCheck[] = [
  { id: 'cluster_firewall', status: 'fail', fix: 'enable_cluster_firewall' },
  { id: 'socle_rules', status: 'fail', fix: 'socle', detail: { web: true, ssh: false } },
  { id: 'log_ratelimit', status: 'warn', detail: { rate: '1/second' } },
  { id: 'self_in_zone', status: 'pass', detail: { self_ip: 'unknown' } },
]

function open(onOpenWizard: (() => void) | null = vi.fn(), onClose = vi.fn()) {
  renderWithProviders(<PreflightPanel open connectionId='c1' onClose={onClose} onOpenWizard={onOpenWizard ?? undefined} />)
  return { onOpenWizard, onClose }
}

describe('checks', () => {
  it('shows one line per check with its verdict and its values', async () => {
    mock.routes['GET /preflight'] = () => reply(200, { checks: CHECKS })
    open()

    const firewall = await screen.findByRole('listitem', { name: 'Cluster firewall: failed' })
    expect(within(firewall).getByText(/cluster firewall is off/i)).toBeTruthy()
    const socle = screen.getByRole('listitem', { name: 'Management access: failed' })
    expect(within(socle).getByText(/22/)).toBeTruthy()
    expect(within(socle).queryByText(/8006/)).toBeNull()
    const rate = screen.getByRole('listitem', { name: 'Log rate limit: warning' })
    expect(within(rate).getByText(/1\/second/)).toBeTruthy()
    const self = screen.getByRole('listitem', { name: 'ProxCenter address: passed' })
    expect(within(self).getByText(/could not be detected/i)).toBeTruthy()
    expect(screen.getAllByRole('listitem')).toHaveLength(4)
  })

  it('says where ProxCenter sits when it is inside an active zone', async () => {
    mock.routes['GET /preflight'] = () => reply(200, {
      checks: [{ id: 'self_in_zone', status: 'warn', detail: { zone: 'web', self_ip: '10.0.0.5' } }],
    })
    open()
    const line = await screen.findByRole('listitem', { name: 'ProxCenter address: warning' })
    expect(within(line).getByText(/10\.0\.0\.5/)).toBeTruthy()
    expect(within(line).getByText(/web/)).toBeTruthy()
  })

  it('shows what PVE answered when a check could not read its source', async () => {
    mock.routes['GET /preflight'] = () => reply(200, {
      checks: [{ id: 'cluster_firewall', status: 'fail', detail: { error: 'connection refused' } }],
    })
    open()
    const line = await screen.findByRole('listitem', { name: 'Cluster firewall: failed' })
    expect(within(line).getByText(/connection refused/)).toBeTruthy()
    expect(within(line).queryByRole('button')).toBeNull()
  })

  it('names a check of a newer version by its id', async () => {
    mock.routes['GET /preflight'] = () => reply(200, { checks: [{ id: 'future_check', status: 'warn' }] })
    open()
    expect(await screen.findByRole('listitem', { name: 'future_check: warning' })).toBeTruthy()
  })
})

describe('fixes', () => {
  it('opens the deployment wizard from a failed socle check', async () => {
    mock.routes['GET /preflight'] = () => reply(200, { checks: CHECKS })
    const { onOpenWizard } = open()

    const socle = await screen.findByRole('listitem', { name: 'Management access: failed' })
    fireEvent.click(within(socle).getByRole('button', { name: 'Open the deployment wizard' }))
    expect(onOpenWizard).toHaveBeenCalledTimes(1)
  })

  it('explains the cluster firewall fix and points to the same wizard, which turns it on', async () => {
    mock.routes['GET /preflight'] = () => reply(200, { checks: CHECKS })
    const { onOpenWizard } = open()

    const firewall = await screen.findByRole('listitem', { name: 'Cluster firewall: failed' })
    expect(within(firewall).getByText(/wizard.*turns it on/i)).toBeTruthy()
    fireEvent.click(within(firewall).getByRole('button', { name: 'Open the deployment wizard' }))
    expect(onOpenWizard).toHaveBeenCalledTimes(1)
  })

  it('offers no wizard button where the wizard is not available', async () => {
    mock.routes['GET /preflight'] = () => reply(200, { checks: CHECKS })
    open(null)
    await screen.findByRole('listitem', { name: 'Management access: failed' })
    expect(screen.queryByRole('button', { name: 'Open the deployment wizard' })).toBeNull()
  })

  it('offers no fix for a passing check', async () => {
    mock.routes['GET /preflight'] = () => reply(200, { checks: [{ id: 'socle_rules', status: 'pass' }] })
    open()
    await screen.findByRole('listitem', { name: 'Management access: passed' })
    expect(screen.queryByRole('button', { name: 'Open the deployment wizard' })).toBeNull()
  })
})

describe('errors', () => {
  it('tells an apply is running on 409 BUSY and checks again on request', async () => {
    let busy = true
    mock.routes['GET /preflight'] = () => (busy
      ? reply(409, { code: 'BUSY', error: 'busy' })
      : reply(200, { checks: [{ id: 'socle_rules', status: 'pass' }] }))
    open()

    expect(await screen.findByText('An apply is running, retry in a moment.')).toBeTruthy()
    expect(screen.queryByRole('listitem')).toBeNull()

    busy = false
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('listitem', { name: 'Management access: passed' })).toBeTruthy()
    expect(screen.queryByText('An apply is running, retry in a moment.')).toBeNull()
    expect(calls('GET /preflight')).toHaveLength(2)
  })

  it('says there is no Proxmox client on 404', async () => {
    mock.routes['GET /preflight'] = () => reply(404, { code: 'NOT_FOUND', error: 'no client' })
    open()
    expect(await screen.findByText(/no Proxmox client/i)).toBeTruthy()
  })

  it('shows the Proxmox error message on 502', async () => {
    mock.routes['GET /preflight'] = () => reply(502, { code: 'PVE_ERROR', error: 'pve down' })
    open()
    expect(await screen.findByText('Proxmox returned an error.')).toBeTruthy()
  })

  it('checks again from the Run again button', async () => {
    mock.routes['GET /preflight'] = () => reply(200, { checks: CHECKS })
    open()
    await screen.findByRole('listitem', { name: 'Management access: failed' })
    fireEvent.click(screen.getByRole('button', { name: 'Run again' }))
    await waitFor(() => expect(calls('GET /preflight')).toHaveLength(2))
  })

  it('closes from the Close button', async () => {
    mock.routes['GET /preflight'] = () => reply(200, { checks: CHECKS })
    const { onClose } = open()
    await screen.findByRole('listitem', { name: 'Management access: failed' })
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalled()
  })
})
