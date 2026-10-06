import { describe, expect, it } from 'vitest'

import de from './de.json'
import en from './en.json'
import es from './es.json'
import fr from './fr.json'
import ko from './ko.json'
import zhCN from './zh-CN.json'

const locales: Record<string, any> = { en, fr, de, es, ko, 'zh-CN': zhCN }

describe('Storage rights (#920) i18n parity across the 6 served locales', () => {
  for (const [locale, messages] of Object.entries(locales)) {
    it(`${locale} explains a refused storage content listing`, () => {
      const value = messages?.inventory?.storageContentAccessDenied

      expect(value, `${locale}: inventory.storageContentAccessDenied`).toBeTypeOf('string')
      expect(value).toContain('storage.content')
    })

    it(`${locale} declares the access denied state the storage pages render`, () => {
      expect(messages?.errorPages?.['403']?.title, `${locale}: errorPages.403.title`).toBeTypeOf('string')
      expect(messages?.errorPages?.['403']?.description, `${locale}: errorPages.403.description`).toBeTypeOf('string')
    })
  }
})
