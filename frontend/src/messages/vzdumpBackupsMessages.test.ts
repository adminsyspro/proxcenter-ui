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
      // Forme ICU : `{count, plural, ...}`. Le placeholder nu `{count}` a
      // disparu avec la mise au pluriel, la virgule le prouve.
      expect(messages.backups.archivesCount, name).toContain('{count,')
    }
  })

  it('archivesCount is an ICU plural with an other branch in every locale', () => {
    for (const [name, messages] of locales) {
      expect(messages.backups.archivesCount, name).toMatch(/^\{count, plural,.*other \{/)
    }
  })

  it('archivesCount renders a singular form where the language has one', () => {
    // Le cas le plus probable chez un client sans PBS : un seul archive dans le
    // groupe. « 1 archives » était la régression visible.
    const singular: Record<string, string> = {
      en: '1 archive',
      fr: '1 archive',
      de: '1 Archiv',
      es: '1 archivo',
    }

    for (const [name, messages] of locales) {
      const expected = singular[name]

      if (!expected) continue

      expect(formatMessage(messages.backups.archivesCount, 1), name).toBe(expected)
    }
  })

  it('archivesCount keeps a plural form for counts above one', () => {
    const plural: Record<string, string> = {
      en: '3 archives',
      fr: '3 archives',
      de: '3 Archive',
      es: '3 archivos',
      ko: '아카이브 3개',
      'zh-CN': '3 个归档',
    }

    for (const [name, messages] of locales) {
      expect(formatMessage(messages.backups.archivesCount, 3), name).toBe(plural[name])
    }
  })
})

/** Rendu minimal d'un pluriel ICU à une seule variable, suffisant pour vérifier
 *  la forme des messages sans embarquer un formateur complet. */
function formatMessage(message: string, count: number): string {
  const m = /^\{count, plural,\s*(.*)\}$/s.exec(message)

  if (!m) return message

  const branches = new Map<string, string>()
  const re = /(=\d+|zero|one|two|few|many|other)\s*\{([^{}]*)\}/g
  let hit: RegExpExecArray | null

  while ((hit = re.exec(m[1])) !== null) branches.set(hit[1], hit[2])

  const category = new Intl.PluralRules('en').select(count)
  const chosen = branches.get(`=${count}`) ?? branches.get(category) ?? branches.get('other') ?? ''

  return chosen.replaceAll('#', String(count))
}
