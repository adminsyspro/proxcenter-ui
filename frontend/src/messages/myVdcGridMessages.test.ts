import { describe, expect, it } from 'vitest'

import de from './de.json'
import en from './en.json'
import es from './es.json'
import fr from './fr.json'
import ko from './ko.json'
import zhCN from './zh-CN.json'

const locales: Record<string, any> = { en, fr, de, es, ko, 'zh-CN': zhCN }

const keys = [
  'summary', 'vcpus', 'ram', 'storage', 'vms', 'nodes', 'storages', 'networks', 'backups',
  'health.over', 'health.near', 'health.within', 'health.none',
].map(k => `myVdc.grid.${k}`)

const get = (messages: any, path: string): unknown => path.split('.').reduce((node, key) => (node ? node[key] : undefined), messages)

describe('My vDC grid messages', () => {
  for (const [locale, messages] of Object.entries(locales)) {
    it(`${locale} has every key of the vDC cards`, () => {
      for (const key of keys) expect(typeof get(messages, key), `${locale} ${key}`).toBe('string')
    })
  }

  it('keeps the placeholders of the English summary and counts', () => {
    for (const [locale, messages] of Object.entries(locales)) {
      expect(get(messages, 'myVdc.grid.summary'), locale).toMatch(/\{vdcs[,}][\s\S]*\{vms[,}]/)
      for (const k of ['nodes', 'storages', 'networks', 'backups']) {
        expect(get(messages, `myVdc.grid.${k}`), `${locale} ${k}`).toMatch(/[{#]/)
      }
    }
  })
})
