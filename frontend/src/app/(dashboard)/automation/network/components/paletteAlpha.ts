import { alpha } from '@mui/material/styles'
import type { Theme } from '@mui/material/styles'

export type PaletteAlphaKey = 'divider' | 'text.primary' | 'text.secondary'

/*
 * In the dark colour scheme the palette divider and text entries are CSS variable
 * strings (rgb(var(--mui-mainColorChannels-dark) / 0.12)): alpha() cannot parse
 * them and returns rgba(NaN, , , x), which the browser drops (the border falls
 * back to currentColor). The channel tokens recolour them correctly; without
 * CSS variables the palette entries are plain hex and alpha() works.
 */
export function paletteAlpha(theme: Theme, key: PaletteAlphaKey, a: number): string {
  const vars = theme.vars?.palette
  if (vars) {
    const channel = key === 'divider' ? vars.dividerChannel : key === 'text.primary' ? vars.text.primaryChannel : vars.text.secondaryChannel
    if (channel) return `rgb(${channel} / ${a})`
  }
  const base = key === 'divider' ? theme.palette.divider : key === 'text.primary' ? theme.palette.text.primary : theme.palette.text.secondary
  return alpha(base, a)
}
