import { describe, expect, it } from 'vitest'

import de from './de.json'
import en from './en.json'
import es from './es.json'
import fr from './fr.json'
import ko from './ko.json'
import zhCN from './zh-CN.json'

const locales = { en, fr, de, es, ko, 'zh-CN': zhCN }

// The scan status codes the orchestrator sends (internal/cve/service.go). A
// code with no message throws at render time, so the tab would break exactly
// when it has something important to say about a degraded scan.
const statusCodes = [
  'ssh-not-configured',
  'ssh-failed',
  'credentials-failed',
  'release-not-tracked',
  'node-offline',
  'inventory-empty',
] as const

const flatKeys = ['scanFailed', 'partialScan', 'coverage', 'noFix', 'noFixFilter'] as const

describe('CVE scanner i18n parity across the 6 served locales', () => {
  for (const [locale, messages] of Object.entries(locales)) {
    const cve = messages.cve as Record<string, any>

    it(`${locale} declares every scan-coverage string`, () => {
      for (const key of flatKeys) {
        expect(cve, `${locale}: missing ${key}`).toHaveProperty(key)
        expect(cve[key], `${locale}: ${key}`).toBeTypeOf('string')
        expect((cve[key] as string).trim().length, `${locale}: ${key} is empty`).toBeGreaterThan(0)
      }
    })

    it(`${locale} declares a message for every scan status code`, () => {
      for (const code of statusCodes) {
        expect(cve.status, `${locale}: missing status.${code}`).toHaveProperty(code)
        expect((cve.status[code] as string).trim().length, `${locale}: status.${code} is empty`).toBeGreaterThan(0)
      }
    })

    it(`${locale} preserves the placeholders the tab passes`, () => {
      expect(cve.coverage, locale).toContain('{scanned}')
      expect(cve.coverage, locale).toContain('{tracked}')
      expect(cve.noFixFilter, locale).toContain('{count}')
      expect(cve.status['node-offline'], locale).toContain('{node}')
      expect(cve.status['inventory-empty'], locale).toContain('{node}')
      expect(cve.status['release-not-tracked'], locale).toContain('{release}')
    })
  }
})
