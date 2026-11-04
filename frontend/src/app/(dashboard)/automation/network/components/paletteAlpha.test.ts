import { describe, expect, it } from 'vitest'
import type { Theme } from '@mui/material/styles'

import { paletteAlpha } from './paletteAlpha'

const hexTheme = { palette: { divider: '#E2E8F0', text: { primary: '#1E293B', secondary: '#475569' } } } as unknown as Theme

const varsTheme = {
  palette: { divider: 'rgb(var(--mui-mainColorChannels-dark) / 0.12)', text: { primary: 'rgb(var(--mui-mainColorChannels-dark) / 0.9)', secondary: 'rgb(var(--mui-mainColorChannels-dark) / 0.7)' } },
  vars: { palette: { dividerChannel: 'var(--mui-mainColorChannels-dark)', text: { primaryChannel: 'var(--mui-mainColorChannels-dark)', secondaryChannel: 'var(--mui-mainColorChannels-dark)' } } }
} as unknown as Theme

describe('paletteAlpha', () => {
  it('uses the channel tokens when CSS variables are present', () => {
    expect(paletteAlpha(varsTheme, 'divider', 0.4)).toBe('rgb(var(--mui-mainColorChannels-dark) / 0.4)')
    expect(paletteAlpha(varsTheme, 'text.primary', 0.06)).toBe('rgb(var(--mui-mainColorChannels-dark) / 0.06)')
    expect(paletteAlpha(varsTheme, 'text.secondary', 0.5)).toBe('rgb(var(--mui-mainColorChannels-dark) / 0.5)')
  })

  it('falls back to alpha() of the hex entry without CSS variables', () => {
    expect(paletteAlpha(hexTheme, 'divider', 0.4)).toBe('rgba(226, 232, 240, 0.4)')
    expect(paletteAlpha(hexTheme, 'text.primary', 0.5)).toBe('rgba(30, 41, 59, 0.5)')
    expect(paletteAlpha(hexTheme, 'text.secondary', 0.5)).toBe('rgba(71, 85, 105, 0.5)')
  })
})
