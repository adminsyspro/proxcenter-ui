import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, within } from '@testing-library/react'
import { SWRConfig } from 'swr'

import { renderWithProviders, screen, waitFor, fireEvent } from '@/__tests__/setup/renderWithProviders'

import GuestFileRestoreTab from './GuestFileRestoreTab'

const { toast } = vi.hoisted(() => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }))

vi.mock('@/contexts/ToastContext', () => ({ useToast: () => toast }))

const MIB = 1024 * 1024
const saved = {
  agentEnabled: true,
  sshEnabled: true,
  agentMaxBytes: 1024 * MIB,
  agentParallelWrites: 4,
  defaultConflict: 'keep',
  restoredPrefix: 'BAK-',
  defaultCustomDirLinux: '/srv/proxcenter-restore',
  defaultCustomDirWindows: 'C:\\ProxCenter-Restore',
  sshConnectTimeoutSec: 20,
  maxConcurrentJobs: 3,
  jobRetentionDays: 30,
  spoolDir: '',
  spoolMinFreeBytes: 2048 * MIB,
  sourceStallTimeoutSec: 120,
}

let fetchMock: ReturnType<typeof vi.fn>

function respond(status: number, body: unknown) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })
}

beforeEach(() => {
  toast.success.mockReset()
  toast.error.mockReset()
  fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') return respond(200, { data: JSON.parse(String(init.body)) })
    return respond(200, { data: saved })
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  cleanup()
})

const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement
const saveButton = () => screen.getByRole('button', { name: 'Save' })
const resetButton = () => screen.getByRole('button', { name: 'Discard changes' })

// renderWithProviders turns revalidateOnMount off; the tab loads on mount.
function renderTab() {
  return renderWithProviders(
    <SWRConfig value={{ revalidateOnMount: true }}>
      <GuestFileRestoreTab />
    </SWRConfig>,
  )
}

async function renderLoaded() {
  renderTab()
  await waitFor(() => expect(fetchMock).toHaveBeenCalled())
  await waitFor(() => expect(field('Prefix of restored copies')).toHaveValue('BAK-'))
}

describe('GuestFileRestoreTab', () => {
  it('loads the saved settings with save and discard disabled', async () => {
    await renderLoaded()
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/settings/guest-file-restore', undefined)
    expect(field('Guest agent limit per restore (MiB)')).toHaveValue(1024)
    expect(field('Default custom folder (Linux)')).toHaveValue('/srv/proxcenter-restore')
    expect(saveButton()).toBeDisabled()
    expect(resetButton()).toBeDisabled()
  })

  it('saves the edited fields, trimmed, in the PUT body', async () => {
    await renderLoaded()
    fireEvent.change(field('Prefix of restored copies'), { target: { value: '  OLD-  ' } })
    fireEvent.change(field('Default custom folder (Linux)'), { target: { value: ' /srv/restore ' } })
    fireEvent.change(field('Default custom folder (Windows)'), { target: { value: ' D:\\Restore ' } })
    fireEvent.change(field('Staging folder for the guest agent'), { target: { value: ' /var/spool ' } })
    fireEvent.change(field('Guest agent limit per restore (MiB)'), { target: { value: '10' } })
    fireEvent.change(field('Parallel writes through the agent'), { target: { value: '8' } })
    fireEvent.change(field('SSH connection timeout (seconds)'), { target: { value: '30' } })
    fireEvent.change(field('Free space to keep on the staging disk (MiB)'), { target: { value: '100' } })
    fireEvent.change(field('Backup read timeout (seconds)'), { target: { value: '60' } })
    fireEvent.change(field('Simultaneous restores'), { target: { value: '5' } })
    fireEvent.change(field('History retention (days)'), { target: { value: '7' } })

    fireEvent.mouseDown(screen.getByRole('combobox'))
    fireEvent.click(within(await screen.findByRole('listbox')).getByText('Overwrite'))

    expect(saveButton()).toBeEnabled()
    fireEvent.click(saveButton())

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Guest file restore settings saved'))
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')!
    expect(put[0]).toBe('/api/v1/settings/guest-file-restore')
    expect(JSON.parse(put[1].body)).toEqual({
      ...saved,
      restoredPrefix: 'OLD-',
      defaultCustomDirLinux: '/srv/restore',
      defaultCustomDirWindows: 'D:\\Restore',
      spoolDir: '/var/spool',
      agentMaxBytes: 10 * MIB,
      agentParallelWrites: 8,
      sshConnectTimeoutSec: 30,
      spoolMinFreeBytes: 100 * MIB,
      sourceStallTimeoutSec: 60,
      maxConcurrentJobs: 5,
      jobRetentionDays: 7,
      defaultConflict: 'overwrite',
    })
    await waitFor(() => expect(saveButton()).toBeDisabled())
  })

  it('blocks saving an invalid prefix, empty folders or a relative staging folder', async () => {
    await renderLoaded()
    fireEvent.change(field('Prefix of restored copies'), { target: { value: 'a/b' } })
    expect(screen.getByText('From 1 to 32 characters, without / or \\.')).toBeInTheDocument()
    expect(saveButton()).toBeDisabled()

    fireEvent.change(field('Prefix of restored copies'), { target: { value: 'OK-' } })
    expect(saveButton()).toBeEnabled()
    fireEvent.change(field('Default custom folder (Linux)'), { target: { value: '  ' } })
    expect(saveButton()).toBeDisabled()
    fireEvent.change(field('Default custom folder (Linux)'), { target: { value: '/x' } })
    fireEvent.change(field('Default custom folder (Windows)'), { target: { value: '' } })
    expect(saveButton()).toBeDisabled()
    fireEvent.change(field('Default custom folder (Windows)'), { target: { value: 'C:\\x' } })
    fireEvent.change(field('Staging folder for the guest agent'), { target: { value: 'relative/dir' } })
    expect(screen.getByText('Must be an absolute path, or empty.')).toBeInTheDocument()
    expect(saveButton()).toBeDisabled()
  })

  it('warns when both methods are disabled and disables their dependent fields', async () => {
    await renderLoaded()
    fireEvent.click(screen.getByLabelText('Allow the QEMU guest agent'))
    expect(field('Guest agent limit per restore (MiB)')).toBeDisabled()
    expect(field('Staging folder for the guest agent')).toBeDisabled()
    fireEvent.click(screen.getByLabelText('Allow SSH / SFTP'))
    expect(field('SSH connection timeout (seconds)')).toBeDisabled()
    expect(screen.getByText('With both methods disabled, nobody can restore files into a guest.')).toBeInTheDocument()
  })

  it('discards the local edits', async () => {
    await renderLoaded()
    fireEvent.change(field('Prefix of restored copies'), { target: { value: 'NEW-' } })
    expect(resetButton()).toBeEnabled()
    fireEvent.click(resetButton())
    expect(field('Prefix of restored copies')).toHaveValue('BAK-')
    expect(resetButton()).toBeDisabled()
  })

  it('toasts the server error when saving fails', async () => {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
      (init?.method === 'PUT' ? respond(403, { error: 'Super admin only' }) : respond(200, { data: saved })))
    await renderLoaded()
    fireEvent.change(field('Prefix of restored copies'), { target: { value: 'NEW-' } })
    fireEvent.click(saveButton())
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Unable to save the settings: Super admin only'))
    expect(saveButton()).toBeEnabled()
  })

  it('falls back to the raw text or the HTTP status when the error body is not JSON', async () => {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
      (init?.method === 'PUT' ? respond(502, 'Bad gateway') : respond(200, { data: saved })))
    await renderLoaded()
    fireEvent.change(field('Prefix of restored copies'), { target: { value: 'NEW-' } })
    fireEvent.click(saveButton())
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Unable to save the settings: Bad gateway'))

    fetchMock.mockImplementation(async () => respond(500, ''))
    fireEvent.click(saveButton())
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Unable to save the settings: HTTP 500'))
  })

  it('shows a load error and keeps the defaults', async () => {
    fetchMock.mockImplementation(async () => respond(500, { error: 'db down' }))
    renderTab()
    expect(await screen.findByText('Unable to load the settings: db down')).toBeInTheDocument()
    expect(field('Prefix of restored copies')).toHaveValue('RESTORED-')
    expect(saveButton()).toBeDisabled()
  })
})
