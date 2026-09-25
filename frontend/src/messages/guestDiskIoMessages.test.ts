import { describe, expect, it } from 'vitest'

import de from './de.json'
import en from './en.json'
import es from './es.json'
import fr from './fr.json'
import ko from './ko.json'
import zhCN from './zh-CN.json'

const locales: Record<string, any> = { en, fr, de, es, ko, 'zh-CN': zhCN }

const INVENTORY: Record<string, string[]> = {
  diskRead: [],
  diskWrite: [],
  ioPressure: [],
  ioPressureTooltip: ['{some}', '{full}'],
  ioPressureChart: [],
  ioPressureSome: [],
  ioPressureFull: [],
  diskLatencyTooltip: [],
  diskReadTooltip: [],
  diskWriteTooltip: [],
  ioPressureHeaderTooltip: [],
}

const STORAGE_OVERVIEW: Record<string, string[]> = {
  read: [],
  write: [],
  bandwidthTooltip: ['{vms}', '{disks}'],
  readTooltip: [],
  writeTooltip: [],
}

describe('Guest disk bandwidth and IO pressure (#1011) i18n parity across the 6 served locales', () => {
  for (const [locale, messages] of Object.entries(locales)) {
    for (const [key, placeholders] of Object.entries(INVENTORY)) {
      it(`${locale} declares inventory.${key} with its placeholders`, () => {
        const value = messages?.inventory?.[key]

        expect(value, `${locale}: inventory.${key}`).toBeTypeOf('string')
        for (const ph of placeholders) expect(value, `${locale}: ${key} needs ${ph}`).toContain(ph)
      })
    }

    for (const [key, placeholders] of Object.entries(STORAGE_OVERVIEW)) {
      it(`${locale} declares storageOverview.${key} with its placeholders`, () => {
        const value = messages?.storageOverview?.[key]

        expect(value, `${locale}: storageOverview.${key}`).toBeTypeOf('string')
        for (const ph of placeholders) expect(value, `${locale}: ${key} needs ${ph}`).toContain(ph)
      })
    }
  }
})
