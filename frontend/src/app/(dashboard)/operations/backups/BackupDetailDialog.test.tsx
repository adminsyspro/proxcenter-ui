import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import BackupDetailDialog from './BackupDetailDialog'

afterEach(() => { cleanup(); vi.clearAllMocks() })

const newer = {
  id: 'ds/vm/101/200', datastore: 'ds', namespace: '', backupType: 'vm', backupId: '101', vmName: 'web-01',
  backupTime: 200, backupTimeIso: '1970-01-01T00:03:20Z', sizeFormatted: '20 GiB', fileCount: 2, owner: 'root@pam',
  verified: true, verification: { state: 'ok', 'last-run': 300 }, protected: false, comment: 'nightly',
  files: [
    { filename: 'drive-scsi0.img.fidx', 'crypt-mode': 'encrypt', size: 1024 },
    { filename: 'client.log.blob' },
  ],
}
const older = { ...newer, id: 'ds/vm/101/100', backupTime: 100, backupTimeIso: '1970-01-01T00:01:40Z', verified: false, verification: { state: 'failed' }, protected: true, files: [], comment: '' }
const base = {
  open: true, onClose: vi.fn(), points: [newer, older], onSelectPoint: vi.fn(), tab: 0, onTabChange: vi.fn(),
  showExplorer: true, explorer: <div>explorer-panel</div>, vdc: null, typeChip: null,
  onRestore: vi.fn(), onVerify: vi.fn(), verifying: false, onDelete: vi.fn(), deleting: false, deleteAwaitingConfirm: false,
  timeAgo: () => 'ago', t: (key: string) => key, locale: 'en',
}

describe('BackupDetailDialog', () => {
  it('lists the machine restore points and switches to the exact one clicked', () => {
    render(<BackupDetailDialog {...base} backup={newer} />)
    const nav = screen.getByRole('navigation', { name: 'backups.restorePoints' })
    const items = within(nav).getAllByRole('button')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveAttribute('aria-current', 'true')
    expect(within(items[0]).getByText('backups.latestPoint')).toBeInTheDocument()
    expect(within(items[1]).getByLabelText('backups.protected')).toBeInTheDocument()
    expect(within(items[1]).getByLabelText('backups.verifyFailed')).toBeInTheDocument()
    fireEvent.click(items[1])
    expect(base.onSelectPoint).toHaveBeenCalledWith(older)
  })

  it('shows identity, archives with their encryption and copies the PBS snapshot path', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    render(<BackupDetailDialog {...base} backup={newer} vdc={{ vdcName: 'prod', tenantName: 'acme' }} />)
    expect(screen.getByText('prod (acme)')).toBeInTheDocument()
    expect(screen.getByText('backups.rootNamespace')).toBeInTheDocument()
    expect(screen.getByText('nightly')).toBeInTheDocument()
    const archive = screen.getByText('drive-scsi0.img.fidx').closest('tr') as HTMLElement
    expect(within(archive).getByText('backups.cryptEncrypt')).toBeInTheDocument()
    expect(within(archive).getByText('1 KiB')).toBeInTheDocument()
    const log = screen.getByText('client.log.blob').closest('tr') as HTMLElement
    expect(within(log).getAllByText('-')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'common.copy' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('vm/101/1970-01-01T00:03:20Z'))
  })

  it('wires the actions and guards protected, host and confirm states', () => {
    const { rerender } = render(<BackupDetailDialog {...base} backup={newer} />)
    fireEvent.click(screen.getByRole('button', { name: 'audit.actions.restore' }))
    fireEvent.click(screen.getByRole('button', { name: 'backups.verifyAction' }))
    fireEvent.click(screen.getByRole('button', { name: 'common.delete' }))
    fireEvent.click(screen.getByRole('button', { name: 'common.close' }))
    expect(base.onRestore).toHaveBeenCalled()
    expect(base.onVerify).toHaveBeenCalled()
    expect(base.onDelete).toHaveBeenCalled()
    expect(base.onClose).toHaveBeenCalled()

    rerender(<BackupDetailDialog {...base} backup={newer} deleteAwaitingConfirm />)
    expect(screen.getByRole('button', { name: 'backups.deleteConfirmButton' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('backups.deleteConfirm')

    rerender(<BackupDetailDialog {...base} backup={{ ...older, backupType: 'host', vmName: '' }} />)
    expect(screen.getByRole('button', { name: 'common.delete' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'audit.actions.restore' })).toBeDisabled()
    expect(screen.getByText('backups.deleteProtectedHint')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'host/101' })).toBeInTheDocument()
  })

  it('renders the explorer tab content and hides that tab from tenants', () => {
    const { rerender } = render(<BackupDetailDialog {...base} backup={newer} tab={1} />)
    expect(screen.getByText('explorer-panel')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'backups.informations' }))
    expect(base.onTabChange).toHaveBeenCalledWith(0)
    rerender(<BackupDetailDialog {...base} backup={newer} showExplorer={false} />)
    expect(screen.queryByRole('tab', { name: 'backups.explorer' })).not.toBeInTheDocument()
  })

  it('shows a relative age only for restore points younger than a week', () => {
    const now = Math.floor(Date.now() / 1000)
    const fresh = { ...newer, id: 'fresh', backupTime: now - 3600 }
    render(<BackupDetailDialog {...base} backup={fresh} points={[fresh, newer]} />)
    const items = within(screen.getByRole('navigation')).getAllByRole('button')
    expect(items[0]).toHaveTextContent('ago · 20 GiB')
    expect(items[1]).not.toHaveTextContent('ago')
    expect(screen.getByText('(ago)', { exact: false })).toBeInTheDocument()
  })

  it('renders nothing without a selected backup', () => {
    render(<BackupDetailDialog {...base} backup={null} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
