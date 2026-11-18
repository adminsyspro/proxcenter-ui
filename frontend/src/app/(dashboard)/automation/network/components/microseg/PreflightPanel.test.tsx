/**
 * Preflight panel: one line per check with its verdict, the fix that opens the
 * deployment wizard, and the errors of GET /preflight (404, 502, 409 BUSY).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, within } from '@testing-library/react'

import { screen, fireEvent, renderWithProviders, waitFor } from '@/__tests__/setup/renderWithProviders'
import { MicrosegApiError } from '@/lib/microseg/api'
import type { PreflightCheck } from '@/lib/microseg/types'

import { calls, mock, reply, resetMocks } from './microsegTestKit'
import PreflightPanel from './PreflightPanel'
import { RECOMMENDED_OBSERVE_LOG_RATE } from './preflightModel'

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

describe('the firewall service check', () => {
  it('has its row after the cluster firewall: running, stopped on nodes, or unreadable on nodes', async () => {
    mock.routes['GET /preflight'] = () => reply(200, {
      checks: [
        { id: 'cluster_firewall', status: 'pass' },
        { id: 'firewall_service', status: 'fail', detail: { nodes: ['pve1', 'pve2'] } },
        { id: 'firewall_service', status: 'warn', detail: { unreadable: ['pve3'] } },
        { id: 'firewall_service', status: 'pass' },
      ],
    })
    open()
    const stopped = await screen.findByRole('listitem', { name: 'Firewall service: failed' })
    expect(within(stopped).getByText('The firewall service is stopped on pve1, pve2: nothing is filtered on these nodes.')).toBeTruthy()
    const unreadable = screen.getByRole('listitem', { name: 'Firewall service: warning' })
    expect(within(unreadable).getByText('The state of the firewall service could not be read on pve3.')).toBeTruthy()
    const running = screen.getByRole('listitem', { name: 'Firewall service: passed' })
    expect(within(running).getByText('The firewall service is running on every node.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /wizard/i })).toBeNull()
  })
})

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
    expect(within(rate).getByText(/1 per second/)).toBeTruthy()
    const self = screen.getByRole('listitem', { name: 'ProxCenter address: passed' })
    expect(within(self).getByText(/could not be detected/i)).toBeTruthy()
    expect(screen.getAllByRole('listitem')).toHaveLength(4)
  })

  it('says the rate limit with a translated unit, and keeps a wording it does not know as PVE wrote it', async () => {
    mock.routes['GET /preflight'] = () => reply(200, {
      checks: [
        { id: 'log_ratelimit', status: 'pass', detail: { rate: '20/minute' } },
        { id: 'log_ratelimit', status: 'warn', detail: { rate: '5/fortnight' } },
      ],
    })
    open()
    expect(await screen.findByText('PVE logs up to 20 per minute.')).toBeTruthy()
    expect(screen.getByText(/default rate \(5\/fortnight\)/)).toBeTruthy()
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

  it('sends to Settings > Advanced when the detected address is internal to Docker', async () => {
    mock.routes['GET /preflight'] = () => reply(200, {
      checks: [{ id: 'self_in_zone', status: 'warn', detail: { self_ip: '172.17.0.3', reason: 'docker_internal' } }],
    })
    open()
    const line = await screen.findByRole('listitem', { name: 'ProxCenter address: warning' })
    expect(within(line).getByText('The detected address is internal to Docker: in Settings > Advanced, enter the address of the host as Proxmox sees it.')).toBeTruthy()
  })

  it('sends to Settings > Advanced when the socle fails on a Docker internal address', async () => {
    mock.routes['GET /preflight'] = () => reply(200, {
      checks: [{ id: 'socle_rules', status: 'fail', fix: 'socle', detail: { web: false, ssh: false, reason: 'docker_internal', self_ip: '172.17.0.3' } }],
    })
    open()
    const line = await screen.findByRole('listitem', { name: 'Management access: failed' })
    expect(within(line).getByText(/the detected address is internal to Docker, in Settings > Advanced enter the address of the host/)).toBeTruthy()
  })

  it('names the security group whose rules could not be read', async () => {
    mock.routes['GET /preflight'] = () => reply(200, {
      checks: [{ id: 'socle_rules', status: 'fail', fix: 'socle', detail: { web: false, ssh: false, reason: 'group_unreadable', group: 'sg-gone' } }],
    })
    open()
    const line = await screen.findByRole('listitem', { name: 'Management access: failed' })
    expect(within(line).getByText('The rules of the security group sg-gone could not be read: the management access cannot be checked.')).toBeTruthy()
  })

  it('says every reason of a socle failure on its line', async () => {
    mock.routes['GET /preflight'] = () => reply(200, {
      checks: [{ id: 'socle_rules', status: 'fail', fix: 'socle', detail: {
        web: false, ssh: false, reason: 'host_rules_unreadable',
        reasons: [{ reason: 'host_rules_unreadable', node: 'pve2' }, { reason: 'group_unreadable', group: 'sg-gone' }],
        uncovered: ['10.0.0.1'], uncovered_nodes: ['pve1', 'pve2'],
      } }],
    })
    open()
    const line = await screen.findByRole('listitem', { name: 'Management access: failed' })
    expect(within(line).getByText('The firewall rules of node pve2 could not be read: the management access cannot be checked. ' +
      'The rules of the security group sg-gone could not be read: the management access cannot be checked. ' +
      'No rule keeps port 8006, 22 open from 10.0.0.1 on pve1: turning the firewall on could cut ProxCenter off.')).toBeTruthy()
  })

  it('names the address the socle rules do not accept', async () => {
    mock.routes['GET /preflight'] = () => reply(200, {
      checks: [{ id: 'socle_rules', status: 'fail', fix: 'socle', detail: { web: true, ssh: false, uncovered: ['192.168.5.1'] } }],
    })
    open()
    const line = await screen.findByRole('listitem', { name: 'Management access: failed' })
    expect(within(line).getByText('No rule keeps port 22 open from 192.168.5.1: turning the firewall on could cut ProxCenter off.')).toBeTruthy()
  })

  it('warns, with the count in the right plural, when members could not be checked', async () => {
    mock.routes['GET /preflight'] = () => reply(200, {
      checks: [{ id: 'self_in_zone', status: 'warn', detail: { unchecked: 1, reason: 'collect_cap' } }],
    })
    open()
    const line = await screen.findByRole('listitem', { name: 'ProxCenter address: warning' })
    expect(within(line).getByText(/1 member could not be checked \(more than the collection cap\)/)).toBeTruthy()
  })

  it('says the collection was cut short for several members', async () => {
    mock.routes['GET /preflight'] = () => reply(200, {
      checks: [{ id: 'self_in_zone', status: 'warn', detail: { unchecked: 4, reason: 'collect_timeout' } }],
    })
    open()
    const line = await screen.findByRole('listitem', { name: 'ProxCenter address: warning' })
    expect(within(line).getByText(/4 members could not be checked \(collection cut short\)/)).toBeTruthy()
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
  it('offers no wizard on a failed socle check: the wizard writes nothing on the nodes', async () => {
    mock.routes['GET /preflight'] = () => reply(200, { checks: CHECKS })
    open()

    const socle = await screen.findByRole('listitem', { name: 'Management access: failed' })
    expect(within(socle).queryByRole('button', { name: 'Open the deployment wizard' })).toBeNull()
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
  it('raises the log rate from the check: one click sets the rate of the settings, nothing is written to Proxmox', async () => {
    mock.routes['GET /preflight'] = () => reply(200, { checks: CHECKS })
    const onRaise = vi.fn(async () => {})
    renderWithProviders(<PreflightPanel open connectionId='c1' onClose={vi.fn()} rateLimit={{ observe: '', onRaise }} />)

    const row = await screen.findByRole('listitem', { name: 'Log rate limit: warning' })
    expect(row.textContent).toContain('PVE logs at its default rate (1 per second), so the observation misses flows.')
    fireEvent.click(within(row).getByRole('button', { name: 'Raise while observing' }))
    await waitFor(() => expect(onRaise).toHaveBeenCalledTimes(1))
  })

  it('says the rate the engine raises the log to once the settings hold one, with no button', async () => {
    mock.routes['GET /preflight'] = () => reply(200, { checks: CHECKS })
    renderWithProviders(<PreflightPanel open connectionId='c1' onClose={vi.fn()} rateLimit={{ observe: RECOMMENDED_OBSERVE_LOG_RATE, onRaise: vi.fn() }} />)

    const row = await screen.findByRole('listitem', { name: 'Log rate limit: warning' })
    expect(row.textContent).toContain('Raised to 20 per second while a zone is observed, then set back (settings).')
    expect(within(row).queryByRole('button', { name: 'Raise while observing' })).toBeNull()
  })

  it('shows why the rate could not be set, and keeps the button', async () => {
    mock.routes['GET /preflight'] = () => reply(200, { checks: CHECKS })
    const onRaise = vi.fn(async () => { throw new MicrosegApiError(409, 'VERSION_CONFLICT', 'x') })
    renderWithProviders(<PreflightPanel open connectionId='c1' onClose={vi.fn()} rateLimit={{ observe: '', onRaise }} />)

    const row = await screen.findByRole('listitem', { name: 'Log rate limit: warning' })
    fireEvent.click(within(row).getByRole('button', { name: 'Raise while observing' }))
    await waitFor(() => expect(within(row).getByRole('button', { name: 'Raise while observing' })).not.toBeDisabled())
    expect(onRaise).toHaveBeenCalledTimes(1)
    expect(row.querySelector('.MuiTypography-caption')?.textContent).toBeTruthy()
  })

  it('tells the engine is busy on the cluster (a pass or an apply) on 409 BUSY and checks again on request', async () => {
    let busy = true
    mock.routes['GET /preflight'] = () => (busy
      ? reply(409, { code: 'BUSY', error: 'busy' })
      : reply(200, { checks: [{ id: 'socle_rules', status: 'pass' }] }))
    open()

    expect(await screen.findByText('The engine is finishing a pass or an apply on this cluster, retry in a moment.')).toBeTruthy()
    expect(screen.queryByRole('listitem')).toBeNull()

    busy = false
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('listitem', { name: 'Management access: passed' })).toBeTruthy()
    expect(screen.queryByText('The engine is finishing a pass or an apply on this cluster, retry in a moment.')).toBeNull()
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
