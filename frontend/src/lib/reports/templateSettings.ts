// src/lib/reports/templateSettings.ts
//
// Per-tenant customization of the PDF report layout (the "Customization" tab
// of /operations/reports). Stored in the `settings` table under
// REPORT_TEMPLATE_SETTING_KEY and read by the orchestrator at render time.
//
// This mirrors internal/reports/template_settings.go in the orchestrator,
// which is the authority: it re-validates everything just before WeasyPrint.
// The copy here exists so the form can refuse a bad value with a reason
// instead of letting the administrator discover it on the next PDF. Keep the
// field names, defaults and limits aligned with the Go side.

import { normalizeHexColor } from '@/lib/theme/hexColor'

export const REPORT_TEMPLATE_SETTING_KEY = 'reports_template'

export const PAGE_SIZES = ['A4', 'Letter'] as const
export const ORIENTATIONS = ['portrait', 'landscape'] as const
export const FONT_FAMILIES = ['sans', 'serif', 'dejavu'] as const
export const BASE_FONT_SIZES = [9, 10, 11] as const

export const MAX_CUSTOM_CSS_BYTES = 32 * 1024

export const TEXT_LIMITS = {
  coverSubtitle: 120,
  coverNote: 600,
  headerText: 200,
  footerText: 120,
} as const

export type PageSize = (typeof PAGE_SIZES)[number]
export type Orientation = (typeof ORIENTATIONS)[number]
export type FontFamily = (typeof FONT_FAMILIES)[number]
export type BaseFontSize = (typeof BASE_FONT_SIZES)[number]

export interface ReportTemplateSettings {
  pageSize: PageSize
  orientation: Orientation
  fontFamily: FontFamily
  baseFontSize: BaseFontSize
  /** Hex colour overriding the white-label primary colour for reports only; '' keeps the branding colour. */
  primaryColor: string
  showLogo: boolean
  /** '' falls back to the translated "Enterprise Report". */
  coverSubtitle: string
  /** Free text under the cover meta block, line breaks preserved. */
  coverNote: string
  /** Running header; `{app}` and `{report}` are substituted. '' removes the header. */
  headerText: string
  /** Bottom-right classification mention; '' removes it. */
  footerText: string
  showPageNumbers: boolean
  /** Appended after the built-in stylesheet. */
  customCss: string
}

/** The layout every report had before the tab existed. */
export const DEFAULT_REPORT_TEMPLATE: ReportTemplateSettings = {
  pageSize: 'A4',
  orientation: 'portrait',
  fontFamily: 'sans',
  baseFontSize: 10,
  primaryColor: '',
  showLogo: true,
  coverSubtitle: '',
  coverNote: '',
  headerText: '{app}  |  {report}',
  footerText: 'Confidential',
  showPageNumbers: true,
  customCss: '',
}

export type CustomCssError = 'tooLarge' | 'backslash' | 'styleClose' | 'import' | 'remoteUrl'

// Anchored, no nested quantifier (S5852-safe). See the Go sanitizer for the
// reasoning: no `</style>` breakout, and nothing that makes WeasyPrint fetch a
// URL (it follows absolute http(s) URLs, so a tenant stylesheet would be an
// SSRF from the sidecar). Backslashes are refused outright because CSS escapes
// (`\75rl(`) are the standard way around a filter like this one.
const RE_STYLE_CLOSE = /<\s*\/\s*style/i
const RE_IMPORT = /@import\b/i
// attr() can carry a URL fallback (`attr(x url, "http://...")`), hence in the list.
const RE_URL_FUNC = /\b(?:url|image|image-set|src|attr)\(\s*['"]?\s*([^'")\s]*)/gi

/** Returns the reason a custom stylesheet is refused, or null when it is acceptable. */
export function checkCustomCss(css: string): CustomCssError | null {
  if (Buffer.byteLength(css, 'utf8') > MAX_CUSTOM_CSS_BYTES) return 'tooLarge'
  if (css.includes('\\')) return 'backslash'
  if (RE_STYLE_CLOSE.test(css)) return 'styleClose'
  if (RE_IMPORT.test(css)) return 'import'
  for (const match of css.matchAll(RE_URL_FUNC)) {
    if (!match[1].toLowerCase().startsWith('data:')) return 'remoteUrl'
  }
  return null
}

export const CUSTOM_CSS_ERROR_MESSAGES: Record<CustomCssError, string> = {
  tooLarge: `Custom CSS exceeds ${MAX_CUSTOM_CSS_BYTES / 1024} KB`,
  backslash: 'Backslash escapes are not allowed in custom CSS, type the character directly',
  styleClose: 'Custom CSS must not contain </style>',
  import: '@import is not allowed in custom CSS',
  remoteUrl: 'url() in custom CSS may only reference data: URIs',
}

function pick<T extends string | number>(value: unknown, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly unknown[]).includes(value) ? (value as T) : fallback
}

// A missing key keeps the default (a row written before the field existed);
// an explicit string, empty included, is what the administrator meant.
function text(value: unknown, max: number, fallback: string): string {
  if (typeof value !== 'string') return fallback
  return Array.from(value.trim()).slice(0, max).join('')
}

export interface NormalizedReportTemplate {
  value: ReportTemplateSettings
  /** Empty when the payload is storable as-is. */
  cssError: CustomCssError | null
}

/**
 * Coerces an arbitrary payload to a storable ReportTemplateSettings: unknown
 * enumerations fall back to the default, texts are trimmed and capped, the
 * colour goes through normalizeHexColor ('' stays allowed and means "use the
 * branding colour"). The custom CSS is reported rather than silently dropped
 * so the administrator sees why it was refused.
 */
export function normalizeReportTemplate(input: unknown): NormalizedReportTemplate {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const def = DEFAULT_REPORT_TEMPLATE

  const primaryColor =
    typeof raw.primaryColor === 'string' && raw.primaryColor.trim() !== ''
      ? (normalizeHexColor(raw.primaryColor) ?? '')
      : ''

  const customCss = typeof raw.customCss === 'string' ? raw.customCss.replace(/\0/g, '') : def.customCss

  const value: ReportTemplateSettings = {
    pageSize: pick(raw.pageSize, PAGE_SIZES, def.pageSize),
    orientation: pick(raw.orientation, ORIENTATIONS, def.orientation),
    fontFamily: pick(raw.fontFamily, FONT_FAMILIES, def.fontFamily),
    baseFontSize: pick(Number(raw.baseFontSize), BASE_FONT_SIZES, def.baseFontSize),
    primaryColor,
    showLogo: typeof raw.showLogo === 'boolean' ? raw.showLogo : def.showLogo,
    coverSubtitle: text(raw.coverSubtitle, TEXT_LIMITS.coverSubtitle, def.coverSubtitle),
    coverNote: text(raw.coverNote, TEXT_LIMITS.coverNote, def.coverNote),
    headerText: text(raw.headerText, TEXT_LIMITS.headerText, def.headerText),
    footerText: text(raw.footerText, TEXT_LIMITS.footerText, def.footerText),
    showPageNumbers: typeof raw.showPageNumbers === 'boolean' ? raw.showPageNumbers : def.showPageNumbers,
    customCss,
  }

  return { value, cssError: checkCustomCss(customCss) }
}
