import { alpha, darken, lighten, type Theme } from '@mui/material'

import type { MicrosegZone } from '@/lib/microseg/types'

import { ZONE_COLORS } from './zoneForm'

const ZONE_OBJECT_PREFIX = 'pcz-'

/** The zone palette without its grey, plus four more hues, so a set outside the zones never looks inert. */
export const OBJECT_PALETTE: readonly string[] = [
  ...ZONE_COLORS.filter(c => c !== '#64748b'), '#06b6d4', '#f97316', '#6366f1', '#84cc16',
]

/** FNV-1a: the same text always gives the same number, on every visit and every machine. */
function hash(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h
}

/**
 * The colour of a firewall object (IP set, security group, alias): the colour of its zone for `pcz-<zone>`, otherwise
 * a colour taken from the palette by a hash of the name, so it never changes between visits.
 */
export function objectColour(name: string, zones: readonly Pick<MicrosegZone, 'name' | 'color'>[] = []): string {
  if (name.startsWith(ZONE_OBJECT_PREFIX)) {
    const zone = zones.find(z => z.name === name.slice(ZONE_OBJECT_PREFIX.length))
    if (zone?.color) return zone.color
  }
  return OBJECT_PALETTE[hash(name) % OBJECT_PALETTE.length]
}

/** How far the text colour moves away from the palette hue, for its contrast on the paper of each theme. */
export const TEXT_DARKEN_LIGHT = 0.4
export const TEXT_LIGHTEN_DARK = 0.25

/** The colour as text: darkened on a light theme, lightened on a dark one, so every hue (amber, lime, indigo) stays readable. */
export const objectTextColour = (colour: string, theme: Theme) => (
  theme.palette.mode === 'dark' ? lighten(colour, TEXT_LIGHTEN_DARK) : darken(colour, TEXT_DARKEN_LIGHT)
)

/** An outlined chip in the colour of its object: colour border and text, a light tint behind. */
export const objectChipSx = (colour: string, theme: Theme) => ({
  borderColor: colour,
  color: objectTextColour(colour, theme),
  bgcolor: alpha(colour, 0.08),
  '& .MuiChip-deleteIcon': { fontSize: 16, color: alpha(objectTextColour(colour, theme), 0.7) },
})

/** A small round dot in the colour of an object, in front of its name. */
export const objectDotSx = (colour: string) => ({ width: 10, height: 10, borderRadius: '50%', bgcolor: colour, flexShrink: 0 })
