// src/lib/broadcast/contrast.ts
//
// WCAG 2.1 relative-luminance contrast ratio. The banner colours are free
// text typed by an admin, so the dialog warns before an unreadable pair is
// saved rather than restricting the palette.

/** WCAG AA for normal-size text. */
export const MIN_CONTRAST_RATIO = 4.5

/** Anchored, fixed length, no nested quantifier: S5852-safe. */
const HEX_SIX = /^#[0-9a-fA-F]{6}$/

function channelLuminance(value: number): number {
  const c = value / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function relativeLuminance(hex: string): number | null {
  if (!HEX_SIX.test(hex)) return null
  const r = Number.parseInt(hex.slice(1, 3), 16)
  const g = Number.parseInt(hex.slice(3, 5), 16)
  const b = Number.parseInt(hex.slice(5, 7), 16)
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b)
}

export function contrastRatio(hexA: string, hexB: string): number | null {
  const a = relativeLuminance(hexA)
  const b = relativeLuminance(hexB)
  if (a === null || b === null) return null
  const lighter = Math.max(a, b)
  const darker = Math.min(a, b)
  return (lighter + 0.05) / (darker + 0.05)
}
