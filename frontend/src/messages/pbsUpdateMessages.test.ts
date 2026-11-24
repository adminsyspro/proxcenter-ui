import { describe, expect, it } from 'vitest'

import { PBS_FINDING_CODES } from '@/lib/pbs/updateView'

import de from './de.json'
import en from './en.json'
import es from './es.json'
import fr from './fr.json'
import ko from './ko.json'
import zhCN from './zh-CN.json'

const locales: Record<string, any> = { en, fr, de, es, ko, 'zh-CN': zhCN }

function flatten(obj: Record<string, any>, prefix = ''): Record<string, string> {
  return Object.entries(obj).reduce<Record<string, string>>((acc, [k, v]) => {
    if (v && typeof v === 'object') Object.assign(acc, flatten(v, `${prefix}${k}.`))
    else acc[`${prefix}${k}`] = String(v)

    return acc
  }, {})
}

// Arguments only: `{name}` and `{name, plural, …}`, not the text of a plural branch (`one {…}`).
const placeholders = (s: string) =>
  [...new Set([...s.matchAll(/(?<!(?:=\d+|zero|one|two|few|many|other) )\{(\w+)[,}]/g)].map(m => m[1]))].sort()

describe('backup server update messages', () => {
  const reference = flatten(en.inventory.pbsUpdate)

  it.each(Object.keys(locales))('%s has every key, with the same placeholders', locale => {
    const messages = flatten(locales[locale].inventory.pbsUpdate)

    expect(Object.keys(messages).sort()).toEqual(Object.keys(reference).sort())
    for (const [key, text] of Object.entries(reference)) {
      expect(placeholders(messages[key]), `${locale} ${key}`).toEqual(placeholders(text))
      expect(messages[key].trim(), `${locale} ${key}`).not.toBe('')
    }
  })

  it('words every finding the orchestrator can raise', () => {
    for (const code of PBS_FINDING_CODES) expect(reference[`findings.${code}`], code).toBeTruthy()
    expect(reference['findings.pbs_apt_update_subscription']).toBeTruthy()
  })

  it.each(Object.keys(locales))('%s names the backup server profile and its SSH hints', locale => {
    const m = locales[locale]

    expect(m.settings.sshCommands.profiles.pbsOps.label).toBeTruthy()
    expect(m.settings.sshCommands.profiles.pbsOps.features).toBeTruthy()
    expect(m.settings.sshInfoPbs).toBeTruthy()
    expect(m.inventory.pbsUpdatesUpgradeSshHint).toBeTruthy()
  })

  it('never uses an em dash', () => {
    for (const locale of Object.keys(locales)) {
      for (const text of Object.values(flatten(locales[locale].inventory.pbsUpdate))) expect(text).not.toContain('—')
    }
  })
})
