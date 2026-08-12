import { describe, it, expect } from 'vitest'

import en from './en.json'
import fr from './fr.json'
import de from './de.json'
import zhCN from './zh-CN.json'
import ko from './ko.json'
import es from './es.json'

type Messages = Record<string, any>

const REQUIRED = [
  'sourceVzdump',
  'vzdumpNoBrowsing',
  'archivesCount',
  'noBackupsAnywhereTitle',
  'noBackupsAnywhereHint',
]

const locales: Array<[string, Messages]> = [
  ['en', en as Messages],
  ['fr', fr as Messages],
  ['de', de as Messages],
  ['zh-CN', zhCN as Messages],
  ['ko', ko as Messages],
  ['es', es as Messages],
]

describe('vzdump backup message keys', () => {
  for (const [name, messages] of locales) {
    it(`${name} defines every vzdump backup key`, () => {
      for (const key of REQUIRED) {
        expect(messages.backups?.[key], `${name}.backups.${key}`).toBeTruthy()
      }
    })
  }

  it('archivesCount carries the count placeholder in every locale', () => {
    for (const [name, messages] of locales) {
      expect(messages.backups.archivesCount, name).toContain('{count}')
    }
  })
})
