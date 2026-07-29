import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen } from '@/__tests__/setup/renderWithProviders'
import { TOP_BANNER_HEIGHT_VAR } from './bannerHeight'

const { broadcastsMock } = vi.hoisted(() => ({ broadcastsMock: vi.fn() }))

vi.mock('@/hooks/useBroadcasts', () => ({ useBroadcasts: () => broadcastsMock() }))

const banner = (id: string) => ({
  id,
  message: `message ${id}`,
  linkUrl: null,
  linkLabel: null,
  bgColor: '#f59e0b',
  fgColor: '#000000',
  dismissible: true,
  updatedAt: '2026-08-01T10:00:00.000Z',
})

beforeEach(() => {
  localStorage.clear()
  broadcastsMock.mockReset().mockReturnValue({ banners: [], isLoading: false })
  delete process.env.NEXT_PUBLIC_DEMO_MODE
  document.documentElement.style.removeProperty(TOP_BANNER_HEIGHT_VAR)
})

afterEach(() => {
  delete process.env.NEXT_PUBLIC_DEMO_MODE
  cleanup()
})

describe('TopBannerStack', () => {
  it('renders nothing and leaves the layout variable unset when there is no banner', async () => {
    const TopBannerStack = (await import('./TopBannerStack')).default
    const { container } = renderWithProviders(<TopBannerStack />)
    expect(container).toBeEmptyDOMElement()
    // The CSS fallback var(--top-banner-height, 0px) must be what applies,
    // otherwise every dashboard page shifts for nothing.
    expect(document.documentElement.style.getPropertyValue(TOP_BANNER_HEIGHT_VAR)).toBe('')
  })

  it('renders one row per active banner', async () => {
    broadcastsMock.mockReturnValue({ banners: [banner('a'), banner('b')], isLoading: false })
    const TopBannerStack = (await import('./TopBannerStack')).default
    renderWithProviders(<TopBannerStack />)
    expect(screen.getByText('message a')).toBeInTheDocument()
    expect(screen.getByText('message b')).toBeInTheDocument()
  })

  it('keeps rendering the demo row when demo mode is on', async () => {
    process.env.NEXT_PUBLIC_DEMO_MODE = 'true'
    vi.resetModules()
    const TopBannerStack = (await import('./TopBannerStack')).default
    renderWithProviders(<TopBannerStack />)
    expect(screen.getByText(/Demo Mode/)).toBeInTheDocument()
  })

  it('shows the demo row and a broadcast together without either disappearing', async () => {
    process.env.NEXT_PUBLIC_DEMO_MODE = 'true'
    broadcastsMock.mockReturnValue({ banners: [banner('a')], isLoading: false })
    vi.resetModules()
    const TopBannerStack = (await import('./TopBannerStack')).default
    renderWithProviders(<TopBannerStack />)
    expect(screen.getByText(/Demo Mode/)).toBeInTheDocument()
    expect(screen.getByText('message a')).toBeInTheDocument()
  })

  it('clears the layout variable on unmount', async () => {
    broadcastsMock.mockReturnValue({ banners: [banner('a')], isLoading: false })
    const TopBannerStack = (await import('./TopBannerStack')).default
    const { unmount } = renderWithProviders(<TopBannerStack />)
    unmount()
    expect(document.documentElement.style.getPropertyValue(TOP_BANNER_HEIGHT_VAR)).toBe('')
  })
})
