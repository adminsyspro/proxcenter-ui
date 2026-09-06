import { describe, expect, it } from 'vitest'

import {
  DEFAULT_REPORT_TEMPLATE,
  MAX_CUSTOM_CSS_BYTES,
  TEXT_LIMITS,
  checkCustomCss,
  normalizeReportTemplate,
} from './templateSettings'

describe('checkCustomCss', () => {
  it.each([
    '',
    '.report { color: red; }',
    'url(data:image/png;base64,AAAA)',
    '@font-face { src: url("data:font/woff2;base64,AAAA"); }',
    'span::before { content: "▶"; }',
  ])('accepts safe CSS %#', (css) => {
    expect(checkCustomCss(css)).toBeNull()
  })

  it.each([
    ['</style><script>', 'styleClose'],
    ['< / STYLE >', 'styleClose'],
    ['@import url(http://x)', 'import'],
    ['url(http://10.0.0.5/p.png)', 'remoteUrl'],
    ['url( "https://e/p.png" )', 'remoteUrl'],
    ['url(//e/p.png)', 'remoteUrl'],
    ['url()', 'remoteUrl'],
    ['image-set("http://x" 1x)', 'remoteUrl'],
    ['\\75rl(http://x)', 'backslash'],
  ] as const)('refuses %s with %s', (css, code) => {
    expect(checkCustomCss(css)).toBe(code)
  })

  it('refuses an ASCII string over the byte limit', () => {
    expect(checkCustomCss('a'.repeat(MAX_CUSTOM_CSS_BYTES + 1))).toBe('tooLarge')
  })

  it('measures the limit in UTF-8 bytes rather than JavaScript characters', () => {
    const css = '€'.repeat(MAX_CUSTOM_CSS_BYTES / 2)

    expect(css.length).toBeLessThanOrEqual(MAX_CUSTOM_CSS_BYTES)
    expect(checkCustomCss(css)).toBe('tooLarge')
  })
})

describe('normalizeReportTemplate', () => {
  it('falls back for unknown enumerations and numeric values', () => {
    const normalized = normalizeReportTemplate({
      pageSize: 'A3',
      orientation: 'sideways',
      fontFamily: 'Comic',
      baseFontSize: 42,
      showLogo: 'yes',
    })

    expect(normalized.value).toMatchObject({
      pageSize: DEFAULT_REPORT_TEMPLATE.pageSize,
      orientation: DEFAULT_REPORT_TEMPLATE.orientation,
      fontFamily: DEFAULT_REPORT_TEMPLATE.fontFamily,
      baseFontSize: DEFAULT_REPORT_TEMPLATE.baseFontSize,
      showLogo: true,
    })
  })

  it('coerces an allowed base font size supplied as a string', () => {
    expect(normalizeReportTemplate({ baseFontSize: '10' }).value.baseFontSize).toBe(10)
  })

  it('normalizes valid colors and clears invalid colors', () => {
    expect(normalizeReportTemplate({ primaryColor: 'red' }).value.primaryColor).toBe('')
    expect(normalizeReportTemplate({ primaryColor: '003366' }).value.primaryColor).toBe('#003366')
  })

  it('trims text and caps it by Unicode characters', () => {
    const subtitle = `  ${'x'.repeat(130)}  `
    const value = normalizeReportTemplate({ coverSubtitle: subtitle, coverNote: '  note  ' }).value

    expect(value.coverSubtitle).toHaveLength(TEXT_LIMITS.coverSubtitle)
    expect(Array.from(value.coverSubtitle)).toHaveLength(TEXT_LIMITS.coverSubtitle)
    expect(value.coverNote).toBe('note')
  })

  it('keeps explicitly empty running texts empty', () => {
    const value = normalizeReportTemplate({ headerText: '', footerText: '' }).value

    expect(value.headerText).toBe('')
    expect(value.footerText).toBe('')
  })

  it('strips NUL bytes from custom CSS and accepts the cleaned value', () => {
    const normalized = normalizeReportTemplate({ customCss: '.a {\0color: red; }' })

    expect(normalized.value.customCss).toBe('.a {color: red; }')
    expect(normalized.cssError).toBeNull()
  })

  it('reports bad CSS without removing it from the normalized value', () => {
    const customCss = '@import url(http://x)'
    const normalized = normalizeReportTemplate({ customCss })

    expect(normalized.cssError).toBe('import')
    expect(normalized.value.customCss).toBe(customCss)
  })
})
