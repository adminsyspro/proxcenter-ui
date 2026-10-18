import React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen } from '@/__tests__/setup/renderWithProviders'

import GuestOsLogo from './GuestOsLogo'

describe('GuestOsLogo (roadmap#53)', () => {
  afterEach(cleanup)

  it('draws the coloured vendor logo as an image', () => {
    renderWithProviders(<GuestOsLogo guestOs="Microsoft Windows Server 2022 (64-bit)" />)
    expect(screen.getByTestId('guest-os-logo')).toHaveAttribute('src', '/images/vendors/windows.svg')
  })

  it('paints a monochrome OS icon through a mask', () => {
    renderWithProviders(<GuestOsLogo guestOs="Other 3.x or later Linux (64-bit)" size={20} />)
    const logo = screen.getByTestId('guest-os-logo')
    expect(logo.tagName).toBe('SPAN')
    expect(logo).toHaveAttribute('data-src', '/images/os/linux.svg')
  })

  it('falls back to a neutral icon for an unknown OS', () => {
    const { container } = renderWithProviders(<GuestOsLogo guestOs="Other (32-bit)" />)
    expect(screen.queryByTestId('guest-os-logo')).toBeNull()
    expect(container.querySelector('.ri-question-line')).not.toBeNull()
  })
})
