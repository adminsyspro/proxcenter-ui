import { describe, expect, it } from 'vitest'

import de from './de.json'
import en from './en.json'
import es from './es.json'
import fr from './fr.json'
import ko from './ko.json'
import zhCN from './zh-CN.json'

const locales: Record<string, any> = { en, fr, de, es, ko, 'zh-CN': zhCN }

// roadmap#47: the channels card renders every key below, and next-intl has no
// English fallback, so a missing key would show up as its path on screen.
function leaves(o: any, prefix = ''): string[] {
  return Object.entries(o).flatMap(([k, v]) =>
    v && typeof v === 'object' ? leaves(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  )
}

const reference = leaves(en.notifications.channels).sort()

describe('notification channels i18n parity across the 6 served locales', () => {
  for (const [locale, messages] of Object.entries(locales)) {
    it(`${locale} declares every notifications.channels key of en`, () => {
      expect(leaves(messages?.notifications?.channels ?? {}).sort(), locale).toEqual(reference)
    })

    it(`${locale} keeps the placeholders of the parameterised channel strings`, () => {
      const c = messages.notifications.channels

      expect(c.lastSent, `${locale}: {time}`).toContain('{time}')
      expect(c.lastError, `${locale}: {error}`).toContain('{error}')
      expect(c.keepCurrent, `${locale}: {current}`).toContain('{current}')
      expect(c.deleteConfirm.body, `${locale}: {name}`).toContain('{name}')
    })

    it(`${locale} declares the public URL setting strings`, () => {
      expect(messages?.notifications?.publicUrl, locale).toBeTypeOf('string')
      expect(messages?.notifications?.publicUrlHelper, locale).toBeTypeOf('string')
    })
  }
})
