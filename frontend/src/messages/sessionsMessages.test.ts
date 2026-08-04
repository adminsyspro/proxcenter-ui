import { describe, it, expect } from 'vitest'

import en from './en.json'
import fr from './fr.json'
import de from './de.json'
import zhCN from './zh-CN.json'
import ko from './ko.json'
import es from './es.json'

type Messages = Record<string, unknown>

function keyPaths(obj: Messages, prefix = ''): string[] {
  const out: string[] = []
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (value && typeof value === 'object') {
      out.push(...keyPaths(value as Messages, path))
    } else {
      out.push(path)
    }
  }
  return out.sort()
}

const locales: Array<[string, Messages]> = [
  ['fr', fr as Messages],
  ['de', de as Messages],
  ['zh-CN', zhCN as Messages],
  ['ko', ko as Messages],
  ['es', es as Messages],
]

describe('sessions message namespace', () => {
  const reference = keyPaths((en as Messages).sessions as Messages)

  it('en defines the full sessions key inventory', () => {
    for (const required of [
      'cardTitle',
      'empty',
      'currentChip',
      'ipLabel',
      'lastActiveLabel',
      'signedInLabel',
      'revokeButton',
      'revokeConfirmTitle',
      'revokeConfirmBody',
      'revokeAllButton',
      'revokeAllConfirmTitle',
      'revokeAllConfirmBody',
      'columnHeader',
      'adminRevokeMenu',
      'adminRevokeConfirmTitle',
      'adminRevokeConfirmBody',
      'adminAllTab',
      'adminAllEmptyTitle',
      'adminAllEmptyDesc',
      'userHeader',
      'tenantHeader',
      'deviceHeader',
      'adminRevokeOneMenu',
      'adminRevokeOneConfirmTitle',
      'adminRevokeOneConfirmBody',
      'adminAllTruncatedWarning',
      'adminRevokeOwnConfirmWarning',
      'adminRevokeAllOwnConfirmWarning',
    ]) {
      expect(reference).toContain(required)
    }
  })

  for (const [name, messages] of locales) {
    it(`${name} has exactly the same sessions keys as en`, () => {
      expect(messages.sessions, `${name}.json is missing the top-level "sessions" section`).toBeDefined()
      expect(keyPaths(messages.sessions as Messages)).toEqual(reference)
    })
  }
})
