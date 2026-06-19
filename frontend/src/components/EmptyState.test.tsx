import { describe, it, expect, vi } from 'vitest'
import { renderWithProviders, screen, userEvent } from '@/__tests__/setup/renderWithProviders'
import EmptyState from './EmptyState'

describe('EmptyState', () => {
  it('renders the title and description from props', () => {
    renderWithProviders(<EmptyState title="No connections" description="Add one to begin" />)
    expect(screen.getByText('No connections')).toBeInTheDocument()
    expect(screen.getByText('Add one to begin')).toBeInTheDocument()
  })

  it('renders an action button and forwards clicks', async () => {
    const onClick = vi.fn()
    renderWithProviders(
      <EmptyState title="Empty" action={{ label: 'Create', onClick }} />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('renders without an action or description (props optional)', () => {
    renderWithProviders(<EmptyState title="Just a title" />)
    expect(screen.getByText('Just a title')).toBeInTheDocument()
  })
})
