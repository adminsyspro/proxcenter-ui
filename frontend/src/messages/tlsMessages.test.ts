import { describe, expect, it } from 'vitest'

import { DNS_PROVIDERS } from '@/lib/tls/dns/catalog'

import de from './de.json'
import en from './en.json'
import es from './es.json'
import fr from './fr.json'
import ko from './ko.json'
import zhCN from './zh-CN.json'

const locales: Record<string, any> = { en, fr, de, es, ko, 'zh-CN': zhCN }

const requiredKeys = [
  'settings.tls.tabLabel',
  'settings.tls.title',
  'settings.tls.desc',
  'settings.tls.activeTitle',
  'settings.tls.noCertificate',
  'settings.tls.commonName',
  'settings.tls.issuer',
  'settings.tls.fingerprint',
  'settings.tls.validUntil',
  'settings.tls.san',
  'settings.tls.expired',
  'settings.tls.expiringSoon',
  'settings.tls.valid',
  'settings.tls.sourceTitle',
  'settings.tls.sourceSelfSigned',
  'settings.tls.sourceUploaded',
  'settings.tls.sourceAcme',
  'settings.tls.generateSelfSigned',
  'settings.tls.uploadTitle',
  'settings.tls.uploadCert',
  'settings.tls.uploadChain',
  'settings.tls.uploadKey',
  'settings.tls.uploadSubmit',
  'settings.tls.acmeTitle',
  'settings.tls.acmeDirectory',
  'settings.tls.acmeDirectoryLetsencrypt',
  'settings.tls.acmeDirectoryStaging',
  'settings.tls.acmeDirectoryZerossl',
  'settings.tls.acmeDirectoryCustom',
  'settings.tls.acmeEmail',
  'settings.tls.acmeDomains',
  'settings.tls.acmeDomainsHelp',
  'settings.tls.acmeRenewBefore',
  'settings.tls.acmeEab',
  'settings.tls.acmeEabKid',
  'settings.tls.acmeEabHmac',
  'settings.tls.acmeEabConfigured',
  'settings.tls.acmeOrder',
  'settings.tls.acmeOrdering',
  'settings.tls.acmeOrderOk',
  'settings.tls.listenerTitle',
  'settings.tls.enable',
  'settings.tls.enableHelp',
  'settings.tls.listeningOn',
  'settings.tls.notListening',
  'settings.tls.port',
  'settings.tls.portReadOnly',
  'settings.tls.redirectHttp',
  'settings.tls.redirectHttpHelp',
  'settings.tls.hsts',
  'settings.tls.hstsHelp',
  'settings.tls.hstsMaxAge',
  'settings.tls.hstsSubdomains',
  'settings.tls.hstsPreload',
  'settings.tls.minVersion',
  'settings.tls.minVersionHelp',
  'settings.tls.historyTitle',
  'settings.tls.historyActivate',
  'settings.tls.historyActive',
  'settings.tls.historyValidity',
  'settings.tls.urlIncoherent',
  'settings.tls.saved',
  'settings.tls.saveFailed',
  'settings.tls.errorKeyMismatch',
  'settings.tls.errorPassphrase',
  'settings.tls.errorBrokenChain',
  'settings.tls.errorNotACertificate',
  'settings.tls.errorUnreadableKey',
  'settings.tls.errorExpired',
  'settings.tls.errorPrivateKeyInCertificate',
  'settings.tls.acmeChallenge',
  'settings.tls.acmeChallengeHttp',
  'settings.tls.acmeChallengeDns',
  'settings.tls.acmeChallengeHttpHelp',
  'settings.tls.acmeChallengeDnsHelp',
  'settings.tls.acmeDomainsHelpDns',
  'settings.tls.dns.provider',
  'settings.tls.dns.docs',
  'settings.tls.dns.optional',
  'settings.tls.dns.secretStored',
  'settings.tls.dns.validationDelay',
  'settings.tls.dns.validationDelayHelp',
  'settings.tls.dns.test',
  'settings.tls.dns.testOk',
  'settings.tls.dns.testFailed',
  'settings.tls.acmeAuthority',
  'settings.tls.acmeAuthorityHint',
  'settings.tls.acmeEmailHint',
  'settings.tls.acmeDirectoryHint',
  'settings.tls.acmeEabHint',
  // The DNS-01 form draws one help line per provider and one label per field
  // straight from the catalog, so a provider added there without its
  // translations shows raw key paths.
  ...DNS_PROVIDERS.map(p => `settings.tls.dns.help.${p.id}`),
  ...[...new Set(DNS_PROVIDERS.flatMap(p => p.fields.map(f => f.key)))].map(key => `settings.tls.dns.fields.${key}`),
  ...DNS_PROVIDERS.flatMap(p => p.fields.filter(f => 'hint' in f && f.hint).map(f => `settings.tls.dns.hints.${f.key}`)),
]

function get(messages: any, path: string): unknown {
  return path.split('.').reduce((node, key) => (node ? node[key] : undefined), messages)
}

describe('TLS settings i18n parity across the 6 served locales', () => {
  for (const [locale, messages] of Object.entries(locales)) {
    it(`${locale} declares every TLS key with a non-empty value`, () => {
      for (const key of requiredKeys) {
        const value = get(messages, key)

        expect(value, `${locale}: ${key}`).toBeTypeOf('string')
        expect((value as string).length, `${locale}: ${key} is empty`).toBeGreaterThan(0)
      }
    })

    // next-intl parses every message as ICU: a literal brace opens a variable
    // and throws at render time.
    it(`${locale} keeps the TLS messages free of ICU braces`, () => {
      for (const key of requiredKeys) {
        // An angle bracket opens a rich-text tag the same way.
        expect(get(messages, key), `${locale}: ${key}`).not.toMatch(/[{}<>]/)
      }
    })
  }
})
