import { cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { renderWithProviders, screen, userEvent } from '@/__tests__/setup/renderWithProviders'

import DeleteConfirmDialog from './DeleteConfirmDialog'

afterEach(cleanup)

describe('DeleteConfirmDialog', () => {
  it('asks in a modal and confirms or cancels from its buttons', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    const onClose = vi.fn()

    renderWithProviders(<DeleteConfirmDialog open title='Delete policy' message='Sure?' busy={false} error={null} onConfirm={onConfirm} onClose={onClose} />)

    expect(screen.getByRole('dialog')).toHaveTextContent('Sure?')

    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(onConfirm).toHaveBeenCalledOnce()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('shows the error and locks the buttons while busy', () => {
    renderWithProviders(<DeleteConfirmDialog open title='t' message='m' busy error='Failed' onConfirm={() => {}} onClose={() => {}} />)

    expect(screen.getByRole('alert')).toHaveTextContent('Failed')
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled()
  })
})
