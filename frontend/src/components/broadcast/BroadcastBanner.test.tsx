import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen, fireEvent } from '@/__tests__/setup/renderWithProviders'
import BroadcastBanner from './BroadcastBanner'

const banner = (over: Record<string, unknown> = {}) => ({
  id: 'b1',
  message: 'Maintenance Saturday 22:00 UTC 🛠️',
  linkUrl: null,
  linkLabel: null,
  bgColor: '#f59e0b',
  fgColor: '#000000',
  dismissible: true,
  updatedAt: '2026-08-01T10:00:00.000Z',
  ...over,
})

describe('BroadcastBanner', () => {
  afterEach(() => cleanup())

  it('renders the message text verbatim, emoji included', () => {
    renderWithProviders(<BroadcastBanner banner={banner()} onDismiss={() => {}} />)
    expect(screen.getByText('Maintenance Saturday 22:00 UTC 🛠️')).toBeInTheDocument()
  })

  it('renders no link when the banner has none', () => {
    renderWithProviders(<BroadcastBanner banner={banner()} onDismiss={() => {}} />)
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('renders the link with its label when present', () => {
    renderWithProviders(
      <BroadcastBanner banner={banner({ linkUrl: '/status', linkLabel: 'Status page' })} onDismiss={() => {}} />,
    )
    const link = screen.getByRole('link', { name: 'Status page' })
    expect(link).toHaveAttribute('href', '/status')
  })

  it('calls onDismiss with the banner when the close button is used', () => {
    const onDismiss = vi.fn()
    const b = banner()
    renderWithProviders(<BroadcastBanner banner={b} onDismiss={onDismiss} />)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onDismiss).toHaveBeenCalledWith(b)
  })

  it('hides the close button when the banner is not dismissible', () => {
    renderWithProviders(<BroadcastBanner banner={banner({ dismissible: false })} onDismiss={() => {}} />)
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull()
  })

  it('does not interpret markup in the message', () => {
    renderWithProviders(<BroadcastBanner banner={banner({ message: '<b>bold</b>' })} onDismiss={() => {}} />)
    expect(screen.getByText('<b>bold</b>')).toBeInTheDocument()
    expect(document.querySelector('b')).toBeNull()
  })

  it('renders no link when the linkUrl scheme is unsafe', () => {
    renderWithProviders(
      <BroadcastBanner
        banner={banner({ linkUrl: 'javascript:alert(1)', linkLabel: 'Click me' })}
        onDismiss={() => {}}
      />,
    )
    expect(screen.getByText('Maintenance Saturday 22:00 UTC 🛠️')).toBeInTheDocument()
    expect(screen.queryByRole('link')).toBeNull()
  })
})
