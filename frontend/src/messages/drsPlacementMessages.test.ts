import { describe, expect, it } from 'vitest'

import de from './de.json'
import en from './en.json'
import es from './es.json'
import fr from './fr.json'
import ko from './ko.json'
import zhCN from './zh-CN.json'

const locales: Record<string, any> = { en, fr, de, es, ko, 'zh-CN': zhCN }

const plainKeys = [
  'placementConstraints',
  'placementConstraintsDesc',
  'balancingDomainsTitle',
  'pinnedGuestsTitle',
  'someGuestsCannotMove',
  'placementConstrainedSdn',
  'placementConstrainedStorage',
  'placementConstrainedBoth',
  'domainNoTarget'
]

// Each of these carries an interpolation the card depends on; a locale that
// drops the placeholder silently renders a sentence with a hole in it.
// domainGuests is an ICU plural, so it carries "{count," and not "{count}".
const interpolated: Record<string, string> = {
  domainGuests: '{count,',
  domainSpread: '{value}',
  pinnedGuestOn: '{node}',
  placementConstrainedTooltip: '{count,'
}

describe('DRS placement constraints i18n parity across the 6 served locales', () => {
  it('every locale spells the guest count as an ICU plural', () => {
    for (const [locale, messages] of Object.entries(locales)) {
      const value: string = messages?.drsPage?.domainGuests

      expect(value, `${locale}: domainGuests`).toBeTypeOf('string')
      expect(value, `${locale}: plural form`).toMatch(/\{count,\s*plural,/)
      expect(value, `${locale}: an "other" branch is required by ICU`).toContain('other {')
    }
  })

  it('every locale spells the constrained-cluster tooltip as an ICU plural', () => {
    for (const [locale, messages] of Object.entries(locales)) {
      const value: string = messages?.drsPage?.placementConstrainedTooltip

      expect(value, `${locale}: placementConstrainedTooltip`).toBeTypeOf('string')
      expect(value, `${locale}: plural form`).toMatch(/\{count,\s*plural,/)
      expect(value, `${locale}: an "other" branch is required by ICU`).toContain('other {')
    }
  })

  for (const [locale, messages] of Object.entries(locales)) {
    for (const key of plainKeys) {
      it(`${locale} declares drsPage.${key}`, () => {
        const value = messages?.drsPage?.[key]

        expect(value, `${locale}: drsPage.${key}`).toBeTypeOf('string')
        expect(value!.length, `${locale}: drsPage.${key} must not be empty`).toBeGreaterThan(0)
      })
    }

    for (const [key, placeholder] of Object.entries(interpolated)) {
      it(`${locale} declares drsPage.${key} with its ${placeholder} placeholder`, () => {
        const value = messages?.drsPage?.[key]

        expect(value, `${locale}: drsPage.${key}`).toBeTypeOf('string')
        expect(value, `${locale}: ${placeholder} placeholder`).toContain(placeholder)
      })
    }
  }
})
