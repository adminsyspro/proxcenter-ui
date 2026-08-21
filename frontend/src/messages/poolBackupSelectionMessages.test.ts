import { describe, expect, it } from 'vitest'

import de from './de.json'
import en from './en.json'
import es from './es.json'
import fr from './fr.json'
import ko from './ko.json'
import zhCN from './zh-CN.json'

const locales: Record<string, any> = { en, fr, de, es, ko, 'zh-CN': zhCN }

// Pool-based backup job selection (issue #746): the option lives in two
// dialogs, the Operations > Backups tab (backups.*) and the cluster/node
// Backups panel of the inventory (inventory.*), so both namespaces carry it.
const requiredKeys = [
  'backups.poolBasedMode',
  'backups.poolToBackup',
  'backups.noResourcePool',
  'inventory.poolBasedSelection',
  'inventory.poolToBackup',
  'inventory.noResourcePool',
  'inventory.poolSelection',
]

function get(messages: any, path: string): unknown {
  return path.split('.').reduce((node, key) => (node ? node[key] : undefined), messages)
}

describe('pool-based backup selection i18n parity across the 6 served locales', () => {
  for (const [locale, messages] of Object.entries(locales)) {
    it(`${locale} declares every pool selection key with a non-empty value`, () => {
      for (const key of requiredKeys) {
        const value = get(messages, key)

        expect(value, `${locale}: ${key}`).toBeTypeOf('string')
        expect((value as string).length, `${locale}: ${key} is empty`).toBeGreaterThan(0)
      }
    })

    it(`${locale} keeps the {name} placeholder in the pool selection summary`, () => {
      // The backup jobs grid renders the pool name through this key, a lost
      // placeholder would show the label with no pool at all.
      expect(get(messages, 'inventory.poolSelection'), locale).toContain('{name}')
      expect(get(messages, 'backups.pool'), locale).toContain('{name}')
    })
  }
})
