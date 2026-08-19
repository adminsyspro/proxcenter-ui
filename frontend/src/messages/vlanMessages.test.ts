import { describe, expect, it } from 'vitest'

import de from './de.json'
import en from './en.json'
import es from './es.json'
import fr from './fr.json'
import ko from './ko.json'
import zhCN from './zh-CN.json'

const locales: Record<string, any> = { en, fr, de, es, ko, 'zh-CN': zhCN }

const requiredKeys = [
  'vdc.vxlanSectionTitle',
  'vdc.vxlanSectionHint',
  'vdc.vxlanZoneInfo',
  'vdc.vlanPoolsTitle',
  'vdc.vlanPoolsHint',
  'vdc.vlanPoolAdd',
  'vdc.vlanPoolBridge',
  'vdc.vlanPoolStart',
  'vdc.vlanPoolEnd',
  'vdc.vlanPoolNotVlanAware',
  'myVdc.vnetType',
  'myVdc.vnetTypeVxlan',
  'myVdc.vnetTypeVlan',
  'myVdc.vnetTypeHelp',
  'myVdc.vnetBridge',
  'myVdc.vnetVlanId',
  'myVdc.vnetVlanIdAutoHint',
  'myVdc.vnetVlanAutoAllocated',
  'myVdc.vnetExternalAddressing',
  'myVdc.vnetExternalAddressingHelp',
]

function get(messages: any, path: string): unknown {
  return path.split('.').reduce((node, key) => (node ? node[key] : undefined), messages)
}

/** Extract the set of `{placeholder}` tokens from a message string. */
function placeholderSet(value: unknown): Set<string> {
  const str = typeof value === 'string' ? value : ''
  return new Set(str.match(/\{[^}]+\}/g) ?? [])
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  return a.size === b.size && [...a].every((token) => b.has(token))
}

describe('tenant VLAN i18n parity across the 6 served locales', () => {
  for (const [locale, messages] of Object.entries(locales)) {
    it(`${locale} declares every VLAN key`, () => {
      for (const key of requiredKeys) {
        expect(get(messages, key), `${locale}: ${key}`).toBeTypeOf('string')
      }
    })

    it(`${locale} keeps the {ranges} placeholder in vnetVlanIdAutoHint`, () => {
      expect(get(messages, 'myVdc.vnetVlanIdAutoHint'), locale).toContain('{ranges}')
    })

    it(`${locale} neither drops nor invents a {placeholder} relative to en`, () => {
      for (const key of requiredKeys) {
        const enPlaceholders = placeholderSet(get(en, key))
        const localePlaceholders = placeholderSet(get(messages, key))
        expect(
          sameSet(localePlaceholders, enPlaceholders),
          `${locale}: ${key} has {${[...localePlaceholders].join(', ')}}, en has {${[...enPlaceholders].join(', ')}}`,
        ).toBe(true)
      }
    })
  }
})
