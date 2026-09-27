import { describe, expect, it } from 'vitest'

import de from './de.json'
import en from './en.json'
import es from './es.json'
import fr from './fr.json'
import ko from './ko.json'
import zhCN from './zh-CN.json'

const locales: Record<string, any> = { en, fr, de, es, ko, 'zh-CN': zhCN }
const requiredKeys = [
  'settings.licenseInstallFingerprint',
  'settings.licenseInstallFingerprintHint',
  'settings.licenseCopyFingerprint',
  'settings.licenseFingerprintCopied',
  'settings.licenseBindingInstall',
  'settings.licenseBindingFloating',
  'settings.licenseGenerateRequest',
  'settings.licenseGenerateRequestHint',
  'settings.licenseRequestDownloaded',
  'settings.licenseRequestFailed',
  'settings.licenseSigningUnavailable',
  'settings.licenseResetIdentity',
  'settings.licenseResetIdentityConfirmTitle',
  'settings.licenseResetIdentityConfirm',
  'settings.licenseIdentityReset',
  'settings.licenseIdentityResetFailed',
  'settings.licenseBindingErrorTitle',
  'settings.licenseBindingErrorBody',
  'settings.licenseBindingErrorStep1',
  'settings.licenseBindingErrorStep2',
  'settings.licenseBindingErrorStep3',
  'settings.licenseBindingExpected',
  'settings.licenseBindingActual',
  'license.bindingMismatch',
]

function get(messages: any, path: string): unknown {
  return path.split('.').reduce((node, key) => (node ? node[key] : undefined), messages)
}

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort()
}

describe('license binding i18n parity across the 6 served locales', () => {
  for (const [locale, messages] of Object.entries(locales)) {
    it(`${locale} declares every key, non-empty, with the same placeholders as en`, () => {
      for (const key of requiredKeys) {
        const value = get(messages, key)
        expect(value, `${locale}: ${key}`).toBeTypeOf('string')
        expect((value as string).length, `${locale}: ${key} is empty`).toBeGreaterThan(0)
        expect(placeholders(value as string), `${locale}: ${key} placeholders`).toEqual(placeholders(get(en, key) as string))
      }
    })
  }
})
