import { describe, expect, it } from 'vitest'

import de from './de.json'
import en from './en.json'
import es from './es.json'
import fr from './fr.json'
import ko from './ko.json'
import zhCN from './zh-CN.json'

/*
   ui#1164: the per-host Ceph noout strings, in the six served locales. de.json
   has no English fallback, so a key missing there shows its raw path.
*/

const locales: Record<string, any> = { en, fr, de, es, ko, 'zh-CN': zhCN }

const PLACEHOLDERS: Record<string, string[]> = {
  setOption: ['{count}'],
  setHelp: ['{host}', '{osds}'],
  removeOption: ['{count}'],
  removeHelp: ['{host}', '{osds}'],
  healthNotOk: ['{status}'],
  otherHosts: ['{hosts}'],
  notOkToStopPgs: ['{count}'],
  notOkToStopUnknown: ['{error}'],
  osdsNotUpHint: ['{osds}'],
  removed: ['{host}'],
  keptOsdsDown: ['{osds}'],
  removeFailed: ['{error}'],
  chipTooltip: ['{host}', '{osds}'],
  removeTitle: ['{host}'],
  hostFlagUnset: ['{flag}', '{host}'],
  hostFlagTooltip: ['{flag}', '{host}'],
}

const reference = Object.keys(en.cephNoout).sort()

describe('Ceph noout (ui#1164) i18n parity across the 6 served locales', () => {
  it('names every string the option, the chip and the flags card use', () => {
    for (const key of [
      'setOption', 'setHelp', 'removeOption', 'removeHelp', 'globalAlreadySet', 'healthNotOk', 'otherHosts',
      'notOkToStop', 'notOkToStopPgs', 'notOkToStopUnknown', 'acknowledge', 'osdsNotUpHint', 'settingStep',
      'removed', 'keptOsdsDown', 'removeFailed', 'chip', 'chipTooltip', 'removeTitle', 'forceRemoveHelp',
      'forceRemove', 'hostFlagUnset', 'hostFlagTooltip',
    ]) expect(reference).toContain(key)
  })

  for (const [locale, messages] of Object.entries(locales)) {
    it(`${locale} declares every key of cephNoout, filled, without an em-dash, placeholders kept`, () => {
      const block = messages?.cephNoout
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

    it(`${locale} labels the two alert thresholds`, () => {
      for (const key of ['cephNooutMaxHours', 'cephNooutMaxHoursDesc', 'cephNooutOrphan', 'cephNooutOrphanDesc', 'cephNooutHoursUnit', 'cephNooutMinutesUnit']) {
        expect(messages?.alerts?.[key], `${locale}: alerts.${key}`).toBeTypeOf('string')
      }
    })
  }

  it('is really translated outside English', () => {
    for (const locale of ['fr', 'de', 'es', 'ko', 'zh-CN']) {
      expect(locales[locale].cephNoout.acknowledge, locale).not.toBe(en.cephNoout.acknowledge)
      expect(locales[locale].cephNoout.notOkToStop, locale).not.toBe(en.cephNoout.notOkToStop)
      expect(locales[locale].alerts.cephNooutMaxHoursDesc, locale).not.toBe(en.alerts.cephNooutMaxHoursDesc)
    }
  })
})

/*
   The flag views: the host section of the node panel, the per-host list of
   the cluster dialog, the chips of the OSD tables and the health detail.
*/
const CEPH_FLAG_VIEW_KEYS: Record<string, string[]> = {
  flagsClusterWide: [],
  flagsThisHost: ['{host}'],
  hostFlagsDescription: [],
  flagNoin: [],
  flagNoinDesc: [],
  flagsPerHost: [],
  perHostFlagsDescription: [],
  osdFlagOnHost: ['{flag}', '{host}'],
  osdFlagOnOsd: ['{flag}', '{osd}'],
  healthDetailMore: ['{count}'],
}

describe('Ceph flag views (ui#1164) i18n parity across the 6 served locales', () => {
  for (const [locale, messages] of Object.entries(locales)) {
    it(`${locale} declares every flag view string, filled, without an em-dash, placeholders kept`, () => {
      for (const [key, placeholders] of Object.entries(CEPH_FLAG_VIEW_KEYS)) {
        const value = messages?.ceph?.[key]
        expect(value, `${locale}: ceph.${key}`).toBeTypeOf('string')
        expect(value.trim(), `${locale}: ceph.${key} is empty`).not.toBe('')
        expect(value, `${locale}: ceph.${key} has an em-dash`).not.toContain('—')
        for (const ph of placeholders) expect(value, `${locale}: ceph.${key} needs ${ph}`).toContain(ph)
      }
    })
  }

  it('is really translated outside English', () => {
    for (const locale of ['fr', 'de', 'es', 'ko', 'zh-CN']) {
      expect(locales[locale].ceph.flagsThisHost, locale).not.toBe(en.ceph.flagsThisHost)
      expect(locales[locale].ceph.hostFlagsDescription, locale).not.toBe(en.ceph.hostFlagsDescription)
      expect(locales[locale].ceph.perHostFlagsDescription, locale).not.toBe(en.ceph.perHostFlagsDescription)
    }
  })
})
