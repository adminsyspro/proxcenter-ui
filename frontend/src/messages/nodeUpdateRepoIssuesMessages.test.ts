import { describe, expect, it } from 'vitest'

import de from './de.json'
import en from './en.json'
import es from './es.json'
import fr from './fr.json'
import ko from './ko.json'
import zhCN from './zh-CN.json'

const locales: Record<string, any> = { en, fr, de, es, ko, 'zh-CN': zhCN }

const PLAIN_KEYS = ['repoEnterprisePve', 'repoParseErrorsDescription']

describe('node update repository pre-flight i18n parity across the 6 served locales', () => {
  for (const [locale, messages] of Object.entries(locales)) {
    for (const key of PLAIN_KEYS) {
      it(`${locale} declares updates.${key}`, () => {
        const value = messages?.updates?.[key]

        expect(value, `${locale}: ${key}`).toBeTypeOf('string')
        expect(value!.length, `${locale}: ${key} must not be empty`).toBeGreaterThan(0)
      })
    }

    it(`${locale} declares updates.repoEnterpriseComponent with its {component} placeholder`, () => {
      const value = messages?.updates?.repoEnterpriseComponent

      expect(value, `${locale}: repoEnterpriseComponent`).toBeTypeOf('string')
      expect(value, `${locale}: {component} placeholder`).toContain('{component}')
    })

    // The whole point of the parse-error wording: tell the operator which
    // directory to clean up, since APT only reads .list and .sources there.
    it(`${locale} points repoParseErrorsDescription at the sources.list.d directory`, () => {
      const value = messages?.updates?.repoParseErrorsDescription as string

      expect(value, `${locale}: must name the directory`).toContain('/etc/apt/sources.list.d/')
      expect(value, `${locale}: must name the .sources extension`).toContain('.sources')
      expect(value, `${locale}: must name the .list extension`).toContain('.list')
    })
  }
})
