import { describe, expect, it } from 'vitest'

import de from './de.json'
import en from './en.json'
import es from './es.json'
import fr from './fr.json'
import ko from './ko.json'
import zhCN from './zh-CN.json'

const locales: Record<string, any> = { en, fr, de, es, ko, 'zh-CN': zhCN }
const keys = ['cephExporterPort', 'cephExporterPortHelper', 'errorCephExporterPortInvalid']

describe('ceph exporter port messages', () => {
  for (const [name, messages] of Object.entries(locales)) {
    it(`${name} has the three settings strings, no em-dash`, () => {
      for (const k of keys) {
        const v = messages.settings[k]
        expect(typeof v, k).toBe('string')
        expect(v.length, k).toBeGreaterThan(5)
        expect(v, k).not.toContain('—')
      }
    })
  }
})
