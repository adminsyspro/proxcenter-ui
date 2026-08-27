import { describe, expect, it } from 'vitest'

import de from './de.json'
import en from './en.json'
import es from './es.json'
import fr from './fr.json'
import ko from './ko.json'
import zhCN from './zh-CN.json'

const locales: Record<string, any> = { en, fr, de, es, ko, 'zh-CN': zhCN }

// ui#812: the helper text promised commas while the field refused them. Now that
// both separators are accepted, every locale has to say so, and the invalid
// address warning has to exist everywhere it can be rendered.
describe('notification recipients i18n parity across the 6 served locales', () => {
  for (const [locale, messages] of Object.entries(locales)) {
    it(`${locale} declares notifications.separateByComma`, () => {
      expect(messages?.notifications?.separateByComma, locale).toBeTypeOf('string')
    })

    it(`${locale} declares notifications.invalidRecipients with the {emails} placeholder`, () => {
      const value = messages?.notifications?.invalidRecipients

      expect(value, locale).toBeTypeOf('string')
      expect(value, `${locale}: {emails} placeholder`).toContain('{emails}')
    })

    it(`${locale} declares reports.recipientsPlaceholder`, () => {
      expect(messages?.reports?.recipientsPlaceholder, locale).toBeTypeOf('string')
    })
  }
})
