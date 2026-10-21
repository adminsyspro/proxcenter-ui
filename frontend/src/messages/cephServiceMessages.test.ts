import { describe, expect, it } from 'vitest'

import de from './de.json'
import en from './en.json'
import es from './es.json'
import fr from './fr.json'
import ko from './ko.json'
import zhCN from './zh-CN.json'

/*
   ui#1164: the Ceph service management strings (actions cell, confirmation
   dialog, create OSD / monitor / manager dialogs), in the six served locales.
   de.json has no English fallback, so a key missing there shows its raw path.
*/

const locales: Record<string, any> = { en, fr, de, es, ko, 'zh-CN': zhCN }

const PLACEHOLDERS: Record<string, string[]> = {
  startService: ['{service}'],
  stopService: ['{service}'],
  restartService: ['{service}'],
  alreadyRunning: ['{service}'],
  notRunning: ['{service}'],
  stopTitle: ['{service}'],
  restartTitle: ['{service}'],
  stopBody: ['{service}', '{host}'],
  restartBody: ['{service}', '{host}'],
  notOkToStop: ['{service}'],
  notOkToStopPgs: ['{count, plural,'],
  notOkToStopUnknown: ['{error}'],
  startStarted: ['{service}', '{host}'],
  stopStarted: ['{service}', '{host}'],
  restartStarted: ['{service}', '{host}'],
  failed: ['{error}'],
  createOsdTitle: ['{node}'],
  disksFailed: ['{error}'],
  osdCreateStarted: ['{dev}', '{node}'],
  createMonTitle: ['{node}'],
  createMgrTitle: ['{node}'],
  monCreateStarted: ['{node}'],
  mgrCreateStarted: ['{node}'],
  createFailed: ['{error}'],
}

const reference = Object.keys(en.cephService).sort()

describe('Ceph service management (ui#1164) i18n parity across the 6 served locales', () => {
  it('names every string the actions cell, the dialogs and the card headers use', () => {
    for (const key of [
      'start', 'stop', 'restart', 'startService', 'stopService', 'restartService', 'alreadyRunning', 'notRunning',
      'noPermission', 'refresh', 'createMon', 'createMgr', 'monExists', 'mgrExists',
      'stopTitle', 'restartTitle', 'stopBody', 'restartBody', 'monQuorumWarning', 'osdOkToStopHint',
      'notOkToStop', 'notOkToStopPgs', 'notOkToStopUnknown', 'acknowledge',
      'startStarted', 'stopStarted', 'restartStarted', 'failed',
      'createMonTitle', 'createMgrTitle', 'createMonHelp', 'createMgrHelp', 'monAddress', 'monAddressHelp',
      'monCreateStarted', 'mgrCreateStarted', 'createFailed',
    ]) expect(reference).toContain(key)
  })

  for (const [locale, messages] of Object.entries(locales)) {
    it(`${locale} declares every key of cephService, filled, without an em-dash, placeholders kept`, () => {
      const block = messages?.cephService
      expect(block, locale).toBeTypeOf('object')
      expect(Object.keys(block).sort()).toEqual(reference)
      for (const key of reference) {
        const value = block[key]
        expect(value, `${locale}: ${key}`).toBeTypeOf('string')
        expect(value.trim(), `${locale}: ${key} is empty`).not.toBe('')
        expect(value, `${locale}: ${key} has an em-dash`).not.toContain('—')
        for (const ph of PLACEHOLDERS[key] || []) expect(value, `${locale}: ${key} needs ${ph}`).toContain(ph)
      }
    })
  }
})
