import { describe, expect, it } from 'vitest'

import de from './de.json'
import en from './en.json'
import es from './es.json'
import fr from './fr.json'
import ko from './ko.json'
import zhCN from './zh-CN.json'

const locales: Record<string, any> = { en, fr, de, es, ko, 'zh-CN': zhCN }

// The migration dialogs render the CPU type select (roadmap#24) from these four
// keys; a locale missing one shows its key path, request.ts has no English
// fallback. The model names themselves are not translated.
const KEYS = ['cpuType', 'cpuTypeDefault', 'cpuTypeHint', 'cpuTypeHostHint']

describe('migration CPU type i18n parity across the 6 served locales', () => {
  for (const [locale, messages] of Object.entries(locales)) {
    for (const key of KEYS) {
      it(`${locale} declares ${key}`, () => {
        const value = messages?.inventoryPage?.esxiMigration?.[key]
        expect(value, `${locale}: ${key}`).toBeTypeOf('string')
        expect((value as string).trim().length, `${locale}: ${key} is empty`).toBeGreaterThan(0)
      })
    }
    it(`${locale} names the Proxmox default in the hint`, () => {
      expect(locales[locale].inventoryPage.esxiMigration.cpuTypeHint).toContain('x86-64-v2-AES')
    })
  }
})
