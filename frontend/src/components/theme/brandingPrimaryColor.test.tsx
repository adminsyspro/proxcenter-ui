import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, cleanup, screen } from '@testing-library/react'
import { useTheme } from '@mui/material/styles'

// `@core/theme` pulls a Google font through the Next build pipeline at import time.
vi.mock('next/font/google', () => ({ Inter: () => ({ style: { fontFamily: 'Inter' } }) }))

const h = vi.hoisted(() => ({
  branding: { primaryColor: '' } as { primaryColor: string },
  settings: { mode: 'light', skin: 'default', primaryColor: '#E57000' } as Record<string, unknown>,
}))

vi.mock('@/contexts/BrandingContext', () => ({ useBranding: () => ({ branding: h.branding }) }))
vi.mock('@core/hooks/useSettings', () => ({ useSettings: () => ({ settings: h.settings }) }))
// ModeChanger reaches for MUI's colour-scheme machinery, which needs a mounted
// CssVarsProvider it does not get here; the palette is what this suite is about.
vi.mock('./ModeChanger', () => ({ default: () => null }))

import CustomThemeProvider from './index'

// The RTL harness in this suite has no automatic cleanup.
afterEach(cleanup)

beforeEach(() => {
  h.branding = { primaryColor: '' }
  h.settings = { mode: 'light', skin: 'default', primaryColor: '#E57000' }
})

/**
 * jsdom never resolves the CSS variables MUI emits (`cssVariables` is on in
 * this provider), so a rendered button only ever reports
 * `var(--variant-containedBg)`. Reading the palette the provider built is the
 * assertion that actually means something here.
 */
const PaletteProbe = () => {
  const theme = useTheme() as any

  return <output>{theme.colorSchemes.light.palette.primary.main}</output>
}

const renderWithBrandingColor = (primaryColor: string) => {
  h.branding = { primaryColor }

  return render(
    <CustomThemeProvider direction='ltr' systemMode='light'>
      <PaletteProbe />
    </CustomThemeProvider>
  )
}

const resolvedPrimary = () => screen.getByRole('status').textContent

describe('branding primary colour reaching the palette (#754)', () => {
  it('reproduces the defect at its source: MUI throws on a colour without its hash', async () => {
    const { lighten } = await import('@mui/material/styles')

    expect(() => lighten('00ECB2', 0.2)).toThrow(/Unsupported/)
  })

  it('renders instead of throwing when the stored colour lost its hash', () => {
    expect(() => renderWithBrandingColor('00ECB2')).not.toThrow()
  })

  it('applies the colour the administrator meant', () => {
    renderWithBrandingColor('00ECB2')

    expect(resolvedPrimary()).toBe('#00ECB2')
  })

  it.each(['turquoise', '#ZZZZZZ', '#00EC', '#00-CB2'])(
    'falls back to the user palette instead of breaking on %s',
    value => {
      expect(() => renderWithBrandingColor(value)).not.toThrow()
      expect(resolvedPrimary()).toBe('#E57000')
    }
  )

  it('honours a well-formed branding colour over the user setting', () => {
    renderWithBrandingColor('#00ECB2')

    expect(resolvedPrimary()).toBe('#00ECB2')
  })

  it('keeps the user setting when branding sets no colour', () => {
    renderWithBrandingColor('')

    expect(resolvedPrimary()).toBe('#E57000')
  })

  it('survives a user setting that is itself unusable', () => {
    h.settings = { mode: 'light', skin: 'default', primaryColor: 'not-a-colour' }

    expect(() => renderWithBrandingColor('')).not.toThrow()
    expect(resolvedPrimary()).toBe('#E57000')
  })
})
