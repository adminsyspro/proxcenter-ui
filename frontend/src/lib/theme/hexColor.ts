/**
 * Hex colour normalisation for the branding primary colour (issue #754).
 *
 * The White Label primary colour is free text typed by an administrator and it
 * ends up in `lighten()` / `darken()` in `src/components/theme/index.jsx`, which
 * throw on anything MUI cannot parse. That palette is built by the theme
 * provider wrapping BOTH the dashboard layout and the blank layout, so a single
 * malformed value (`00ECB2` instead of `#00ECB2`) turned every page of the
 * tenant, login page included, into a 500 with no way back through the UI: the
 * only recovery was an UPDATE on the `settings` table.
 *
 * So the value is normalised on the way in (form + PUT) and on the way out
 * (both branding GETs), and the theme provider treats whatever is left as
 * untrusted. Same reasoning as `src/lib/appearance/schema.ts`, which already
 * guards the per-user appearance blob; the per-tenant branding path was the one
 * that never got a validator.
 */

/**
 * Three- or six-digit hex, `#` optional. Anchored, fixed length, no nested
 * quantifier: S5852-safe.
 *
 * Alpha forms (`#nnnn`, `#nnnnnnnn`) are deliberately rejected. MUI accepts
 * them but derives nonsense shades from them (`lighten('#00EC', 0.2)` yields
 * `rgba(51, 51, 241, 0.8)`), and a translucent primary colour is not a thing
 * the colour picker can produce anyway.
 */
const HEX_COLOR_INPUT = /^#?(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

/**
 * `value` as a `#`-prefixed hex colour, or `null` when it is not one.
 *
 * Adds the missing `#` rather than rejecting the input: an administrator who
 * typed `00ECB2` meant `#00ECB2`, and a stored value that already lost its `#`
 * is repaired instead of being silently replaced by the default colour.
 */
export function normalizeHexColor(value: unknown): string | null {
  if (typeof value !== 'string') return null

  const trimmed = value.trim()

  if (!HEX_COLOR_INPUT.test(trimmed)) return null

  return trimmed.startsWith('#') ? trimmed : `#${trimmed}`
}

/** Whether `value` is a hex colour this application can render. */
export function isHexColor(value: unknown): boolean {
  return normalizeHexColor(value) !== null
}

/**
 * The normalised colour, or `fallback` when the value is unusable. Callers
 * pass the colour they would have used anyway, so a malformed stored value
 * degrades to the shipped palette instead of throwing mid-render.
 */
export function resolveHexColor(value: unknown, fallback: string): string {
  return normalizeHexColor(value) ?? fallback
}
