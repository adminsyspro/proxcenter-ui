import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

import { NodeGlyph, OsdGlyph, nodeStatusColor, osdStatusColor } from './glyphs'

afterEach(cleanup)

const rgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16)

  return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`
}

describe('NodeGlyph', () => {
  it('draws the Proxmox logo of the theme with the status dot', () => {
    const { container, rerender } = render(<NodeGlyph status='online' dark={false} dotBorder='#fff' />)

    expect(container.querySelector('img')).toHaveAttribute('src', '/images/proxmox-logo.svg')
    rerender(<NodeGlyph status='online' dark dotBorder='#fff' />)
    expect(container.querySelector('img')).toHaveAttribute('src', '/images/proxmox-logo-dark.svg')
  })

  it('colours the dot by node status', () => {
    expect(nodeStatusColor('online')).toBe('#4caf50')
    expect(nodeStatusColor('unknown')).toBe('#9e9e9e')
    expect(nodeStatusColor(undefined)).toBe('#9e9e9e')
    expect(nodeStatusColor('maintenance')).toBe('#ff9800')
    expect(nodeStatusColor('offline')).toBe('#f44336')
  })
})

describe('OsdGlyph labels', () => {
  it('names the state for assistive tech and hides the decorative icon', () => {
    const { container } = render(<OsdGlyph osd={{ up: true, in: false }} dotBorder='#fff' label='up and out' />)

    expect(screen.getByRole('img', { name: 'up and out' })).toBeInTheDocument()
    expect(container.querySelector('i')).toHaveAttribute('aria-hidden', 'true')
  })
})

describe('OsdGlyph', () => {
  it.each([
    [{ up: true, in: true }, '#4caf50'],
    [{ up: true, in: false }, '#ff9800'],
    [{ up: false, in: true }, '#f44336'],
    [undefined, '#616161'],
  ])('draws the disk icon with the dot of %j', (osd, color) => {
    const { container } = render(<OsdGlyph osd={osd} dotBorder='#fff' />)

    expect(container.querySelector('i.ri-hard-drive-2-line')).not.toBeNull()
    expect(screen.getByTestId('osd-glyph-dot')).toHaveStyle({ backgroundColor: rgb(color) })
    expect(osdStatusColor(osd)).toBe(color)
  })
})
