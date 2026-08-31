/**
 * Translation parity for the micro-segmentation east-west view.
 *
 * English defines the subtree contract. Every served catalog must carry the
 * same non-empty string keys and preserve each ICU placeholder, while the
 * parent network page must expose the tab label too.
 */

import { describe, expect, it } from 'vitest'

import de from './de.json'
import en from './en.json'
import es from './es.json'
import fr from './fr.json'
import ko from './ko.json'
import zhCN from './zh-CN.json'

const locales: Record<string, any> = { en, fr, de, es, ko, 'zh-CN': zhCN }
const englishEastWest = en.microseg.eastWest
const requiredKeys = Object.keys(englishEastWest).sort()

/** Extract the set of `{placeholder}` tokens from a message string. */
function placeholderSet(value: unknown): Set<string> {
  const str = typeof value === 'string' ? value : ''
  return new Set(str.match(/\{[^}]+\}/g) ?? [])
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  return a.size === b.size && [...a].every(token => b.has(token))
}

describe('micro-segmentation east-west i18n parity across the 6 served locales', () => {
  for (const [locale, messages] of Object.entries(locales)) {
    it(`${locale} declares the east-west subtree with the English key set`, () => {
      expect(messages.microseg?.eastWest, `${locale}: microseg.eastWest`).toBeTypeOf('object')
      expect(Object.keys(messages.microseg?.eastWest ?? {}).sort(), locale).toEqual(requiredKeys)

      for (const key of requiredKeys) {
        expect(messages.microseg.eastWest[key], `${locale}: microseg.eastWest.${key}`).toBeTypeOf('string')
        expect(messages.microseg.eastWest[key].trim(), `${locale}: microseg.eastWest.${key}`).not.toBe('')
      }
    })

    it(`${locale} preserves the English ICU placeholders`, () => {
      for (const key of requiredKeys) {
        const enPlaceholders = placeholderSet(englishEastWest[key as keyof typeof englishEastWest])
        const localePlaceholders = placeholderSet(messages.microseg?.eastWest?.[key])
        expect(
          sameSet(localePlaceholders, enPlaceholders),
          `${locale}: ${key} has {${[...localePlaceholders].join(', ')}}, en has {${[...enPlaceholders].join(', ')}}`,
        ).toBe(true)
      }
    })

    it(`${locale} declares networkPage.tabMicroseg`, () => {
      expect(messages.networkPage?.tabMicroseg, `${locale}: networkPage.tabMicroseg`).toBeTypeOf('string')
      expect(messages.networkPage?.tabMicroseg.trim(), `${locale}: networkPage.tabMicroseg`).not.toBe('')
    })
  }
})
