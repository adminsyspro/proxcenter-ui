import React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen } from '@/__tests__/setup/renderWithProviders'

import MigrationVmGlyph, { migrationPastilleColor, sourceVmIcon } from './MigrationVmGlyph'

describe('MigrationVmGlyph (roadmap#53)', () => {
  afterEach(cleanup)

  it('colours the pastille by job state and picks the source VM icon', () => {
    expect(['completed', 'failed', 'cancelled', 'full_copy'].map(migrationPastilleColor)).toEqual(['#4caf50', '#f44336', '#ff9800', '#2196f3'])
    expect(sourceVmIcon('vmware')).toBe('/images/esxi-vm.svg')
    expect(sourceVmIcon('vcenter')).toBe('/images/esxi-vm.svg')
    expect(sourceVmIcon('xcpng')).toBeNull()
  })

  it('draws the ESXi VM icon for VMware, a generic VM icon otherwise', () => {
    const { container } = renderWithProviders(<><MigrationVmGlyph hostType="vcenter" status="completed" /><MigrationVmGlyph hostType="hyperv" status="failed" size={18} /></>)
    const glyphs = screen.getAllByTestId('migration-vm-glyph')
    expect(glyphs.map(g => g.getAttribute('data-status'))).toEqual(['completed', 'failed'])
    expect(glyphs[0].querySelector('img')).toHaveAttribute('src', '/images/esxi-vm.svg')
    expect(glyphs[1].querySelector('img')).toBeNull()
    expect(container.querySelector('.ri-computer-line')).not.toBeNull()
  })
})
