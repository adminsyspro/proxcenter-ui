import { describe, it, expect } from 'vitest'

import en from './en.json'
import fr from './fr.json'
import de from './de.json'
import zhCN from './zh-CN.json'
import ko from './ko.json'
import es from './es.json'

type Messages = Record<string, unknown>

function keyPaths(obj: Messages, prefix = ''): string[] {
  const out: string[] = []
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (value && typeof value === 'object') {
      out.push(...keyPaths(value as Messages, path))
    } else {
      out.push(path)
    }
  }
  return out.sort()
}

const locales: Array<[string, Messages]> = [
  ['fr', fr as Messages],
  ['de', de as Messages],
  ['zh-CN', zhCN as Messages],
  ['ko', ko as Messages],
  ['es', es as Messages],
]

describe('ha message namespace', () => {
  const reference = keyPaths((en as Messages).ha as Messages)

  it('en defines the full HA key inventory', () => {
    for (const required of [
      'tabLabel',
      'healthy',
      'syncMode',
      'common.cancel',
      'wizard.title',
      'wizard.snapshotConfirm',
      'wizard.backupInfo',
      'wizard.externalUrlDetected',
      'wizard.successExternalNote',
      'dashboard.title',
      'node.rolePrimary',
      'ops.switchoverTitle',
      'services.statusUnknown',
    ]) {
      expect(reference).toContain(required)
    }
  })

  for (const [name, messages] of locales) {
    it(`${name} has exactly the same ha keys as en`, () => {
      expect(messages.ha, `${name}.json is missing the top-level "ha" section`).toBeDefined()
      expect(keyPaths(messages.ha as Messages)).toEqual(reference)
    })
  }
})
