/**
 * On-primary text helpers.
 *
 * The primary colour is user-configurable (White Label branding colour and the
 * theme colour picker), so anything drawn ON a primary-coloured surface has to
 * pick its text colour from the background, not from a fixed white.
 *
 * MUI already does this for `palette.primary.contrastText`: `createTheme`
 * computes it from `primary.main` whenever the value is absent, which is the
 * case here (see `@core/theme/colorSchemes.js`). Use the `primary.contrastText`
 * token wherever the surface is `primary.main`.
 *
 * These helpers cover the two cases the token cannot serve:
 *  - a surface painted with a *derived* shade (`primary.light`), for which
 *    `contrastText` (computed against `main`) can be the wrong answer;
 *  - HTML generated outside of MUI, e.g. the exported compliance reports.
 *
 * The threshold (3) and the two output colours match MUI's own defaults, so a
 * surface fixed with `onPrimaryTextColor` and one relying on `contrastText`
 * always agree.
 */

/** Text colour MUI uses on a dark background. */
export const ON_PRIMARY_LIGHT_TEXT = '#fff'

/** Text colour MUI uses on a light background. */
export const ON_PRIMARY_DARK_TEXT = 'rgba(0, 0, 0, 0.87)'

/** MUI's default `palette.contrastThreshold`. */
export const CONTRAST_THRESHOLD = 3

const HEX = /^#([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i
const RGB = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i

/** Parses `#rgb`, `#rrggbb` (with optional alpha) and `rgb()`/`rgba()`. */
const toRgb = (color: string): [number, number, number] | null => {
  const value = color.trim()

  if (HEX.test(value)) {
    const hex = value.slice(1)
    const expand = hex.length <= 4 ? hex.slice(0, 3).replace(/./g, c => c + c) : hex.slice(0, 6)

    return [
      parseInt(expand.slice(0, 2), 16),
      parseInt(expand.slice(2, 4), 16),
      parseInt(expand.slice(4, 6), 16)
    ]
  }

  const rgb = RGB.exec(value)

  if (!rgb) return null

  const channels = [rgb[1], rgb[2], rgb[3]].map(Number)

  return channels.some(c => Number.isNaN(c) || c < 0 || c > 255) ? null : (channels as [number, number, number])
}

const linearise = (channel: number) => {
  const ratio = channel / 255

  return ratio <= 0.03928 ? ratio / 12.92 : ((ratio + 0.055) / 1.055) ** 2.4
}

/** WCAG relative luminance, or `null` when the colour cannot be parsed. */
export const relativeLuminance = (color: string): number | null => {
  const rgb = toRgb(color)

  if (!rgb) return null

  const [r, g, b] = rgb.map(linearise)

  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio of `color` against pure white, or `null` when unparseable. */
export const contrastRatioVsWhite = (color: string): number | null => {
  const luminance = relativeLuminance(color)

  if (luminance === null) return null

  return 1.05 / (luminance + 0.05)
}

/**
 * Text colour to draw on top of `background`: white while the background stays
 * dark enough, near-black once it gets light. An unparseable colour keeps the
 * historical white, so a malformed branding value can never blank the text.
 */
export const onPrimaryTextColor = (background: string): string => {
  const ratio = contrastRatioVsWhite(background)

  if (ratio === null) return ON_PRIMARY_LIGHT_TEXT

  return ratio >= CONTRAST_THRESHOLD ? ON_PRIMARY_LIGHT_TEXT : ON_PRIMARY_DARK_TEXT
}

/**
 * Every `<Typography>` carries an explicit per-variant colour from
 * `@core/theme/overrides/typography.js`, so it never inherits the colour of the
 * surface it sits on. Spread this into the `sx` of a primary-coloured container
 * to let its labels follow `primary.contrastText` like the rest of its content.
 */
export const INHERIT_ON_PRIMARY_SX = {
  '& .MuiTypography-root': { color: 'inherit' },
  '& .MuiListItemText-primary, & .MuiListItemText-secondary': { color: 'inherit' }
} as const
