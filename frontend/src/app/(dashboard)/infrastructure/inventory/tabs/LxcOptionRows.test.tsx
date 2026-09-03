import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen, fireEvent } from '@/__tests__/setup/renderWithProviders'

import LxcOptionRows from './LxcOptionRows'

/* Rows live inside the Options <table>, so the harness gives them a tbody. */
function renderRows(props: Partial<React.ComponentProps<typeof LxcOptionRows>> = {}) {
  const onEdit = vi.fn()
  const pendingChip = props.pendingChip ?? (() => null)

  renderWithProviders(
    <table>
      <tbody>
        <LxcOptionRows optionsInfo={props.optionsInfo} pendingChip={pendingChip} onEdit={props.onEdit ?? onEdit} />
      </tbody>
    </table>,
  )

  return { onEdit }
}

describe('LxcOptionRows (#566)', () => {
  afterEach(() => cleanup())

  it('lists the enabled features as chips and shows the privilege level read-only', () => {
    renderRows({ optionsInfo: { unprivileged: true, features: 'nesting=1,mount=nfs;cifs' } })

    expect(screen.getByText('Nesting')).toBeInTheDocument()
    expect(screen.getByText('NFS')).toBeInTheDocument()
    expect(screen.getByText('SMB/CIFS')).toBeInTheDocument()
    expect(screen.queryByText('keyctl')).toBeNull()
    expect(screen.queryByText('FUSE')).toBeNull()
    expect(screen.getByText('Yes')).toBeInTheDocument()

    const buttons = screen.getAllByRole('button')
    // The privilege lock is disabled: only the Features pencil is actionable.
    const enabledButtons = buttons.filter(b => !(b as HTMLButtonElement).disabled)
    expect(enabledButtons).toHaveLength(1)
  })

  it('shows "None" when the container has no feature and "No" for a privileged one', () => {
    renderRows({ optionsInfo: { unprivileged: false, features: '' } })

    expect(screen.getByText('None')).toBeInTheDocument()
    expect(screen.getByText('No')).toBeInTheDocument()
  })

  it('opens the features editor with the raw PVE string as value', () => {
    const { onEdit } = renderRows({ optionsInfo: { unprivileged: true, features: 'keyctl=1,fuse=1' } })

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))

    expect(onEdit).toHaveBeenCalledWith({ key: 'features', label: 'Features', value: 'keyctl=1,fuse=1', type: 'features', unprivileged: true })
  })

  it('renders the pending-restart marker of the features row', () => {
    renderRows({
      optionsInfo: { unprivileged: true, features: 'nesting=1' },
      pendingChip: (key: string) => (key === 'features' ? <span data-testid="pending-features" /> : null),
    })

    expect(screen.getByTestId('pending-features')).toBeInTheDocument()
  })
})
