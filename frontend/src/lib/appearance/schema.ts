// src/lib/appearance/schema.ts
//
// Whitelist + validation for the per-user appearance settings that are stored
// server-side (issue #696).
//
// The blob travels browser -> API -> JSONB and comes back through server-side
// rendering, where `primaryColor` is handed straight to MUI's lighten()/darken()
// in components/theme/index.jsx. A malformed value there throws while the page
// is being rendered on the server, which would take the whole app down for that
// user with no way to fix it from the UI. So nothing is stored without being
// checked first, and anything unknown or out of range is dropped rather than
// clamped: a rejected key simply falls back to the shipped default.
//
// This module is deliberately dependency-free (configs only, no Prisma, no
// next/headers) so both the API route and the browser can import it.

import globalThemesConfig, { densityConfig } from '@configs/globalThemesConfig'
import lightBackgroundConfig from '@configs/lightBackgroundConfig'

type Validator = (value: unknown) => unknown

// Six-digit hex only: the colour pickers never emit shorthand or alpha, and a
// bounded, anchored pattern keeps this linear-time on hostile input.
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

const enumOf =
  (allowed: readonly string[]): Validator =>
  value =>
    typeof value === 'string' && allowed.includes(value) ? value : undefined

const numberIn =
  (allowed: readonly number[]): Validator =>
  value =>
    typeof value === 'number' && allowed.includes(value) ? value : undefined

const boolean: Validator = value => (typeof value === 'boolean' ? value : undefined)

const intBetween =
  (min: number, max: number): Validator =>
  value => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
    const rounded = Math.round(value)

    return rounded >= min && rounded <= max ? rounded : undefined
  }

// `customBorderRadius: null` means "inherit the global theme's radius" and is a
// legitimate stored value, so it has to survive validation.
const nullableIntBetween = (min: number, max: number): Validator => {
  const inner = intBetween(min, max)

  return value => (value === null ? null : inner(value))
}

const hexColor: Validator = value =>
  typeof value === 'string' && HEX_COLOR.test(value) ? value : undefined

// Domains come from the same configs the settings UI renders from, so adding a
// theme or a background tint never needs a second edit here.
const GLOBAL_THEME_IDS = globalThemesConfig.map((theme: { id: string }) => theme.id)
const LIGHT_BACKGROUND_IDS = lightBackgroundConfig.map((background: { id: string }) => background.id)
const DENSITY_IDS = Object.keys(densityConfig)

/**
 * The appearance keys that get a server-side home, each with the validator that
 * guards it. Keys of the settings blob that are absent here (`loginBackground`,
 * which is a provider-wide setting with its own API) stay cookie-only.
 */
export const APPEARANCE_VALIDATORS: Record<string, Validator> = {
  mode: enumOf(['light', 'dark', 'system']),
  skin: enumOf(['default', 'bordered']),
  semiDark: boolean,
  layout: enumOf(['vertical', 'collapsed', 'horizontal', 'hidden']),
  navbarContentWidth: enumOf(['compact', 'wide']),
  contentWidth: enumOf(['compact', 'wide']),
  footerContentWidth: enumOf(['compact', 'wide']),
  primaryColor: hexColor,
  globalTheme: enumOf(GLOBAL_THEME_IDS),
  lightBackground: enumOf(LIGHT_BACKGROUND_IDS),
  density: enumOf(DENSITY_IDS),
  customBorderRadius: nullableIntBetween(0, 24),
  blurIntensity: intBetween(0, 24),
  fontSize: intBetween(12, 18),
  uiScale: intBetween(80, 120),
  refreshInterval: numberIn([0, 5, 10, 30, 60, 300]),
}

export const PERSISTED_APPEARANCE_KEYS = Object.keys(APPEARANCE_VALIDATORS)

/**
 * Keep the known, well-formed appearance keys of `input` and drop everything
 * else. Always returns a plain object, so callers can spread the result without
 * guarding for null.
 */
export function sanitizeAppearance(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}

  const source = input as Record<string, unknown>
  const sanitized: Record<string, unknown> = {}

  for (const [key, validate] of Object.entries(APPEARANCE_VALIDATORS)) {
    if (!Object.hasOwn(source, key)) continue
    const value = validate(source[key])

    if (value !== undefined) sanitized[key] = value
  }

  return sanitized
}
