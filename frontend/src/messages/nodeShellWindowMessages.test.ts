import { describe, expect, it } from 'vitest'

import de from './de.json'
import en from './en.json'
import es from './es.json'
import fr from './fr.json'
import ko from './ko.json'
import zhCN from './zh-CN.json'

const locales: Record<string, any> = { en, fr, de, es, ko, 'zh-CN': zhCN }

// The node shell status bar labels its two window controls from these keys
// (#879). A missing one would ship a button whose tooltip reads as the raw
// key path.
const requiredKeys = ['console.fullscreen', 'console.exitFullscreen', 'console.openInNewWindow']

function get(messages: any, path: string): unknown {
  return path.split('.').reduce((node, key) => (node ? node[key] : undefined), messages)
}

describe('node shell window controls i18n parity across the 6 served locales', () => {
  for (const [locale, messages] of Object.entries(locales)) {
    it(`${locale} declares every window control key with a non-empty value`, () => {
      for (const key of requiredKeys) {
        const value = get(messages, key)

        expect(value, `${locale}: ${key}`).toBeTypeOf('string')
        expect((value as string).trim().length, `${locale}: ${key} is empty`).toBeGreaterThan(0)
      }
    })

    it(`${locale} keeps entering and leaving fullscreen distinguishable`, () => {
      expect(get(messages, 'console.exitFullscreen'), locale).not.toBe(get(messages, 'console.fullscreen'))
    })
  }
})
