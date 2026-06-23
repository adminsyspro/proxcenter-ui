// index.test.ts
import { describe, it, expect } from 'vitest'
import { ALL_CHECK_IDS } from '../hardening'
import { FRAMEWORKS, getFramework, getCrosswalk } from './index'
import { FRAMEWORK_IDS } from './types'

describe('framework registry integrity', () => {
  it('exposes all registered frameworks', () => {
    expect(FRAMEWORKS.map(f => f.id).sort()).toEqual([...FRAMEWORK_IDS].sort())
  })

  for (const id of FRAMEWORK_IDS) {
    it(`${id}: every crosswalk checkId is a real check`, () => {
      const cw = getCrosswalk(id)
      for (const checkId of Object.keys(cw)) {
        expect(ALL_CHECK_IDS).toContain(checkId)
      }
    })
    it(`${id}: every crosswalk controlId exists in the catalogue`, () => {
      const def = getFramework(id)
      const ids = new Set(def.controls.map(c => c.id))
      for (const m of Object.values(getCrosswalk(id))) {
        for (const cid of m.controlIds) expect(ids.has(cid)).toBe(true)
      }
    })
  }
})
