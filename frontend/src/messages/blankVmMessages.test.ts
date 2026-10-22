import { describe, expect, it } from 'vitest'

import de from './de.json'
import en from './en.json'
import es from './es.json'
import fr from './fr.json'
import ko from './ko.json'
import zhCN from './zh-CN.json'

const locales: Record<string, any> = { en, fr, de, es, ko, 'zh-CN': zhCN }

const requiredKeys = [
  'vdc.blankVmsTitle',
  'vdc.allowBlankVms',
  'vdc.allowBlankVmsHint',
  'inventory.createVm.noBlankVmVdc',
  'inventory.createVm.noVdcNode',
  'myVdc.selectVdc',
]

function get(messages: any, path: string): unknown {
  return path.split('.').reduce((node, key) => (node ? node[key] : undefined), messages)
}

describe('vDC blank VM i18n parity across the 6 served locales (#1171)', () => {
  for (const [locale, messages] of Object.entries(locales)) {
    it(`${locale} declares every blank VM key`, () => {
      for (const key of requiredKeys) {
        expect(get(messages, key), `${locale}: ${key}`).toBeTypeOf('string')
      }
    })
  }
})
