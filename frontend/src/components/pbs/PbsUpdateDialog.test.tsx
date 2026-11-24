import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, waitFor } from '@testing-library/react'

import { renderWithProviders, screen, userEvent } from '@/__tests__/setup/renderWithProviders'
import { server, http, HttpResponse } from '@/__tests__/setup/msw-server'

import PbsUpdateDialog from './PbsUpdateDialog'

afterEach(cleanup)

const preflight = (over: Record<string, unknown> = {}) => ({
  can_proceed: true,
  findings: [],
  version: '4.2.0-1',
  kernel: '7.0.0-3-pve',
  updates: { updates_available: true, package_count: 160, kernel_update: true, security_updates: 43, packages: [] },
  disk_space_free_bytes: 123918008320,
  disk_space_total_bytes: 184221888512,
  running_tasks: [],
  datastores: [{ name: 'main' }, { name: 'archive', maintenance_mode: 'offline' }],
  inactive_services: [],
  reboot_pending: false,
  pending_configure: 0,
  backup_jobs: [],
  upcoming_backup_jobs: [],
  ...over,
})

const node = (over: Record<string, unknown> = {}) => ({ node_name: 'PBS', status: 'updating', ...over })

const run = (over: Record<string, unknown> = {}) => ({
  id: 'run-1',
  kind: 'pbs',
  status: 'running',
  config: { auto_reboot: true, pbs: { datastore_read_only: true } },
  node_statuses: [node()],
  logs: [{ timestamp: '2026-11-23T19:09:47Z', level: 'info', message: 'Proxmox Backup Server update started' }],
  ...over,
})

function mount(latest: unknown, ...handlers: Parameters<typeof server.use>) {
  const onFinished = vi.fn()

  server.use(
    http.get('*/api/v1/pbs/pbs-1/update', ({ request }) => (new URL(request.url).searchParams.get('run')
      ? HttpResponse.json({ data: { sshEnabled: true, orchestrator: true, run: latest } })
      : HttpResponse.json({ data: { sshEnabled: true, orchestrator: true, run: latest } }))),
    ...handlers,
  )
  renderWithProviders(<PbsUpdateDialog open pbsId='pbs-1' pbsName='PBS' onClose={vi.fn()} onFinished={onFinished} />)

  return { onFinished }
}

describe('PbsUpdateDialog', () => {
  it('shows the checks and starts the run with the chosen options', async () => {
    let started: any = null

    mount(
      null,
      http.post('*/api/v1/pbs/pbs-1/update/preflight', () => HttpResponse.json({ data: preflight() })),
      http.post('*/api/v1/pbs/pbs-1/update', async ({ request }) => {
        started = await request.json()

        return HttpResponse.json({ data: run() }, { status: 201 })
      }),
    )

    expect(await screen.findByText('Update PBS')).toBeInTheDocument()
    expect(await screen.findByText('160 packages')).toBeInTheDocument()
    expect(screen.getByText('4.2.0-1')).toBeInTheDocument()
    expect(screen.getByText('2 datastores, 1 already in maintenance')).toBeInTheDocument()

    const user = userEvent.setup()

    await user.click(screen.getByLabelText('Put the datastores in read-only during the update'))
    await user.click(screen.getByRole('button', { name: 'Start' }))

    await waitFor(() => expect(started).toEqual({ autoReboot: true, rebootTimeout: 600, datastoreReadOnly: false }))
    expect(await screen.findByText('Update in progress')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel the update' })).toBeInTheDocument()
  })

  it('explains a refused enterprise repository and does not let the run start', async () => {
    mount(
      null,
      http.post('*/api/v1/pbs/pbs-1/update/preflight', () => HttpResponse.json({
        data: preflight({
          can_proceed: false,
          updates: { updates_available: false, package_count: 0, kernel_update: false, security_updates: 0, packages: [] },
          findings: [{
            severity: 'error', code: 'pbs_apt_update_failed', message: 'raw',
            context: { error: 'Failed to fetch https://enterprise.proxmox.com/debian/pbs/dists/trixie/InRelease  401  Unauthorized' },
          }],
        }),
      })),
    )

    expect(await screen.findByText(/The enterprise repository needs a valid subscription/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled()
    // The pending count is unknown, not zero.
    expect(screen.queryByText('no package')).not.toBeInTheDocument()
  })

  it('blocks on a running task and warns about a backup job due soon', async () => {
    mount(
      null,
      http.post('*/api/v1/pbs/pbs-1/update/preflight', () => HttpResponse.json({
        data: preflight({
          can_proceed: false,
          running_tasks: [{ upid: 'UPID:pbs:1', worker_type: 'verify', worker_id: 'test-vdc' }],
          findings: [{ severity: 'error', code: 'pbs_tasks_running', message: 'raw', context: { count: 1, tasks: 'verify (test-vdc)' } }],
          backup_jobs: [{ connectionName: 'PVE-DR', id: 'j1', storage: 'pbs', schedule: '*:0/30', nextRun: 1796079600 }],
          upcoming_backup_jobs: [{ connectionName: 'PVE-DR', id: 'j1', storage: 'pbs', schedule: '*:0/30', nextRun: 1796079600 }],
        }),
      })),
    )

    expect(await screen.findByText(/A task is running on the server and would be interrupted: verify \(test-vdc\)/)).toBeInTheDocument()
    expect(screen.getByText(/A backup job of PVE-DR is due at/)).toBeInTheDocument()
    expect(screen.getByText('1 task')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled()
  })

  it('lets a server with an interrupted upgrade be repaired although apt lists nothing', async () => {
    mount(
      null,
      http.post('*/api/v1/pbs/pbs-1/update/preflight', () => HttpResponse.json({
        data: preflight({
          updates: { updates_available: false, package_count: 0, kernel_update: false, security_updates: 0, packages: [] },
          pending_configure: 89,
          findings: [{ severity: 'warning', code: 'pbs_dpkg_interrupted', message: 'raw', context: { count: 89 } }],
        }),
      })),
    )

    expect(await screen.findByText(/89 packages are unpacked but not configured/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled()
  })

  it('shows the preflight error and lets the operator check again', async () => {
    let calls = 0

    mount(
      null,
      http.post('*/api/v1/pbs/pbs-1/update/preflight', () => {
        calls++

        return calls === 1
          ? HttpResponse.json({ error: 'Preflight check failed: SSH connection to PBS failed' }, { status: 400 })
          : HttpResponse.json({ data: preflight() })
      }),
    )

    expect(await screen.findByText('Preflight check failed: SSH connection to PBS failed')).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Check again' }))
    expect(await screen.findByText('160 packages')).toBeInTheDocument()
  })

  it('resumes a run that is still going and cancels it after confirmation', async () => {
    let cancelled = ''

    mount(
      run({ node_statuses: [node({ package_progress: { phase: 'configure', done: 54, total: 160, updated_at: '' } })] }),
      http.delete('*/api/v1/pbs/pbs-1/update', ({ request }) => {
        cancelled = new URL(request.url).searchParams.get('run') ?? ''

        return HttpResponse.json({ data: { cancelled: true } })
      }),
    )

    expect(await screen.findByText('Update in progress')).toBeInTheDocument()
    expect(screen.getByText('Package upgrade')).toBeInTheDocument()
    expect(screen.getByTestId('pbs-update-log')).toHaveTextContent('Proxmox Backup Server update started')

    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Cancel the update' }))
    expect(await screen.findByText('Cancel the update?')).toBeInTheDocument()
    await user.click(screen.getAllByRole('button', { name: 'Cancel the update' }).at(-1)!)
    await waitFor(() => expect(cancelled).toBe('run-1'))
  })

  it('reports what a finished run changed', async () => {
    const finished = run({
      status: 'completed',
      started_at: '2026-11-23T19:09:47Z',
      completed_at: '2026-11-23T19:13:57Z',
      node_statuses: [node({
        status: 'completed', did_reboot: true, reboot_required: true,
        version_before: '4.2.0-1', version_after: '4.2.14-1', kernel_before: '7.0.0-3-pve', kernel_after: '7.0.14-30-pve',
        upgraded_packages: [{ name: 'proxmox-backup-server', current_version: '4.2.0-1', new_version: '4.2.14-1' }],
        maintenance_datastores: ['main'],
        update_output: 'Setting up proxmox-backup-server ...',
      })],
    })

    mount(finished, http.post('*/api/v1/pbs/pbs-1/update/preflight', () => HttpResponse.json({ data: preflight() })))

    const user = userEvent.setup()

    // A finished run is not shown on open: the checks are, with a way back to its report.
    await user.click(await screen.findByRole('button', { name: 'Last report' }))

    expect(await screen.findByText('successful')).toBeInTheDocument()
    expect(screen.getByText('4.2.0-1 → 4.2.14-1')).toBeInTheDocument()
    expect(screen.getByText('7.0.0-3-pve → 7.0.14-30-pve')).toBeInTheDocument()
    expect(screen.getByText('4 min 10 s')).toBeInTheDocument()
    expect(screen.getByText('Finished on').parentElement).toHaveTextContent(new Date('2026-11-23T19:13:57Z').toLocaleString('en', { dateStyle: 'medium', timeStyle: 'short' }))

    await user.click(screen.getByRole('button', { name: 'Packages' }))
    expect(await screen.findByText('proxmox-backup-server')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Back to the checks' }))
    expect(await screen.findByRole('button', { name: 'Start' })).toBeInTheDocument()
  })

  it('says why a run failed, where, and that a reboot is still due', async () => {
    mount(
      run({ status: 'failed', error: 'apt update failed: dpkg returned an error code (1)', node_statuses: [node({ status: 'failed', failed_phase: 'updating', update_output: 'E: Sub-process /usr/bin/dpkg returned an error code (1)' })] }),
      http.post('*/api/v1/pbs/pbs-1/update/preflight', () => HttpResponse.json({ data: preflight() })),
    )

    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Last report' }))
    expect(await screen.findByText(/The update failed: apt update failed: dpkg returned an error code/)).toBeInTheDocument()
    // Once as the status of the update, once on the step that failed.
    expect(screen.getByText('Update status').parentElement).toHaveTextContent('failed')
    expect(screen.getByText('Package upgrade').parentElement).toHaveTextContent('failed')
    // The apt output of a failed run opens by itself.
    expect(screen.getByText(/Sub-process \/usr\/bin\/dpkg returned an error code/)).toBeInTheDocument()
  })

  it('tells when the new kernel still waits for a reboot', async () => {
    mount(
      run({ status: 'completed', config: { auto_reboot: false, pbs: { datastore_read_only: false } }, node_statuses: [node({ status: 'completed', reboot_required: true, did_reboot: false })] }),
      http.post('*/api/v1/pbs/pbs-1/update/preflight', () => HttpResponse.json({ data: preflight() })),
    )

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Last report' }))
    expect(await screen.findByText(/A reboot is required to run the new kernel and was not done/)).toBeInTheDocument()
    expect(screen.getByText('required, not done')).toBeInTheDocument()
  })

  it('calls back once when a followed run ends', async () => {
    let polls = 0
    const onFinished = vi.fn()

    server.use(
      http.get('*/api/v1/pbs/pbs-1/update', () => {
        polls++

        return HttpResponse.json({ data: { sshEnabled: true, orchestrator: true, run: polls === 1 ? run() : run({ status: 'cancelled', node_statuses: [node({ status: 'failed', failed_phase: 'updating' })] }) } })
      }),
    )
    renderWithProviders(<PbsUpdateDialog open pbsId='pbs-1' onClose={vi.fn()} onFinished={onFinished} />)

    expect(await screen.findByText('Update the backup server')).toBeInTheDocument()
    expect(await screen.findByText('cancelled', {}, { timeout: 8000 })).toBeInTheDocument()
    expect(onFinished).toHaveBeenCalledTimes(1)
  }, 15000)
})
