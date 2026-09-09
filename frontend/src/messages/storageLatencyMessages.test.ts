import { describe, expect, it } from 'vitest'

import de from './de.json'
import en from './en.json'
import es from './es.json'
import fr from './fr.json'
import ko from './ko.json'
import zhCN from './zh-CN.json'

const locales: Record<string, any> = { en, fr, de, es, ko, 'zh-CN': zhCN }

const PLACEHOLDERS: Record<string, string[]> = {
  title: [],
  noData: [],
  readWrite: ['{read}', '{write}'],
  window: ['{minutes}', '{avg}', '{max}'],
  guests: ['{vms}', '{disks}'],
}

describe('Storage latency widget (#881) i18n parity across the 6 served locales', () => {
  for (const [locale, messages] of Object.entries(locales)) {
    it(`${locale} names and describes the widget in the picker catalogue`, () => {
      expect(messages?.dashboard?.widgetNames?.storageLatency, `${locale}: widgetNames.storageLatency`).toBeTypeOf('string')
      expect(messages?.dashboard?.widgetDescs?.storageLatency, `${locale}: widgetDescs.storageLatency`).toBeTypeOf('string')
    })

    for (const [key, placeholders] of Object.entries(PLACEHOLDERS)) {
      it(`${locale} declares dashboard.widgetStorageLatency.${key} with its placeholders`, () => {
        const value = messages?.dashboard?.widgetStorageLatency?.[key]

        expect(value, `${locale}: ${key}`).toBeTypeOf('string')
        for (const ph of placeholders) expect(value, `${locale}: ${key} needs ${ph}`).toContain(ph)
      })
    }
  }
})
