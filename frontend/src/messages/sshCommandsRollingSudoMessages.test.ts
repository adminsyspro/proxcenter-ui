import { describe, expect, it } from 'vitest'

import de from './de.json'
import en from './en.json'
import es from './es.json'
import fr from './fr.json'
import ko from './ko.json'
import zhCN from './zh-CN.json'

const locales: Record<string, any> = { en, fr, de, es, ko, 'zh-CN': zhCN }

const KEY = 'rollingUpdateWarning'

describe('SSH commands page: rolling update sudo warning, i18n parity across the 6 served locales', () => {
  for (const [locale, messages] of Object.entries(locales)) {
    it(`${locale} declares settings.sshCommands.recs.${KEY} with the exact sudoers line`, () => {
      const value = messages?.settings?.sshCommands?.recs?.[KEY]
      expect(value, `${locale}: ${KEY}`).toBeTypeOf('string')
      expect(value, `${locale}: must quote the rule the orchestrator requires`).toContain('proxcenter ALL=(ALL) NOPASSWD: ALL')
      expect(value, `${locale}: must explain why an allowlist is not enough`).toContain('sudo -n sh -c')
    })
  }
})
