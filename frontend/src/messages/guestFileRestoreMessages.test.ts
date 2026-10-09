import { describe, it, expect } from 'vitest'

import en from './en.json'
import fr from './fr.json'
import de from './de.json'
import zhCN from './zh-CN.json'
import ko from './ko.json'
import es from './es.json'

type Messages = Record<string, any>

const locales: Array<[string, Messages]> = [
  ['en', en as Messages],
  ['fr', fr as Messages],
  ['de', de as Messages],
  ['zh-CN', zhCN as Messages],
  ['ko', ko as Messages],
  ['es', es as Messages],
]

// Every leaf path of an object, dotted ("settings.title", "status.failed").
function leafPaths(obj: Messages, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object' ? leafPaths(v, `${prefix}${k}.`) : [`${prefix}${k}`]
  )
}

function get(obj: Messages, dotted: string): unknown {
  return dotted.split('.').reduce<any>((o, k) => (o == null ? o : o[k]), obj)
}

const BACKUPS_KEYS = ['vmImageBrowse', 'vmImageBrowseHint', 'pickPveStorage', 'noPveStorageForImage']

const REFERENCE = leafPaths((en as Messages).guestFileRestore)

describe('guest file restore message keys', () => {
  it('the English namespace carries the keys the entry points rely on', () => {
    for (const key of ['tabLabel', 'restoreIntoGuest', 'restoreSelectionIntoGuest', 'title', 'settings.title']) {
      expect(REFERENCE, key).toContain(key)
    }
  })

  for (const [name, messages] of locales) {
    it(`${name} defines every guestFileRestore key`, () => {
      for (const key of REFERENCE) {
        expect(get(messages.guestFileRestore ?? {}, key), `${name}.guestFileRestore.${key}`).toBeTruthy()
      }
    })

    it(`${name} defines the backup explorer keys`, () => {
      for (const key of BACKUPS_KEYS) {
        expect(messages.backups?.[key], `${name}.backups.${key}`).toBeTruthy()
      }

    })

    it(`${name} has no extra guestFileRestore key and no em-dash`, () => {
      expect(leafPaths(messages.guestFileRestore ?? {}).sort()).toEqual([...REFERENCE].sort())

      for (const key of REFERENCE) {
        expect(String(get(messages.guestFileRestore, key)), `${name}.guestFileRestore.${key}`).not.toContain('—')
      }
    })
  }

  it('keeps the same placeholders in every locale', () => {
    const placeholders = (s: string) => [...s.matchAll(/\{(\w+)[,}]/g)].map(m => m[1]).sort()

    for (const [name, messages] of locales) {
      for (const key of REFERENCE) {
        const ref = placeholders(String(get(en as Messages, `guestFileRestore.${key}`)))

        expect(placeholders(String(get(messages, `guestFileRestore.${key}`))), `${name}.guestFileRestore.${key}`).toEqual(ref)
      }
    }
  })
})
