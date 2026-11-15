/**
 * The confirmation of a migration cancel, from the migrate dialog and the VM
 * panel: a warm migration offers to remove what it copied on the target.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { fireEvent, renderWithProviders, screen } from '@/__tests__/setup/renderWithProviders'

import CancelMigrationDialog from './CancelMigrationDialog'

const warm = { targetVmid: 117, config: { migrationType: 'warm' } }
const KEPT = /A target volume that already holds a completed copy is kept/

describe('CancelMigrationDialog', () => {
  afterEach(cleanup)

  it('offers to remove the target VM and its copy, ticked, for a warm migration', () => {
    const onConfirm = vi.fn()
    renderWithProviders(<CancelMigrationDialog open job={warm} onClose={vi.fn()} onConfirm={onConfirm} />)
    expect(screen.getByRole('checkbox', { name: 'Also remove VM 117 and its copy on the target' })).toBeChecked()
    expect(screen.queryByText(KEPT)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel Migration' }))
    expect(onConfirm).toHaveBeenCalledWith(true)
  })

  it('keeps the copy, and says so, once unticked', () => {
    const onConfirm = vi.fn()
    renderWithProviders(<CancelMigrationDialog open job={warm} onClose={vi.fn()} onConfirm={onConfirm} />)
    fireEvent.click(screen.getByRole('checkbox'))
    expect(screen.getByText(KEPT)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel Migration' }))
    expect(onConfirm).toHaveBeenCalledWith(false)
  })

  it('names no VM before the target VM exists', () => {
    renderWithProviders(<CancelMigrationDialog open job={{ targetVmid: null, config: { migrationType: 'warm' } }} onClose={vi.fn()} onConfirm={vi.fn()} />)
    expect(screen.getByRole('checkbox', { name: 'Also remove the copy on the target' })).toBeChecked()
  })

  it('offers nothing to remove for a cold migration, and keeps the warning', () => {
    const onConfirm = vi.fn()
    renderWithProviders(<CancelMigrationDialog open job={{ targetVmid: 117, config: { migrationType: 'cold' } }} onClose={vi.fn()} onConfirm={onConfirm} />)
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.getByText(KEPT)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel Migration' }))
    expect(onConfirm).toHaveBeenCalledWith(false)
  })

  it('keeps migrating on the other button', () => {
    const onClose = vi.fn()
    renderWithProviders(<CancelMigrationDialog open job={warm} onClose={onClose} onConfirm={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Keep migrating' }))
    expect(onClose).toHaveBeenCalled()
  })
})
