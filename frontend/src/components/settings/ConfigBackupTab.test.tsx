import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen, waitFor, fireEvent } from '@/__tests__/setup/renderWithProviders'

import ConfigBackupTab from './ConfigBackupTab'

const PASSPHRASE = 'correct horse battery'

const inspection = {
  createdAt: '2026-10-25T08:00:00.000Z',
  appVersion: '1.4.12',
  migration: '20261023120000_x',
  compatibility: 'same',
  sections: [{ key: 'connections', rows: 3 }, { key: 'tenants', rows: 0 }],
  unknownTables: [],
}

let fetchMock: ReturnType<typeof vi.fn>
const clicks: string[] = []

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function download() {
  return new Response('{"format":"proxcenter-config-backup"}', {
    status: 200,
    headers: { 'Content-Disposition': 'attachment; filename="proxcenter-config-20261025-0800.json"' },
  })
}

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  clicks.length = 0
  URL.createObjectURL = vi.fn(() => 'blob:x')
  URL.revokeObjectURL = vi.fn()
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicks.push(this.download)
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const typeIn = (label: RegExp, value: string, index = 0) =>
  fireEvent.change(screen.getAllByLabelText(label)[index], { target: { value } })

function pickFile() {
  const input = screen.getByTestId('config-backup-file')
  fireEvent.change(input, { target: { files: [new File(['{}'], 'backup.json', { type: 'application/json' })] } })
}

describe('ConfigBackupTab notes', () => {
  it('keeps the passphrase warning and the other-instance notes beside the cards', () => {
    renderWithProviders(<ConfigBackupTab />)

    expect(screen.getByText(/The passphrase is stored nowhere/)).toBeInTheDocument()
    expect(screen.getByText('Restoring on another instance')).toBeInTheDocument()
    expect(screen.getByText(/Taking them over counts as one move/)).toBeInTheDocument()
    expect(screen.getByText(/Keep the install's .env file/)).toBeInTheDocument()
  })
})

describe('ConfigBackupTab export', () => {
  it('needs a long enough passphrase typed twice, then downloads the file', async () => {
    fetchMock.mockResolvedValue(download())
    renderWithProviders(<ConfigBackupTab />)
    const button = screen.getByRole('button', { name: /Download the backup/ })

    typeIn(/^Passphrase$/, 'short')
    expect(button).toBeDisabled()
    typeIn(/^Passphrase$/, PASSPHRASE)
    typeIn(/Confirm the passphrase/, 'something else')
    expect(screen.getByText('The two passphrases differ.')).toBeInTheDocument()
    expect(button).toBeDisabled()
    typeIn(/Confirm the passphrase/, PASSPHRASE)

    fireEvent.click(button)

    await screen.findByText('Backup downloaded.')
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/admin/config-backup/export', expect.objectContaining({ body: JSON.stringify({ passphrase: PASSPHRASE }) }))
    expect(clicks).toEqual(['proxcenter-config-20261025-0800.json'])
  })

  it('shows the server refusal in words', async () => {
    fetchMock.mockResolvedValue(json({ code: 'passphrase-too-short' }, 400))
    renderWithProviders(<ConfigBackupTab />)
    typeIn(/^Passphrase$/, PASSPHRASE)
    typeIn(/Confirm the passphrase/, PASSPHRASE)

    fireEvent.click(screen.getByRole('button', { name: /Download the backup/ }))

    expect(await screen.findByText('The passphrase is too short.')).toBeInTheDocument()
  })

  it('toggles the passphrase visibility', () => {
    renderWithProviders(<ConfigBackupTab />)
    const field = screen.getAllByLabelText(/^Passphrase$/)[0] as HTMLInputElement

    expect(field.type).toBe('password')
    fireEvent.click(screen.getAllByRole('button', { name: 'Show the passphrase' })[0])
    expect(field.type).toBe('text')
  })
})

describe('ConfigBackupTab import', () => {
  it('checks the file, then backs up the current configuration and restores after confirmation', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ data: inspection }))
      .mockResolvedValueOnce(download())
      .mockResolvedValueOnce(json({ data: { tables: 12, rows: 340, secrets: 5, skippedTables: [], apiTokensInvalid: true, otherInstall: true } }))
    renderWithProviders(<ConfigBackupTab />)

    pickFile()
    expect(screen.getByText('backup.json')).toBeInTheDocument()
    typeIn(/^Passphrase$/, PASSPHRASE, 1)
    fireEvent.click(screen.getByRole('button', { name: /Check the file/ }))

    expect(await screen.findByText('Connections and nodes')).toBeInTheDocument()
    expect(screen.getByText('3 items')).toBeInTheDocument()
    expect(screen.getByText('empty')).toBeInTheDocument()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/v1/admin/config-backup/inspect')
    expect((init.body as FormData).get('passphrase')).toBe(PASSPHRASE)

    fireEvent.click(screen.getByRole('button', { name: /Restore this configuration/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Replace the configuration' }))

    expect(await screen.findByText('Configuration restored: 340 items in 12 tables.')).toBeInTheDocument()
    expect(fetchMock.mock.calls.map(c => c[0])).toEqual([
      '/api/v1/admin/config-backup/inspect',
      '/api/v1/admin/config-backup/export',
      '/api/v1/admin/config-backup/import',
    ])
    expect(clicks).toHaveLength(1)
    expect(screen.getByText(/the restored API tokens cannot be verified here/)).toBeInTheDocument()
    expect(screen.getByText(/This backup comes from another instance/)).toBeInTheDocument()
    // The page stays aria-hidden until the confirmation dialog has finished
    // closing, which a slow runner can still be doing here: wait for it.
    expect(await screen.findByRole('link', { name: 'Open License' })).toHaveAttribute('href', '/settings?tab=license')
    expect(await screen.findByRole('button', { name: /Reload the page/ })).toBeInTheDocument()
  })

  it('restores without the safety export when it is unticked, and keeps the form on a refusal', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ data: { ...inspection, compatibility: 'older', unknownTables: ['tls_certificates'] } }))
      .mockResolvedValueOnce(json({ code: 'wrong-passphrase' }, 400))
    renderWithProviders(<ConfigBackupTab />)
    pickFile()
    typeIn(/^Passphrase$/, PASSPHRASE, 1)
    fireEvent.click(screen.getByRole('button', { name: /Check the file/ }))

    expect(await screen.findByText(/older ProxCenter version/)).toBeInTheDocument()
    expect(screen.getByText('Not restored on this version: tls_certificates.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: /Restore this configuration/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Replace the configuration' }))

    expect(await screen.findByText('Wrong passphrase, or a damaged file.')).toBeInTheDocument()
    expect(fetchMock.mock.calls.map(c => c[0])).toEqual(['/api/v1/admin/config-backup/inspect', '/api/v1/admin/config-backup/import'])
  })

  it('offers no restore for a backup from a newer version', async () => {
    fetchMock.mockResolvedValueOnce(json({ data: { ...inspection, compatibility: 'newer' } }))
    renderWithProviders(<ConfigBackupTab />)
    pickFile()
    typeIn(/^Passphrase$/, PASSPHRASE, 1)
    fireEvent.click(screen.getByRole('button', { name: /Check the file/ }))

    expect(await screen.findByText(/newer ProxCenter version/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Restore this configuration/ })).not.toBeInTheDocument()
  })

  it('stops when the safety export fails, and maps unknown errors to a generic message', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ data: inspection }))
      .mockResolvedValueOnce(json({ code: 'passphrase-too-short' }, 400))
      .mockResolvedValueOnce(json({ data: inspection }))
      .mockResolvedValueOnce(json({ error: 'boom' }, 500))
    renderWithProviders(<ConfigBackupTab />)
    pickFile()
    typeIn(/^Passphrase$/, PASSPHRASE, 1)
    fireEvent.click(screen.getByRole('button', { name: /Check the file/ }))
    fireEvent.click(await screen.findByRole('button', { name: /Restore this configuration/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Replace the configuration' }))

    expect(await screen.findByText(/too short to encrypt the backup of the current configuration/)).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)

    // The confirmation dialog hides the page from the accessibility tree until its exit transition ends.
    fireEvent.click(await screen.findByRole('button', { name: /Check the file/ }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    fireEvent.click(await screen.findByRole('checkbox'))
    fireEvent.click(await screen.findByRole('button', { name: /Restore this configuration/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Replace the configuration' }))

    expect(await screen.findByText('The operation failed. Check the server logs.')).toBeInTheDocument()
  })
})
