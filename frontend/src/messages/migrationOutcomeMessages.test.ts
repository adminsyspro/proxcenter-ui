import { describe, expect, it } from 'vitest'

import de from './de.json'
import en from './en.json'
import es from './es.json'
import fr from './fr.json'
import ko from './ko.json'
import zhCN from './zh-CN.json'

const locales: Record<string, any> = { en, fr, de, es, ko, 'zh-CN': zhCN }

// #926: failure reasons, task log links, truthful bulk outcome, pending-changes preflight.
const keys: Array<[string, string[]]> = [
  ['tasks.viewLog', []],
  ['vmActions.migrateStillRunning', []],
  ['vmActions.migrateGuestFailed', ['{name}', '{reason}']],
  ['updates.vmActionsFailedTitle', ['{count}']],
  ['updates.vmMigrateFailed', []],
  ['inventory.nodeActionMigrateFailedDesc', []],
  ['migrationPreflight.pendingTitle', ['{count}']],
  ['migrationPreflight.pendingBody', []],
]

const lookup = (messages: any, path: string) => path.split('.').reduce((node, part) => node?.[part], messages)

describe('migration outcome i18n parity across the 6 served locales (#926)', () => {
  for (const [locale, messages] of Object.entries(locales)) {
    for (const [key, placeholders] of keys) {
      it(`${locale} declares ${key}`, () => {
        const value = lookup(messages, key)

        expect(value, `${locale}: ${key}`).toBeTypeOf('string')
        expect(value.length, `${locale}: ${key} must not be empty`).toBeGreaterThan(0)
        for (const placeholder of placeholders) expect(value, `${locale}: ${key}`).toContain(placeholder)
      })
    }
  }

  it('no longer guesses that guests whose migration failed sit on local storage', () => {
    expect(en.inventory.nodeActionMigrateFailedDesc).not.toMatch(/local storage/i)
  })
})
