import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { fireEvent, renderWithProviders, screen, waitFor } from '@/__tests__/setup/renderWithProviders'
import { http, HttpResponse, server } from '@/__tests__/setup/msw-server'

import RestoreDrillDialog from './RestoreDrillDialog'

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => toast }))

const BACKUP = {
  datastore: 'store1', namespace: 'prod', backupType: 'vm', backupId: '101', backupTime: 1_792_116_005,
  backupTimeIso: '2026-10-18T02:00:05Z', vmName: 'web01', size: 2 * 1024 ** 3, verified: true,
  verification: { state: 'ok', 'last-run': 1_792_119_600 },
}

const PREFLIGHT_OK = {
  ok: true, required_bytes: 32 * 1024 ** 3, temp_vmid: 9001,
  checks: [
    { key: 'archive_found', status: 'ok', detail: 'archive listed in pbs-prod' },
    { key: 'free_space', status: 'warn', detail: 'free space close to the margin' },
    { key: 'future_check', status: 'ok', detail: 'raw' },
  ],
}

let posted: Record<string, any[]>

function seed(overrides: { targets?: unknown[]; preflight?: unknown; create?: () => Response } = {}) {
  posted = { preflight: [], create: [] }
  server.use(
    http.get('*/api/v1/backups/restore-drills/settings', () => HttpResponse.json({
      max_concurrent: 1, capacity_budget_gb: 0, free_space_margin_pct: 10, restore_timeout_sec: 7200,
      boot_timeout_sec: 300, agent_timeout_sec: 120, default_network_mode: 'bridge', default_bridge: 'vmbr9',
    })),
    http.get('*/api/v1/pbs/pbs-1/pve-storages', () => HttpResponse.json({
      data: overrides.targets ?? [{ connId: 'c1', connName: 'PVE-PROD', storage: 'pbs-prod', nodes: ['pve2'] }],
    })),
    http.get('*/api/v1/connections/c1/nodes', () => HttpResponse.json({
      data: [{ node: 'pve1', status: 'online' }, { node: 'pve2', status: 'online' }, { node: 'pve3', status: 'offline' }],
    })),
    http.get('*/api/v1/connections/c1/nodes/pve2/storages', () => HttpResponse.json({
      data: [{ storage: 'local-lvm', avail: 100 * 1024 ** 3 }, { storage: 'off', active: 0 }],
    })),
    http.get('*/api/v1/connections/c1/nodes/pve2/network', () => HttpResponse.json({
      data: [{ iface: 'vmbr0', type: 'bridge' }, { iface: 'vmbr9', type: 'bridge' }, { iface: 'eno1', type: 'eth' }],
    })),
    http.post('*/api/v1/backups/restore-drills/preflight', async ({ request }) => {
      posted.preflight.push(await request.json())
      return HttpResponse.json(overrides.preflight ?? PREFLIGHT_OK)
    }),
    http.post('*/api/v1/backups/restore-drills', async ({ request }) => {
      posted.create.push(await request.json())
      return overrides.create ? overrides.create() : HttpResponse.json({ drill: { id: 'd1' } }, { status: 202 })
    }),
  )
}

beforeEach(() => {
  toast.success.mockReset()
  toast.error.mockReset()
})
afterEach(() => cleanup())

function open(onClose = vi.fn(), onStarted = vi.fn()) {
  renderWithProviders(<RestoreDrillDialog open onClose={onClose} pbsId='pbs-1' backup={BACKUP} onStarted={onStarted} />)
  return { onClose, onStarted }
}

const preflightButton = () => screen.getByRole('button', { name: 'Run preflight' })
const startButton = () => screen.getByRole('button', { name: 'Start drill' })

describe('RestoreDrillDialog', () => {
  it('prefills the target and settings, runs the preflight, then starts the drill', async () => {
    seed()
    const { onClose, onStarted } = open()
    expect(screen.getByText('Test restore of web01')).toBeInTheDocument()
    expect(screen.getByText('Verified')).toBeInTheDocument()
    await waitFor(() => expect(preflightButton()).toBeEnabled())
    expect(startButton()).toBeDisabled()

    fireEvent.click(preflightButton())
    expect(await screen.findByText('All checks passed. The test VM will use VMID 9001 and needs 32 GiB.')).toBeInTheDocument()
    expect(screen.getByText('Archive found')).toBeInTheDocument()
    expect(screen.getByText('free space close to the margin')).toBeInTheDocument()
    expect(screen.getByText('future_check')).toBeInTheDocument()
    expect(posted.preflight[0]).toMatchObject({
      pbsId: 'pbs-1', backupId: '101', backupTime: '2026-10-18T02:00:05Z', verifyState: 'ok',
      targetConnectionId: 'c1', targetNode: 'pve2', targetStorage: 'local-lvm',
      networkMode: 'bridge', bridge: 'vmbr9', restoreTimeoutSec: 7200, bootTimeoutSec: 300, agentTimeoutSec: 120,
    })

    fireEvent.click(startButton())
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(onStarted).toHaveBeenCalledWith({ id: 'd1' })
    expect(toast.success).toHaveBeenCalledWith('Restore drill started')
    expect(posted.create).toHaveLength(1)
  })

  it('makes the preflight stale when the isolation changes', async () => {
    seed()
    open()
    await waitFor(() => expect(preflightButton()).toBeEnabled())
    fireEvent.click(preflightButton())
    await screen.findByText(/All checks passed/)
    fireEvent.click(screen.getByLabelText('Disconnect all NICs (link_down)'))
    expect(screen.queryByText(/All checks passed/)).toBeNull()
    expect(startButton()).toBeDisabled()
    fireEvent.click(preflightButton())
    await screen.findByText(/All checks passed/)
    expect(posted.preflight[1]).toMatchObject({ networkMode: 'link_down', bridge: '' })
  })

  it('keeps Start disabled when a check fails', async () => {
    seed({ preflight: { ok: false, required_bytes: 0, temp_vmid: 0, checks: [{ key: 'free_space', status: 'fail', detail: 'need 32 GiB, 10 GiB free' }] } })
    open()
    await waitFor(() => expect(preflightButton()).toBeEnabled())
    fireEvent.click(preflightButton())
    expect(await screen.findByText('At least one check failed. Fix it, then run the preflight again.')).toBeInTheDocument()
    expect(screen.getByText('need 32 GiB, 10 GiB free')).toBeInTheDocument()
    expect(startButton()).toBeDisabled()
  })

  it('shows the fresh preflight when the start is refused', async () => {
    seed({
      create: () => HttpResponse.json({
        error: 'preflight failed',
        preflight: { ok: false, required_bytes: 0, temp_vmid: 0, checks: [{ key: 'concurrency', status: 'fail', detail: '1 drill already running' }] },
      }, { status: 422 }),
    })
    const { onClose } = open()
    await waitFor(() => expect(preflightButton()).toBeEnabled())
    fireEvent.click(preflightButton())
    await screen.findByText(/All checks passed/)
    fireEvent.click(startButton())
    expect(await screen.findByText('The drill could not start: preflight failed')).toBeInTheDocument()
    expect(screen.getByText('1 drill already running')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('reports a preflight the server refused', async () => {
    seed()
    server.use(http.post('*/api/v1/backups/restore-drills/preflight', () =>
      HttpResponse.json({ error: 'No PVE storage of this cluster points to this PBS datastore and namespace' }, { status: 409 })))
    open()
    await waitFor(() => expect(preflightButton()).toBeEnabled())
    fireEvent.click(preflightButton())
    expect(await screen.findByText('The preflight could not run: No PVE storage of this cluster points to this PBS datastore and namespace')).toBeInTheDocument()
  })

  it('says so when no cluster sees the datastore', async () => {
    seed({ targets: [] })
    open()
    expect(await screen.findByText(/No cluster has a PBS storage pointing at this datastore/)).toBeInTheDocument()
    expect(preflightButton()).toBeDisabled()
  })
})
