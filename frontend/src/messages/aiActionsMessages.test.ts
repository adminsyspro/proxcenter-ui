import { describe, expect, it } from 'vitest'

import de from './de.json'
import en from './en.json'
import es from './es.json'
import fr from './fr.json'
import ko from './ko.json'
import zhCN from './zh-CN.json'

/*
   roadmap#188: the action cards and plans of the assistant widget, in the six
   served locales. de.json has no English fallback, so a key missing there
   shows its raw path on the card.
*/

const locales: Record<string, any> = { en, fr, de, es, ko, 'zh-CN': zhCN }

const PLACEHOLDERS: Record<string, string[]> = {
  confirmTitle: ['{action}'],
  waitsFor: ['{step}'],
  planProgress: ['{done}', '{total}'],
  'title.snapshot': ['{name}'],
  'title.migrate': ['{target}'],
  'title.backupAdd': ['{job}'],
  'errors.taskFailed': ['{reason}'],
}

const flatten = (block: Record<string, unknown>, prefix = ''): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(block).flatMap(([k, v]) =>
      typeof v === 'object' && v !== null ? Object.entries(flatten(v as Record<string, unknown>, `${prefix}${k}.`)) : [[`${prefix}${k}`, v]]
    )
  )

const reference = Object.keys(flatten(en.ai.actions)).sort()

describe('AI actions (roadmap#188) i18n parity across the 6 served locales', () => {
  it('names a title for every kind and an effect for every disruptive one', () => {
    for (const key of [
      'title.snapshot', 'title.start', 'title.shutdown', 'title.reboot', 'title.migrate', 'title.drsApply',
      'title.backupAdd', 'title.maintenanceEnter', 'title.maintenanceExit',
      'effects.shutdown', 'effects.reboot', 'effects.maintenanceEnter', 'effects.maintenanceExit',
      'errors.capReached', 'errors.actionDisabled', 'errors.situationChanged',
    ]) expect(reference).toContain(key)
  })

  for (const [locale, messages] of Object.entries(locales)) {
    it(`${locale} declares every key of ai.actions, filled, without an em-dash, placeholders kept`, () => {
      const block = flatten(messages?.ai?.actions ?? {})

      expect(Object.keys(block).sort()).toEqual(reference)

      for (const key of reference) {
        const value = block[key] as string

        expect(value, `${locale}: ${key}`).toBeTypeOf('string')
        expect(value.trim(), `${locale}: ${key} is empty`).not.toBe('')
        expect(value, `${locale}: ${key} has an em-dash`).not.toContain('—')
        for (const ph of PLACEHOLDERS[key] || []) expect(value, `${locale}: ${key} needs ${ph}`).toContain(ph)
      }
    })
  }
})
