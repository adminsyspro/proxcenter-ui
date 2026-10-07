import { describe, expect, it } from 'vitest'

import de from './de.json'
import en from './en.json'
import es from './es.json'
import fr from './fr.json'
import ko from './ko.json'
import zhCN from './zh-CN.json'

const locales: Record<string, any> = { en, fr, de, es, ko, 'zh-CN': zhCN }

// Pool management from the inventory Pools view (create, edit comment, delete).
const keys: Record<string, string[]> = {
  createPool: [],
  createSubPool: [],
  editPool: ['{pool}'],
  editPoolComment: [],
  deletePool: ['{pool}'],
  deletePoolConfirm: ['{pool}'],
  poolId: [],
  poolIdHelp: [],
  poolComment: [],
  poolCluster: [],
  poolCreated: ['{pool}'],
  poolUpdated: ['{pool}'],
  poolDeleted: ['{pool}'],
  poolOwnedByVdc: ['{vdc}'],
}

describe('pool management i18n parity across the 6 served locales', () => {
  for (const [locale, messages] of Object.entries(locales)) {
    it(`${locale} declares every pool management key with its placeholders`, () => {
      for (const [key, placeholders] of Object.entries(keys)) {
        const value = messages.inventory?.[key]

        expect(value, `${locale}: inventory.${key}`).toBeTypeOf('string')
        expect((value as string).length, `${locale}: inventory.${key} is empty`).toBeGreaterThan(0)
        for (const ph of placeholders) expect(value, `${locale}: inventory.${key} lacks ${ph}`).toContain(ph)
      }
    })
  }
})
