import { describe, expect, it } from 'vitest'

import { getReportTypeLabel, type TypeLabelTranslator } from './reportTypeLabel'

function makeT(messages: Record<string, string>): TypeLabelTranslator {
  const fn = ((key: string) => messages[key] ?? key) as TypeLabelTranslator

  fn.has = (key: string) => key in messages

  return fn
}

const TYPES = [
  { type: 'infrastructure', name: 'Infrastructure Report' },
  { type: 'backup', name: 'Backup Report' },
  { type: 'site_recovery', name: 'Site Recovery Report' },
]

describe('getReportTypeLabel', () => {
  it('prefers the locale-aware i18n key over the (English-only) API name', () => {
    const t = makeT({ 'reports.types.backup': 'Sauvegarde' })

    expect(getReportTypeLabel('backup', TYPES, t)).toBe('Sauvegarde')
  })

  it('falls back to the API-provided name when no i18n key exists', () => {
    const t = makeT({})

    expect(getReportTypeLabel('backup', TYPES, t)).toBe('Backup Report')
  })

  it('falls back to the raw type id when neither i18n nor API name is available', () => {
    const t = makeT({})

    expect(getReportTypeLabel('backup', [], t)).toBe('backup')
  })

  it('resolves a type that only exists in the API catalog', () => {
    const t = makeT({ 'reports.types.infrastructure': 'Infrastructure' })

    expect(getReportTypeLabel('site_recovery', TYPES, t)).toBe('Site Recovery Report')
  })

  it('returns the i18n value even when the type is absent from the API catalog', () => {
    const t = makeT({ 'reports.types.backup': 'Backup' })

    expect(getReportTypeLabel('backup', [], t)).toBe('Backup')
  })
})
