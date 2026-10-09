import { act } from 'react'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithProviders, screen, waitFor, fireEvent, within } from '@/__tests__/setup/renderWithProviders'
import { server, http, HttpResponse } from '@/__tests__/setup/msw-server'

import RestoreToGuestDialog, { type RestoreToGuestDialogProps } from './RestoreToGuestDialog'

const toast = vi.hoisted(() => ({
  showToast: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
}))

vi.mock('@/contexts/ToastContext', () => ({ useToast: () => toast }))

const SOURCE = { kind: 'pve', connId: 'c1', storage: 'pbs', volume: 'vol1' } as const

const SETTINGS = {
  agentEnabled: true,
  sshEnabled: true,
  agentMaxBytes: 1073741824,
  agentParallelWrites: 4,
  defaultConflict: 'overwrite',
  restoredPrefix: 'RESTORED-',
  defaultCustomDirLinux: '/var/tmp/proxcenter-restore',
  defaultCustomDirWindows: 'C:\\ProxCenter-Restore',
}

const VMS = [
  { connId: 'c2', connectionName: 'Beta', node: 'n2', type: 'qemu', vmid: 300, name: 'other-vm', status: 'running' },
  { connId: 'c1', connectionName: 'Alpha', node: 'n1', type: 'qemu', vmid: 101, name: 'web', status: 'running' },
  { connId: 'c1', connectionName: 'Alpha', node: 'n1', type: 'qemu', vmid: 100, name: 'db', status: 'stopped' },
  { connId: 'c1', connectionName: 'Alpha', node: 'n1', type: 'lxc', vmid: 200, name: 'ct', status: 'running' },
  { connId: 'c1', connectionName: 'Alpha', node: 'n1', type: 'qemu', vmid: 900, name: 'tpl', template: 1 },
  { connId: 'c3', node: 'n3', type: 'qemu', vmid: 50, name: 'noconn', status: 'paused' },
]

const FILE_ITEMS = [{ path: '/etc/hosts', directory: false, size: 1024 }]

interface SetupOptions {
  settings?: Record<string, unknown> | 'fail' | 'error'
  vms?: unknown[] | 'fail'
  guest?: Record<string, unknown> | 'fail' | null
  probe?: (body: any) => Response
  jobStart?: () => Response
  jobs?: Array<Record<string, unknown>>
  cancel?: () => Response
}

function job(over: Record<string, unknown>) {
  return {
    id: 'job-1',
    status: 'running',
    bytesDone: 0,
    filesDone: 0,
    filesSkipped: 0,
    filesFailed: 0,
    ...over,
  }
}

function setup(opts: SetupOptions = {}) {
  const calls = { probe: [] as any[], start: [] as any[], polls: 0, cancel: 0 }
  const jobs = opts.jobs ?? [job({ status: 'completed', filesDone: 1 })]

  server.use(
    http.get('/api/v1/settings/guest-file-restore', () => {
      if (opts.settings === 'fail') return HttpResponse.error()
      if (opts.settings === 'error') return HttpResponse.json({ error: 'x' }, { status: 500 })

      return HttpResponse.json({ data: opts.settings ?? SETTINGS })
    }),
    http.get('/api/v1/vms', () => {
      if (opts.vms === 'fail') return HttpResponse.error()

      return HttpResponse.json({ data: { vms: opts.vms ?? VMS } })
    }),
    http.get('/api/v1/connections/:c/guests/:type/:node/:vmid/guest', () => {
      if (opts.guest === 'fail') return HttpResponse.error()
      if (opts.guest === null) return HttpResponse.json({ error: 'nope' }, { status: 404 })

      return HttpResponse.json({ data: opts.guest ?? { status: 'running', ip: '10.0.0.5', osInfo: { type: 'linux' } } })
    }),
    http.post('/api/v1/guest-file-restore/probe', async ({ request }) => {
      const body = await request.json()

      calls.probe.push(body)

      return opts.probe ? opts.probe(body) : HttpResponse.json({ ok: true, os: 'linux', hostname: 'web' })
    }),
    http.post('/api/v1/guest-file-restore/jobs', async ({ request }) => {
      calls.start.push(await request.json())

      return opts.jobStart ? opts.jobStart() : HttpResponse.json({ data: { id: 'job-1' } })
    }),
    http.get('/api/v1/guest-file-restore/jobs/:id', () => {
      const j = jobs[Math.min(calls.polls, jobs.length - 1)]

      calls.polls++

      return HttpResponse.json({ data: j })
    }),
    http.post('/api/v1/guest-file-restore/jobs/:id/cancel', () => {
      calls.cancel++

      return opts.cancel ? opts.cancel() : HttpResponse.json({ data: job({ status: 'cancelled' }) })
    }),
  )

  return calls
}

const DEFAULT_TARGET = { connId: 'c1', node: 'n1', type: 'qemu' as const, vmid: 101, name: 'web' }

function renderDialog(props: Partial<RestoreToGuestDialogProps> = {}) {
  const onClose = vi.fn()
  const view = renderWithProviders(
    <RestoreToGuestDialog
      open
      onClose={onClose}
      source={SOURCE}
      items={FILE_ITEMS}
      defaultTarget={DEFAULT_TARGET}
      {...props}
    />,
  )

  return { ...view, onClose }
}

const restoreButton = () => screen.getByRole('button', { name: /^restore$/i })
const radio = (name: RegExp) => screen.getByRole('radio', { name })

async function fillSsh({ host = '10.0.0.9', user = 'root', password = 'secret' } = {}) {
  fireEvent.change(screen.getByLabelText(/^host$/i), { target: { value: host } })
  fireEvent.change(screen.getByLabelText(/^username$/i), { target: { value: user } })
  if (password) fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: password } })
}

beforeEach(() => {
  for (const fn of Object.values(toast)) fn.mockClear()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('RestoreToGuestDialog form', () => {
  it('defaults to the backup guest and the agent, and lists the selection', async () => {
    setup()
    const items = Array.from({ length: 7 }, (_, i) => ({ path: `/data/f${i}`, directory: false, size: 10, label: i === 0 ? 'first' : undefined }))

    renderDialog({ items, backupLabel: 'VM 101 · today' })

    expect(screen.getByText('7 items to restore')).toBeInTheDocument()
    expect(screen.getByText('From backup VM 101 · today')).toBeInTheDocument()
    expect(screen.getByText('first')).toBeInTheDocument()
    expect(screen.getByText('and 2 more items')).toBeInTheDocument()
    expect(screen.getByText(/^Total size:/)).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: /target guest/i })).toHaveValue('web (101)')
    expect(screen.getByText('Files are written into this guest, on node n1')).toBeInTheDocument()
    expect(radio(/qemu guest agent/i)).toBeChecked()
    expect(radio(/original location/i)).toBeChecked()
    // Default conflict comes from the settings.
    await waitFor(() => expect(screen.getByText('Overwrite the existing file')).toBeInTheDocument())
    await waitFor(() => expect(restoreButton()).toBeEnabled())
  })

  it('warns when the target is not running, and directories hide the total size', async () => {
    setup({ guest: { status: 'stopped' } })
    renderDialog({ items: [{ path: '/etc', directory: true }] })

    expect(await screen.findByText(/This guest is not running/)).toBeInTheDocument()
    expect(screen.queryByText(/^Total size:/)).not.toBeInTheDocument()
  })

  it('starts an agent restore with the expected body and follows it to completion', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const calls = setup({
      jobs: [
        job({ status: 'running', bytesDone: 100, bytesRead: 500, bytesTotal: 1000, currentPath: '/etc/hosts', guestOs: 'linux', log: [{ at: '2026-10-09T10:00:00Z', level: 'info', msg: 'started' }, { at: '2026-10-09T10:00:01Z', level: 'warn', msg: 'slow' }, { at: '2026-10-09T10:00:02Z', level: 'error', msg: 'bad' }] }),
        job({ status: 'completed', bytesDone: 1000, bytesTotal: 1000, filesDone: 3 }),
      ],
    })

    renderDialog({ items: [...FILE_ITEMS, { path: '/srv', directory: true }] })
    await screen.findByText('Overwrite the existing file')
    await waitFor(() => expect(restoreButton()).toBeEnabled())
    fireEvent.click(restoreButton())

    expect(await screen.findByText('Current file')).toBeInTheDocument()
    expect(calls.start[0]).toEqual({
      source: SOURCE,
      items: [{ path: '/etc/hosts', directory: false, size: 1024 }, { path: '/srv', directory: true }],
      target: { connId: 'c1', node: 'n1', type: 'qemu', vmid: 101 },
      method: 'agent',
      destination: { mode: 'original' },
      conflict: 'overwrite',
    })
    expect(screen.getByText('Running')).toBeInTheDocument()
    expect(screen.getByText(/read from the backup/)).toBeInTheDocument()
    expect(screen.getByText('Linux')).toBeInTheDocument()
    expect(screen.getByText(/keeps running if you close/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Log (3)' }))
    expect(screen.getByText(/started/)).toBeInTheDocument()
    expect(screen.getByText(/slow/)).toBeInTheDocument()

    await act(async () => { await vi.advanceTimersByTimeAsync(1600) })

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Restore into the guest completed: 3 files restored.'))
    expect(screen.getByText('Completed')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /stop the restore/i })).not.toBeInTheDocument()
    expect(toast.success).toHaveBeenCalledTimes(1)
  })

  it('retries a failed poll on the next tick', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    setup()
    let polls = 0

    server.use(http.get('/api/v1/guest-file-restore/jobs/:id', () => {
      polls++

      return polls === 1 ? HttpResponse.error() : HttpResponse.json({ data: job({ status: 'completed_with_errors', filesDone: 2, filesFailed: 1, error: 'some failed' }) })
    }))

    renderDialog()
    await waitFor(() => expect(restoreButton()).toBeEnabled())
    fireEvent.click(restoreButton())
    await waitFor(() => expect(polls).toBe(1))
    expect(screen.getByText('Queued')).toBeInTheDocument()

    await act(async () => { await vi.advanceTimersByTimeAsync(1600) })

    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith('Restore into the guest completed with errors: 2 restored, 1 failed.'))
    expect(screen.getByText('some failed')).toBeInTheDocument()
    expect(screen.getByText('1 failed')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Log (0)' }))
    expect(screen.getByText('No log line yet.')).toBeInTheDocument()
  })

  it('reports a failed job with an error toast', async () => {
    setup({ jobs: [job({ status: 'failed', error: 'disk full', guestOs: 'windows' })] })
    renderDialog()
    await waitFor(() => expect(restoreButton()).toBeEnabled())
    fireEvent.click(restoreButton())

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Restore into the guest failed: disk full'))
    expect(screen.getByText('Windows')).toBeInTheDocument()
  })

  it('cancels a running job', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const calls = setup({ jobs: [job({ status: 'running' }), job({ status: 'cancelled' })] })

    renderDialog()
    await waitFor(() => expect(restoreButton()).toBeEnabled())
    fireEvent.click(restoreButton())

    fireEvent.click(await screen.findByRole('button', { name: /stop the restore/i }))

    await waitFor(() => expect(calls.cancel).toBe(1))
    expect(await screen.findByText('Cancelled')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /stop the restore/i })).not.toBeInTheDocument()

    await act(async () => { await vi.advanceTimersByTimeAsync(1600) })
    await waitFor(() => expect(toast.info).toHaveBeenCalledWith('Restore into the guest stopped.'))
  })

  it('toasts when the cancel request fails', async () => {
    setup({ jobs: [job({ status: 'running' })], cancel: () => HttpResponse.json({ error: 'nope' }, { status: 409 }) })

    renderDialog()
    await waitFor(() => expect(restoreButton()).toBeEnabled())
    fireEvent.click(restoreButton())
    fireEvent.click(await screen.findByRole('button', { name: /stop the restore/i }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Unable to stop the restore: nope'))
  })

  it('shows the server error when the job cannot start', async () => {
    setup({ jobStart: () => HttpResponse.json({ error: 'boom' }, { status: 400 }) })
    renderDialog()
    await waitFor(() => expect(restoreButton()).toBeEnabled())
    fireEvent.click(restoreButton())

    expect(await screen.findByText('boom')).toBeInTheDocument()
    expect(restoreButton()).toBeEnabled()
  })

  it('shows the raw text when the start response is not JSON', async () => {
    setup({ jobStart: () => new HttpResponse('Gateway down', { status: 502 }) })
    renderDialog()
    await waitFor(() => expect(restoreButton()).toBeEnabled())
    fireEvent.click(restoreButton())

    expect(await screen.findByText('Gateway down')).toBeInTheDocument()
  })

  it('falls back to the HTTP status when the start response is empty', async () => {
    setup({ jobStart: () => new HttpResponse(null, { status: 500 }) })
    renderDialog()
    await waitFor(() => expect(restoreButton()).toBeEnabled())
    fireEvent.click(restoreButton())

    expect(await screen.findByText('HTTP 500')).toBeInTheDocument()
  })

  it('reports a network error on start', async () => {
    setup({ jobStart: () => HttpResponse.error() })
    renderDialog()
    await waitFor(() => expect(restoreButton()).toBeEnabled())
    fireEvent.click(restoreButton())

    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })

  it('calls onClose from the cancel button', async () => {
    setup()
    const { onClose } = renderDialog()

    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }))
    expect(onClose).toHaveBeenCalled()
    await waitFor(() => expect(restoreButton()).toBeEnabled())
  })
})

describe('RestoreToGuestDialog methods', () => {
  it('forces SSH on a container and gates Restore on the confirmed host key', async () => {
    const calls = setup({
      guest: { status: 'running', ip: '10.0.0.7' },
      probe: () => HttpResponse.json({ ok: true, os: 'linux', hostname: 'ct', hostKeyFingerprint: 'SHA256:abc', details: 'OpenSSH_9' }),
    })

    renderDialog({ defaultTarget: { connId: 'c1', node: 'n1', type: 'lxc', vmid: 200 } })

    expect(radio(/^SSH \/ SFTP/)).toBeChecked()
    expect(radio(/qemu guest agent/i)).toBeDisabled()
    expect(screen.getByText('Not available for containers, use SSH.')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('combobox', { name: /target guest/i })).toHaveValue('ct (200)'))

    // The host is prefilled from the guest route.
    await waitFor(() => expect(screen.getByLabelText(/^host$/i)).toHaveValue('10.0.0.7'))
    fireEvent.change(screen.getByLabelText(/^port$/i), { target: { value: '2222' } })
    await fillSsh({ host: '10.0.0.7' })

    expect(screen.getByText(/Test the connection first/)).toBeInTheDocument()
    expect(restoreButton()).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: /test connection/i }))

    expect(await screen.findByText('Connected. Guest OS: Linux, hostname: ct')).toBeInTheDocument()
    expect(screen.getByText('OpenSSH_9')).toBeInTheDocument()
    expect(calls.probe[0]).toMatchObject({
      method: 'ssh',
      target: { type: 'lxc', vmid: 200 },
      ssh: { host: '10.0.0.7', port: 2222, username: 'root', password: 'secret' },
    })
    expect(screen.getByText(/SHA256:abc/)).toBeInTheDocument()
    expect(restoreButton()).toBeDisabled()

    const confirm = screen.getByRole('checkbox')

    fireEvent.click(confirm)
    expect(confirm).toBeChecked()
    expect(restoreButton()).toBeEnabled()
    fireEvent.click(confirm)
    expect(restoreButton()).toBeDisabled()
    fireEvent.click(confirm)

    fireEvent.click(restoreButton())
    await waitFor(() => expect(calls.start).toHaveLength(1))
    expect(calls.start[0]).toMatchObject({
      method: 'ssh',
      ssh: { host: '10.0.0.7', port: 2222, username: 'root', password: 'secret', hostKeyFingerprint: 'SHA256:abc' },
    })
    await waitFor(() => expect(toast.success).toHaveBeenCalled())
  })

  it('does not overwrite a host the user typed with the guest IP', async () => {
    let release!: () => void
    const gate = new Promise<void>(r => { release = r })

    setup()
    server.use(http.get('/api/v1/connections/:c/guests/:type/:node/:vmid/guest', async () => {
      await gate

      return HttpResponse.json({ data: { status: 'running', ip: '10.0.0.5' } })
    }))
    renderDialog()
    fireEvent.click(radio(/^SSH \/ SFTP/))
    fireEvent.change(screen.getByLabelText(/^host$/i), { target: { value: 'typed.example' } })
    release()
    await waitFor(() => expect(screen.getByText(/Overwrite/)).toBeInTheDocument())
    await new Promise(r => setTimeout(r, 20))
    expect(screen.getByLabelText(/^host$/i)).toHaveValue('typed.example')
  })

  it('uses a private key with passphrase and shows probe failures', async () => {
    let mode: 'http' | 'net' | 'ok' = 'http'
    const calls = setup({
      probe: () => {
        if (mode === 'http') return HttpResponse.json({ error: 'auth failed' }, { status: 401 })
        if (mode === 'net') return HttpResponse.error()

        return HttpResponse.json({ ok: true, hostKeyFingerprint: 'SHA256:k' })
      },
    })

    renderDialog()
    fireEvent.click(radio(/^SSH \/ SFTP/))
    expect(radio(/^SSH \/ SFTP/)).toBeChecked()
    await fillSsh({ password: '' })

    fireEvent.click(screen.getByRole('button', { name: /private key/i }))
    fireEvent.change(screen.getByLabelText(/^private key$/i), { target: { value: '-----BEGIN KEY-----' } })
    fireEvent.change(screen.getByLabelText(/key passphrase/i), { target: { value: 'pp' } })

    fireEvent.click(screen.getByRole('button', { name: /test connection/i }))
    expect(await screen.findByText('Connection failed: auth failed')).toBeInTheDocument()
    expect(calls.probe[0].ssh).toMatchObject({ privateKey: '-----BEGIN KEY-----', passphrase: 'pp' })
    expect(calls.probe[0].ssh.password).toBeUndefined()

    mode = 'net'
    fireEvent.click(screen.getByRole('button', { name: /test connection/i }))
    await waitFor(() => expect(calls.probe).toHaveLength(2))
    expect(await screen.findByText(/^Connection failed:/)).toBeInTheDocument()

    mode = 'ok'
    fireEvent.click(screen.getByRole('button', { name: /test connection/i }))
    expect(await screen.findByText('Connected. Guest OS: unknown, hostname: -')).toBeInTheDocument()

    // Empty passphrase is not sent.
    fireEvent.change(screen.getByLabelText(/key passphrase/i), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: /test connection/i }))
    await waitFor(() => expect(calls.probe).toHaveLength(4))
    expect(calls.probe[3].ssh.passphrase).toBeUndefined()

    // Back to password mode; the toggle ignores a click on the active button.
    fireEvent.click(screen.getByRole('button', { name: /^password$/i }))
    expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^password$/i }))
    expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument()
  })

  it('probes the agent and reports a Windows guest', async () => {
    const calls = setup({ probe: () => HttpResponse.json({ ok: true, os: 'windows', hostname: 'win' }) })

    renderDialog()
    await waitFor(() => expect(restoreButton()).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: /test connection/i }))

    expect(await screen.findByText('Connected. Guest OS: Windows, hostname: win')).toBeInTheDocument()
    expect(calls.probe[0]).toEqual({ target: { connId: 'c1', node: 'n1', type: 'qemu', vmid: 101 }, method: 'agent' })
    // A Windows guest shows the drive letter field.
    expect(screen.getByLabelText(/windows drive letter/i)).toHaveValue('C')
  })

  it('reports an HTTP status when the probe response has no error', async () => {
    setup({ probe: () => new HttpResponse(null, { status: 503 }) })
    renderDialog()
    await waitFor(() => expect(restoreButton()).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: /test connection/i }))

    expect(await screen.findByText('Connection failed: HTTP 503')).toBeInTheDocument()
  })

  it('falls back to SSH when the agent is disabled in the settings', async () => {
    setup({ settings: { ...SETTINGS, agentEnabled: false } })
    renderDialog()

    await waitFor(() => expect(radio(/^SSH \/ SFTP/)).toBeChecked())
    expect(radio(/qemu guest agent/i)).toBeDisabled()
    expect(screen.getByText('Disabled in the settings.')).toBeInTheDocument()
  })

  it('keeps the agent when SSH is disabled in the settings', async () => {
    setup({ settings: { ...SETTINGS, sshEnabled: false } })
    renderDialog()

    await waitFor(() => expect(radio(/^SSH \/ SFTP/)).toBeDisabled())
    expect(radio(/qemu guest agent/i)).toBeChecked()
  })

  it('blocks everything when both methods are disabled', async () => {
    setup({ settings: { ...SETTINGS, agentEnabled: false, sshEnabled: false } })
    renderDialog()

    expect(await screen.findByText(/Both restore methods are disabled/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /test connection/i })).not.toBeInTheDocument()
    expect(restoreButton()).toBeDisabled()
  })

  it('blocks the agent above its size limit', async () => {
    setup({ settings: { ...SETTINGS, agentMaxBytes: 1000 } })
    renderDialog({ items: [{ path: '/big', directory: false, size: 5000 }] })

    expect(await screen.findByText(/above the guest agent limit/)).toBeInTheDocument()
    expect(restoreButton()).toBeDisabled()
  })

  it('recommends SSH for a large selection under the limit', async () => {
    setup()
    renderDialog({ items: [{ path: '/big', directory: false, size: 300 * 1024 * 1024 }] })

    expect(await screen.findByText(/SSH is much faster than the guest agent/)).toBeInTheDocument()
    await waitFor(() => expect(restoreButton()).toBeEnabled())
  })

  it('uses the defaults when settings and inventory fail to load', async () => {
    setup({ settings: 'fail', vms: 'fail', guest: 'fail' })
    renderDialog()

    await waitFor(() => expect(screen.getByText(/Keep both \(restored copy named RESTORED-name\)/)).toBeInTheDocument())
    expect(radio(/qemu guest agent/i)).toBeChecked()
  })

  it('uses the defaults on an HTTP error from the settings route', async () => {
    setup({ settings: 'error', guest: null })
    renderDialog()

    await waitFor(() => expect(screen.getByText(/Keep both/)).toBeInTheDocument())
  })
})

describe('RestoreToGuestDialog target picker', () => {
  it('lists guests grouped by connection and switches target', async () => {
    const calls = setup({ guest: { status: 'running' } })

    renderDialog({ defaultTarget: undefined })

    expect(restoreButton()).toBeDisabled()
    expect(screen.getByRole('button', { name: /test connection/i })).toBeDisabled()

    const input = screen.getByRole('combobox', { name: /target guest/i })

    fireEvent.mouseDown(input)
    fireEvent.change(input, { target: { value: '' } })
    const listbox = await screen.findByRole('listbox')

    expect(within(listbox).queryByText('tpl')).not.toBeInTheDocument()
    expect(within(listbox).getByText('Alpha')).toBeInTheDocument()
    expect(within(listbox).getByText('Beta')).toBeInTheDocument()
    expect(within(listbox).getByText('c3')).toBeInTheDocument()

    fireEvent.click(within(listbox).getByText('ct'))
    expect(input).toHaveValue('ct (200)')
    expect(radio(/^SSH \/ SFTP/)).toBeChecked()

    fireEvent.mouseDown(input)
    fireEvent.click(within(await screen.findByRole('listbox')).getByText('db'))
    expect(input).toHaveValue('db (100)')
    expect(radio(/qemu guest agent/i)).toBeChecked()
    await waitFor(() => expect(restoreButton()).toBeEnabled())
    fireEvent.click(restoreButton())
    await waitFor(() => expect(calls.start).toHaveLength(1))
    expect(calls.start[0].target).toEqual({ connId: 'c1', node: 'n1', type: 'qemu', vmid: 100 })
    await waitFor(() => expect(toast.success).toHaveBeenCalled())
  })

  it('shows the empty inventory text', async () => {
    setup({ vms: [] })
    renderDialog({ defaultTarget: undefined })

    const input = screen.getByRole('combobox', { name: /target guest/i })

    fireEvent.mouseDown(input)
    expect(await screen.findByText('No guest found')).toBeInTheDocument()
  })

  it('names a default target without a name from its type and vmid', async () => {
    setup({ vms: [] })
    renderDialog({ defaultTarget: { connId: 'c9', node: 'n9', type: 'qemu', vmid: 77 } })

    expect(screen.getByRole('combobox', { name: /target guest/i })).toHaveValue('qemu/77 (77)')
    await waitFor(() => expect(restoreButton()).toBeEnabled())
  })
})

describe('RestoreToGuestDialog destination', () => {
  it('restores into a custom folder', async () => {
    const calls = setup()

    renderDialog()
    fireEvent.click(radio(/custom folder/i))

    const folder = screen.getByLabelText(/folder in the guest/i)

    await waitFor(() => expect(folder).toHaveValue('/var/tmp/proxcenter-restore'))
    fireEvent.change(folder, { target: { value: '   ' } })
    expect(restoreButton()).toBeDisabled()
    fireEvent.change(folder, { target: { value: ' /restore/here ' } })

    fireEvent.mouseDown(await screen.findByText('Overwrite the existing file'))
    fireEvent.click(await screen.findByRole('option', { name: 'Skip the file' }))

    await waitFor(() => expect(restoreButton()).toBeEnabled())
    fireEvent.click(restoreButton())
    await waitFor(() => expect(calls.start).toHaveLength(1))
    expect(calls.start[0].destination).toEqual({ mode: 'custom', path: '/restore/here' })
    expect(calls.start[0].conflict).toBe('skip')
    await waitFor(() => expect(toast.success).toHaveBeenCalled())
  })

  it('asks for a Windows drive letter on a Windows guest', async () => {
    const calls = setup({ guest: { status: 'running', osInfo: { type: 'windows' } } })

    renderDialog()

    const drive = await screen.findByLabelText(/windows drive letter/i)

    fireEvent.change(drive, { target: { value: '1' } })
    expect(drive).toHaveValue('')
    expect(restoreButton()).toBeDisabled()
    fireEvent.change(drive, { target: { value: 'd' } })
    expect(drive).toHaveValue('D')

    fireEvent.click(restoreButton())
    await waitFor(() => expect(calls.start).toHaveLength(1))
    expect(calls.start[0].destination).toEqual({ mode: 'original', windowsDrive: 'D' })
    await waitFor(() => expect(toast.success).toHaveBeenCalled())
  })

  it('defaults the custom folder to the Windows one on a Windows guest', async () => {
    setup({ guest: { status: 'running', osInfo: { type: 'windows' } } })
    renderDialog()

    await screen.findByLabelText(/windows drive letter/i)
    fireEvent.click(radio(/custom folder/i))
    expect(screen.getByLabelText(/folder in the guest/i)).toHaveValue('C:\\ProxCenter-Restore')
    expect(screen.queryByLabelText(/windows drive letter/i)).not.toBeInTheDocument()
  })
})
