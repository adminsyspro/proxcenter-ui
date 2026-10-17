import React from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import BackupGroupsTable from './BackupGroupsTable'

afterEach(() => { cleanup(); vi.clearAllMocks() })

const older = { id: 'old', backupId: '100', backupType: 'vm', datastore: 'ds', namespace: '', vmName: 'previous-name', backupTime: 100, backupTimeIso: '1970-01-01T00:01:40Z' }
const newer = { ...older, id: 'new', vmName: 'current-name', backupTime: 200, backupTimeIso: '1970-01-01T00:03:20Z' }
const columns = [
  { field: 'backupId', headerName: 'ID' },
  { field: 'vmName', headerName: 'Name' },
  { field: 'backupTime', headerName: 'Date', renderCell: ({ row }: any) => row.backupTimeIso },
  { field: 'actions', headerName: '', sortable: false, renderCell: ({ row }: any) => <button onClick={() => restore(row)}>Restore {row.id}</button> },
]
const restore = vi.fn()
const props = { columns, loading: false, totalRows: 1, paginationModel: { page: 0, pageSize: 25 }, onPaginationModelChange: vi.fn(), onSnapshotClick: vi.fn(), t: (key: string) => key }

describe('BackupGroupsTable', () => {
  it('expands a machine, preserves newest-first order and sends the exact selected restore point', () => {
    render(<BackupGroupsTable {...props} backups={[older, newer]} pbsId='pbs1' />)
    expect(screen.queryByText(older.backupTimeIso)).not.toBeInTheDocument()
    const toggle = screen.getByRole('button', { name: /current-name/ })
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const rows = screen.getAllByRole('row')
    expect(within(rows[2]).getByText(newer.backupTimeIso)).toBeInTheDocument()
    expect(within(rows[3]).getByText(older.backupTimeIso)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Restore old' }))
    expect(restore).toHaveBeenCalledWith(older)
    fireEvent.click(toggle)
    expect(screen.queryByText(older.backupTimeIso)).not.toBeInTheDocument()
  })

  it('sorts machines by header, expands from the row and pages by machine', () => {
    const other = { ...older, id: 'z', backupId: '200', vmName: 'zeta' }
    const onPaginationModelChange = vi.fn()
    render(<BackupGroupsTable {...props} backups={[newer, other]} totalRows={60} pbsId='pbs1' onPaginationModelChange={onPaginationModelChange} />)
    const names = () => screen.getAllByRole('row').slice(1).map(row => row.textContent)
    expect(names()[0]).toContain('current-name')
    fireEvent.click(screen.getByText('Name'))
    expect(names()[0]).toContain('zeta')
    fireEvent.click(screen.getAllByRole('row')[1])
    expect(screen.getByRole('button', { name: 'Restore z' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /next page/i }))
    expect(onPaginationModelChange).toHaveBeenCalledWith({ page: 1, pageSize: 25 })
  })

  it('keeps equal IDs from different namespaces separate and resets expansion when the PBS changes', () => {
    const rows = [newer, { ...newer, id: 'other', namespace: 'tenant', vmName: 'other-name' }]
    const { rerender } = render(<BackupGroupsTable {...props} backups={rows} pbsId='pbs1' />)
    fireEvent.click(screen.getByRole('button', { name: /current-name/ }))
    expect(screen.queryByRole('button', { name: 'Restore other' })).not.toBeInTheDocument()
    rerender(<BackupGroupsTable {...props} backups={rows} pbsId='pbs2' />)
    expect(screen.queryByRole('button', { name: 'Restore new' })).not.toBeInTheDocument()
  })
})
