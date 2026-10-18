import { describe, expect, it } from 'vitest'

import de from './de.json'
import en from './en.json'
import es from './es.json'
import fr from './fr.json'
import ko from './ko.json'
import zhCN from './zh-CN.json'

type Messages = Record<string, any>

function keyPaths(node: Messages, prefix = ''): string[] {
  return Object.entries(node).flatMap(([key, value]) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? keyPaths(value as Messages, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  )
}

const reference = keyPaths((en as Messages).settings.apiTokens).sort()

describe('settings.apiTokens i18n parity across the 6 served locales', () => {
  it('declares the required keys in en.json', () => {
    for (const key of [
      'tabLabel', 'title', 'subtitle', 'newToken', 'referenceButton', 'reference.title',
      'reference.subtitle', 'reference.hint', 'reference.backToTokens', 'reference.thisInstance',
      'columns.prefix', 'columns.name',
      'columns.tenant', 'columns.scopes', 'columns.expires', 'columns.lastUsed', 'never', 'delete',
      // `revoked` stays: nothing writes revoked_at any more, but the grid still
      // has to chip the legacy rows that existing databases carry.
      'revoked', 'deleteConfirm', 'deleteSuccess', 'loadError', 'createError',
      'dialog.title', 'dialog.name', 'dialog.description', 'dialog.expiration',
      'dialog.expirationNone', 'dialog.expiration30', 'dialog.expiration90',
      'dialog.expiration365', 'dialog.expirationCustom', 'dialog.customDays',
      'dialog.scopes', 'dialog.tenant', 'dialog.connections', 'dialog.connectionsAll',
      'dialog.create', 'dialog.cancel', 'dialog.confirm', 'reveal.title', 'reveal.warning',
      'reveal.copy', 'reveal.copied', 'reveal.done',
      // Write mode: the per-domain None/Read/Write picker and its write
      // sub-scope chips, the grantable check, the write rate limit, the
      // reference warning and the audit actor of a gone token.
      'dialog.access.none', 'dialog.access.read', 'dialog.access.write',
      'dialog.domains.vms', 'dialog.domains.backups', 'dialog.domains.storage', 'dialog.domains.nodes',
      'dialog.domains.automation', 'dialog.domains.alerts', 'dialog.domains.reports',
      'dialog.subScopes.vmsPower', 'dialog.subScopes.vmsWrite', 'dialog.subScopes.vmsSnapshot',
      'dialog.subScopes.vmsMigrate', 'dialog.subScopes.vmsDelete', 'dialog.subScopes.backupsWrite',
      'dialog.subScopes.backupsRestore', 'dialog.subScopes.backupsDelete', 'dialog.subScopes.haWrite',
      'dialog.subScopes.poolsWrite', 'dialog.subScopes.networkWrite', 'dialog.subScopes.firewallWrite',
      'dialog.subScopesLabel', 'dialog.readOnlyDomain', 'dialog.domainNotGrantable',
      'dialog.writeWarning', 'dialog.scopeNotGrantable',
      'dialog.scopesLoading', 'dialog.grantableError', 'dialog.writeRateLimit', 'dialog.writeRateLimitHelp',
      'reference.writeWarning', 'deletedToken',
    ]) {
      expect(reference).toContain(key)
    }
    // The per-domain picker replaced the Read list and the Write accordion.
    expect(reference).not.toContain('dialog.readScopes')
    expect(reference).not.toContain('dialog.writeScopes')
  })

  it.each([['en', en], ['fr', fr], ['de', de], ['zh-CN', zhCN], ['ko', ko], ['es', es]])(
    '%s no longer calls the API or its tokens read-only, and uses no dash punctuation',
    (_locale, messages) => {
      const tokens = (messages as Messages).settings.apiTokens
      for (const text of [tokens.subtitle, tokens.reference.subtitle]) {
        expect(text).not.toMatch(/read-only|lecture seule|schreibgeschützt|solo lectura|읽기 전용|只读/i)
      }
      for (const key of keyPaths(tokens)) {
        const value = key.split('.').reduce((node: any, part) => node[part], tokens)
        expect(value, key).not.toMatch(/[\u2013\u2014]/)
      }
    },
  )

  it.each([['fr', fr], ['de', de], ['zh-CN', zhCN], ['ko', ko], ['es', es]])(
    '%s has exactly the same key paths as en',
    (_locale, messages) => {
      expect(keyPaths((messages as Messages).settings.apiTokens).sort()).toEqual(reference)
    },
  )
})
