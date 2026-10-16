import { describe, expect, it } from 'vitest'

import de from './de.json'
import en from './en.json'
import es from './es.json'
import fr from './fr.json'
import ko from './ko.json'
import zhCN from './zh-CN.json'

const locales: Record<string, any> = { en, fr, de, es, ko, 'zh-CN': zhCN }

describe('Network Flows unmatched sFlow agents (#1066) i18n parity across the 6 served locales', () => {
  for (const [locale, messages] of Object.entries(locales)) {
    it(`${locale} names the agents no node row matches`, () => {
      expect(messages?.networkFlows?.unmatchedAgentsTitle, `${locale}: networkFlows.unmatchedAgentsTitle`).toBeTypeOf('string')
      expect(messages?.networkFlows?.unmatchedAgentsDesc, `${locale}: networkFlows.unmatchedAgentsDesc`).toContain('{agents}')
    })
  }
})
