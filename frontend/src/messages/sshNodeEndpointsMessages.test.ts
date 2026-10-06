import { describe, expect, it } from 'vitest'

import de from './de.json'
import en from './en.json'
import es from './es.json'
import fr from './fr.json'
import ko from './ko.json'
import zhCN from './zh-CN.json'

const locales: Record<string, any> = { en, fr, de, es, ko, 'zh-CN': zhCN }

const KEYS = [
  'title',
  'description',
  'address',
  'addressPlaceholder',
  'port',
  'interfaces',
  'invalidPort',
  'saveFailed',
  'noNodes',
  'newConnectionHint',
  'sourceOverride',
  'sourceProxmox',
]

describe('Per-node SSH address and port editor: i18n parity across the 6 served locales', () => {
  for (const [locale, messages] of Object.entries(locales)) {
    it(`${locale} declares every settings.sshNodeEndpoints key`, () => {
      const block = messages?.settings?.sshNodeEndpoints
      for (const key of KEYS) {
        expect(block?.[key], `${locale}: settings.sshNodeEndpoints.${key}`).toBeTypeOf('string')
        expect(block[key].trim(), `${locale}: ${key} is empty`).not.toBe('')
      }
      expect(block.saveFailed, `${locale}: saveFailed keeps the {error} placeholder`).toContain('{error}')
      expect(block.invalidPort, `${locale}: invalidPort names the range`).toContain('65535')
    })

    it(`${locale} no longer ships the keys of the removed address picker`, () => {
      for (const key of ['sshAutoDetect', 'sshCustomAddress', 'sshNodeInterfaces', 'sshAddressesDescription']) {
        expect(messages?.updates?.[key], `${locale}: updates.${key}`).toBeUndefined()
      }
      expect(messages?.updates?.sshAddresses, `${locale}: wizard card title`).toBeTypeOf('string')
    })
  }
})
