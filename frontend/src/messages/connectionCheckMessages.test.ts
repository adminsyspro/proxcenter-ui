import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { FEATURE_IDS } from '@/lib/connections/check/privilegeMap'
import { CHECK_PROBE_ORDER } from '@/lib/connections/check/types'

import de from './de.json'
import en from './en.json'
import es from './es.json'
import fr from './fr.json'
import ko from './ko.json'
import zhCN from './zh-CN.json'

const locales: Record<string, any> = { en, fr, de, es, ko, 'zh-CN': zhCN }

function flatten(obj: Record<string, unknown>, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (typeof v === 'string') out[key] = v
    else if (v && typeof v === 'object') Object.assign(out, flatten(v as Record<string, unknown>, key))
  }
  return out
}

/** Every hint code the server can emit, read off the source so a new hint cannot land untranslated. */
function hintCodesInSource(): string[] {
  const files = ['src/lib/connections/check/probes.ts', 'src/lib/connections/check/runConnectionCheck.ts']
  const codes = new Set<string>()
  for (const f of files) {
    const src = readFileSync(path.resolve(process.cwd(), f), 'utf8')
    // item(<id>, <status>, '<hint>', ...) in the probes; `hint:` in the runner and the API host
    // probe; `none:` / `missing:` in the privilege-separation hint table.
    for (const m of src.matchAll(/item\(\s*[^,]+,\s*(?:'[a-z]+'|[\w.]+),\s*'([a-z]+\.[a-zA-Z]+)'/g)) codes.add(m[1])
    for (const m of src.matchAll(/\b(?:hint|none|missing): '([a-z]+\.[a-zA-Z]+)'/g)) codes.add(m[1])
  }
  return [...codes].sort((a, b) => a.localeCompare(b))
}

describe('settings.connectionCheck i18n parity across the 6 served locales', () => {
  const enFlat = flatten(en.settings.connectionCheck)
  const codes = hintCodesInSource()

  it('finds the hint codes in the probes', () => {
    expect(codes.length).toBeGreaterThan(40)
  })

  for (const [locale, messages] of Object.entries(locales)) {
    const block = messages?.settings?.connectionCheck
    const flat = block ? flatten(block) : {}

    it(`${locale} declares every key of en with the same placeholders`, () => {
      expect(block, `${locale}: settings.connectionCheck`).toBeTypeOf('object')
      for (const [key, enValue] of Object.entries(enFlat)) {
        expect(flat[key], `${locale}: ${key}`).toBeTypeOf('string')
        const placeholders = (s: string) => [...s.matchAll(/\{(\w+)/g)].map(m => m[1]).sort((a, b) => a.localeCompare(b))
        expect(placeholders(flat[key]), `${locale}: ${key} placeholders`).toEqual(placeholders(enValue))
      }
      expect(Object.keys(flat).sort((a, b) => a.localeCompare(b))).toEqual(Object.keys(enFlat).sort((a, b) => a.localeCompare(b)))
    })

    it(`${locale} translates every hint code the probes emit, every probe and every feature`, () => {
      for (const code of codes) expect(flat[`hints.${code}`], `${locale}: hints.${code}`).toBeTypeOf('string')
      for (const probe of CHECK_PROBE_ORDER) expect(flat[`probes.${probe}`], `${locale}: probes.${probe}`).toBeTypeOf('string')
      for (const feature of FEATURE_IDS) expect(flat[`features.${feature}`], `${locale}: features.${feature}`).toBeTypeOf('string')
    })

    it(`${locale} uses no em-dash`, () => {
      for (const [key, value] of Object.entries(flat)) expect(value, `${locale}: ${key}`).not.toMatch(/—/)
    })
  }
})
