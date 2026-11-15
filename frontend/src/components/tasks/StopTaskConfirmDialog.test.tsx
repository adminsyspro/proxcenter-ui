/**
 * Stopping a migration from the task bar or the Task Center asks the same
 * question as its migrate dialog: a warm run offers to remove its copy on the
 * target, ticked by default (CancelMigrationDialog).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

import StopTaskConfirmDialog from './StopTaskConfirmDialog'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => (values ? `${key}:${JSON.stringify(values)}` : key),
}))

afterEach(() => cleanup())

describe('StopTaskConfirmDialog', () => {
  it('offers to remove the copy of a warm migration, ticked, and passes the choice on', () => {
    const onConfirm = vi.fn()
    render(<StopTaskConfirmDialog open migration={{ migrationType: 'warm', targetVmid: 118 }} onKeep={vi.fn()} onConfirm={onConfirm} />)

    const box = screen.getByRole('checkbox')
    expect(box).toBeChecked()
    expect(screen.getByText('inventoryPage.esxiMigration.cancelMigrationRemoveTarget:{"vmid":118}')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'inventoryPage.esxiMigration.cancelMigration' }))
    expect(onConfirm).toHaveBeenLastCalledWith({ removeTarget: true })

    fireEvent.click(box)
    fireEvent.click(screen.getByRole('button', { name: 'inventoryPage.esxiMigration.cancelMigration' }))
    expect(onConfirm).toHaveBeenLastCalledWith({ removeTarget: false })
  })

  it('has nothing to offer for a migration that is not warm', () => {
    const onConfirm = vi.fn()
    render(<StopTaskConfirmDialog open migration={{ migrationType: 'cold', targetVmid: 118 }} onKeep={vi.fn()} onConfirm={onConfirm} />)

    expect(screen.queryByRole('checkbox')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'inventoryPage.esxiMigration.cancelMigration' }))
    expect(onConfirm).toHaveBeenLastCalledWith({ removeTarget: false })
  })

  it('keeps the generic question for any other task', () => {
    const onKeep = vi.fn()
    render(<StopTaskConfirmDialog open body="Stop it?" onKeep={onKeep} onConfirm={vi.fn()} />)

    expect(screen.getByText('Stop it?')).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'tasks.stop.keep' }))
    expect(onKeep).toHaveBeenCalled()
  })
})
