/**
 * The DRS storage panel renders drsPage.checkStorageManually with t.rich and
 * maps exactly one tag, <strong>. This pins that contract on every locale: a
 * catalogue entry introducing another tag would make t.rich report an error
 * at runtime, and the node name has to come out as text, never as markup
 * (it used to go through dangerouslySetInnerHTML).
 */
import { createTranslator } from 'next-intl'
import { describe, expect, it } from 'vitest'

import de from '@/messages/de.json'
import en from '@/messages/en.json'
import es from '@/messages/es.json'
import fr from '@/messages/fr.json'
import ko from '@/messages/ko.json'
import zhCN from '@/messages/zh-CN.json'

const LOCALES = { en, fr, de, es, ko, 'zh-CN': zhCN } as Record<string, any>
const KEY = 'drsPage.checkStorageManually'
const HOSTILE_NODE = '<img src=x onerror=alert(1)>'

function flatten(node: unknown): unknown[] {
  return Array.isArray(node) ? node.flatMap(flatten) : [node]
}

describe(KEY, () => {
  for (const [locale, messages] of Object.entries(LOCALES)) {
    it(`${locale}: uses only the <strong> tag and keeps the node name as text`, () => {
      const raw: string = messages.drsPage.checkStorageManually
      const tags = [...raw.matchAll(/<\/?([a-zA-Z][\w-]*)[^>]*>/g)].map(m => m[1])
      expect(new Set(tags)).toEqual(new Set(['strong']))
      expect(raw).toContain('{node}')

      // Strict translator: an unmapped tag or a bad message throws here
      // instead of being swallowed into a logged error.
      const t = createTranslator({ locale, messages, onError: (e) => { throw e } }) as any
      const parts = flatten(
        t.rich(KEY, { node: HOSTILE_NODE, strong: (chunks: unknown) => ({ strong: flatten(chunks) }) }),
      )

      // The node name arrives inside the <strong> callback as a plain string.
      const strong = parts.find((p): p is { strong: unknown[] } => typeof p === 'object' && p !== null && 'strong' in p)
      expect(strong?.strong).toEqual([HOSTILE_NODE])
      // Everything else is text: no part of the output is markup.
      for (const p of parts) {
        if (typeof p === 'string') expect(p).not.toMatch(/<\/?strong>/)
      }
    })
  }
})
