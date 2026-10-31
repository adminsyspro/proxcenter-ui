import { cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { renderWithProviders } from '@/__tests__/setup/renderWithProviders'

import RowGlyph, { GlyphIcon, PROXMOX } from './RowGlyph'

afterEach(cleanup)

describe('RowGlyph', () => {
  it('draws a node with the Proxmox logo, not a server icon', () => {
    const { container } = renderWithProviders(<RowGlyph kind='node' state='up' />)

    expect(container.querySelector('img')?.getAttribute('src')).toMatch(/proxmox-logo/)
    expect(container.querySelector('i')).toBeNull()
  })

  it.each([
    ['cluster', undefined, 'ri-server-line'],
    ['guest', 'qemu', 'ri-computer-line'],
    ['guest', 'lxc', 'ri-instance-line'],
  ] as const)('draws a %s (%s) with %s', (kind, guestType, icon) => {
    const { container } = renderWithProviders(<RowGlyph kind={kind} guestType={guestType} state='down' />)

    expect(container.querySelector('i')).toHaveClass(icon)
    expect(container.querySelector('img')).toBeNull()
  })
})

describe('GlyphIcon', () => {
  it('renders the Proxmox logo for PROXMOX and the Remix class otherwise', () => {
    const logo = renderWithProviders(<GlyphIcon icon={PROXMOX} />)
    expect(logo.container.querySelector('img')).not.toBeNull()
    cleanup()

    const icon = renderWithProviders(<GlyphIcon icon='ri-server-line' />)
    expect(icon.container.querySelector('i')).toHaveClass('ri-server-line')
  })
})
