import { describe, expect, it } from 'vitest'

import de from './de.json'
import en from './en.json'
import es from './es.json'
import fr from './fr.json'
import ko from './ko.json'
import zhCN from './zh-CN.json'

const locales: Record<string, any> = { en, fr, de, es, ko, 'zh-CN': zhCN }

// The restricted sudoers profiles of /settings?tab=ssh-commands: every served
// locale names each profile and its features, and states plainly that the
// migrations profile is a full grant.
describe('SSH commands page: sudo profiles, i18n parity across the 6 served locales', () => {
  for (const [locale, messages] of Object.entries(locales)) {
    it(`${locale} describes every profile and the full grant of the migrations profile`, () => {
      const sc = messages?.settings?.sshCommands

      for (const p of ['nodeOps', 'siteRecovery', 'migrations']) {
        expect(sc?.profiles?.[p]?.label, `${locale}: ${p}.label`).toBeTypeOf('string')
        expect(sc?.profiles?.[p]?.features, `${locale}: ${p}.features`).toBeTypeOf('string')
      }
      expect(sc?.recs?.migrationsWarning, `${locale}: migrationsWarning`).toContain('proxcenter ALL=(ALL) NOPASSWD: ALL')
      for (const k of ['rootEquivalentWarning', 'sensitiveWarning', 'orchestratorRulesMissing']) expect(sc?.recs?.[k], `${locale}: ${k}`).toBeTypeOf('string')
      expect(sc?.recs?.sflowPinned, `${locale}: sflowPinned`).toContain('{target}')
      expect(messages?.networkFlows?.collectorFirewallHint, `${locale}: collectorFirewallHint`).toContain('6343')
      expect(sc?.recs?.rollingUpdateWarning, `${locale}: the rolling update no longer needs a full grant`).toBeUndefined()
      expect(sc?.recs?.shellWrapWarning, `${locale}: no /bin/sh rule any more`).toBeUndefined()
      expect(messages?.settings?.sshSudoProfiles, `${locale}: sshSudoProfiles`).toContain('{profiles}')
      expect(messages?.settings?.sshSudoMissing, `${locale}: sshSudoMissing`).toContain('{features}')
    })
  }

  it('no longer promises that a compromise is scoped to the allowlist', () => {
    expect(en.settings.sshCommands.recs.intro).not.toContain('scoped to the whitelisted')
    expect(fr.settings.sshCommands.recs.intro).not.toContain('bornée aux commandes whitelistées')
  })
})
