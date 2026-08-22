import { describe, it, expect, afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { renderWithProviders } from '@/__tests__/setup/renderWithProviders'

const mockState = vi.hoisted(() => ({
  settings: {},
  branding: {},
}))

vi.mock('@core/hooks/useSettings', () => ({
  useSettings: () => ({ settings: mockState.settings, updateSettings: () => {} }),
}))

vi.mock('@/contexts/BrandingContext', () => ({
  useBranding: () => ({ branding: mockState.branding, loading: false }),
}))

import ThemeLogoWidget from './ThemeLogoWidget'

/**
 * The widget mirrors the navbar ThemeDropdown visuals: branding logo first,
 * then the ProxCenter logo for the default theme, then the theme's colored
 * badge. It must stay logo-only: no label, no app or theme name.
 */

// This project does not enable Vitest globals, so RTL's auto-cleanup is off.
afterEach(cleanup)

const render = ({ settings = {}, branding = {} } = {}) => {
  mockState.settings = settings
  mockState.branding = branding

  return renderWithProviders(<ThemeLogoWidget />)
}

describe('ThemeLogoWidget', () => {
  it('shows the ProxCenter logo for the default theme', () => {
    const { container } = render({ settings: { mode: 'light', primaryColor: '#E57000' } })

    expect(container.querySelector('svg')).toBeTruthy()
    expect(container.querySelector('img')).toBeNull()
  })

  it('falls back to the default theme when the primary color is unknown', () => {
    const { container } = render({ settings: { primaryColor: '#123456' } })

    expect(container.querySelector('svg')).toBeTruthy()
  })

  it('shows the colored badge with the theme icon for a named theme', () => {
    const { container } = render({ settings: { mode: 'dark', primaryColor: '#2092EC' } })

    expect(container.querySelector('i.ri-cloud-fill')).toBeTruthy()
    expect(container.querySelector('svg')).toBeNull()
  })

  it('prefers the custom branding logo over everything else', () => {
    const { container } = render({
      settings: { primaryColor: '#E57000' },
      branding: { logoUrl: '/api/v1/branding/assets/logo.png', appName: 'ACME Cloud' },
    })

    const img = container.querySelector('img')

    expect(img).toBeTruthy()
    expect(img.getAttribute('src')).toBe('/api/v1/branding/assets/logo.png')
    expect(img.getAttribute('alt')).toBe('ACME Cloud')
    expect(container.querySelector('svg')).toBeNull()
  })

  it('renders the logo alone, without any text', () => {
    const { container } = render({ settings: { primaryColor: '#2092EC' } })

    expect(container.textContent).toBe('')
  })
})
