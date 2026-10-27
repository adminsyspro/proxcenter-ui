import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseTscOutput, evaluateStrictDebt, lowerDebt, listJsFiles } from './check-strict-types.mjs'

const tsc = [
  "src/a.ts(3,7): error TS2322: Type 'string' is not assignable to type 'number'.",
  "src/a.ts(9,1): error TS18047: 'x' is possibly 'null'.",
  "src/b.tsx(1,1): error TS7006: Parameter 'p' implicitly has an 'any' type.",
  '  Some continuation line of the previous message',
  ".next/types/routes.d.ts(4,2): error TS2304: Cannot find name 'X'."
].join('\n')

describe('parseTscOutput', () => {
  it('counts errors per file and ignores generated .next files', () => {
    expect(parseTscOutput(tsc)).toEqual({ counts: { 'src/a.ts': 2, 'src/b.tsx': 1 }, syntax: [] })
  })
  it('reports syntax errors when they are all tsc printed, including in .next', () => {
    const r = parseTscOutput(".next/dev/types/validator.ts(1,5): error TS1003: Identifier expected.")
    expect(r.syntax).toHaveLength(1)
    expect(r.counts).toEqual({})
  })
  it('counts TS1xxx errors reported next to semantic ones as ordinary errors', () => {
    const r = parseTscOutput([
      "src/x.test.ts(279,75): error TS1501: This regular expression flag is only available when targeting 'es2018' or later.",
      "src/a.ts(3,7): error TS2322: Type 'string' is not assignable to type 'number'."
    ].join('\n'))
    expect(r).toEqual({ counts: { 'src/x.test.ts': 1, 'src/a.ts': 1 }, syntax: [] })
  })
})

describe('evaluateStrictDebt', () => {
  const debt = { tsErrors: { 'src/a.ts': 2 }, jsFiles: ['src/old.jsx'] }
  it('passes when every error is within budget', () => {
    const r = evaluateStrictDebt({ counts: { 'src/a.ts': 2 }, jsFiles: ['src/old.jsx'], debt })
    expect(r.ok).toBe(true)
    expect(r.summary).toBe('2 strict error(s) in 1 file(s), 1 JavaScript file(s) left')
  })
  it('fails on an error in a file outside the debt', () => {
    const r = evaluateStrictDebt({ counts: { 'src/a.ts': 2, 'src/b.tsx': 1 }, jsFiles: ['src/old.jsx'], debt })
    expect(r.ok).toBe(false)
    expect(r.failures).toEqual(['src/b.tsx: 1 strict error(s), the file is not in the debt'])
  })
  it('fails when a file exceeds its budget', () => {
    const r = evaluateStrictDebt({ counts: { 'src/a.ts': 3 }, jsFiles: ['src/old.jsx'], debt })
    expect(r.failures).toEqual(['src/a.ts: 3 strict error(s), budget 2'])
  })
  it('asks for a lower budget when a file improved', () => {
    const r = evaluateStrictDebt({ counts: { 'src/a.ts': 1 }, jsFiles: ['src/old.jsx'], debt })
    expect(r.ok).toBe(false)
    expect(r.failures).toEqual([])
    expect(r.lowered).toEqual(['src/a.ts: 1 strict error(s), budget 2'])
  })
  it('fails on a new JavaScript file', () => {
    const r = evaluateStrictDebt({ counts: { 'src/a.ts': 2 }, jsFiles: ['src/new.js', 'src/old.jsx'], debt })
    expect(r.failures).toEqual(['src/new.js: new JavaScript file, write it in TypeScript'])
  })
  it('asks to drop a converted JavaScript file from the list', () => {
    const r = evaluateStrictDebt({ counts: { 'src/a.ts': 2 }, jsFiles: [], debt })
    expect(r.lowered).toEqual(['src/old.jsx: converted or removed, still listed as JavaScript'])
  })
  it('fails on syntax errors whatever the counts', () => {
    const r = evaluateStrictDebt({ counts: {}, syntax: ['x(1,1): error TS1005: oops'], jsFiles: ['src/old.jsx'], debt: { jsFiles: ['src/old.jsx'] } })
    expect(r.ok).toBe(false)
    expect(r.failures[0]).toMatch(/^syntax error/)
  })
})

describe('lowerDebt', () => {
  it('lowers budgets, drops cleared files and converted JS, never raises', () => {
    const debt = { note: 'kept', tsErrors: { 'src/a.ts': 2, 'src/b.ts': 1, 'src/c.ts': 4 }, jsFiles: ['src/x.jsx', 'src/y.js'] }
    const counts = { 'src/a.ts': 1, 'src/c.ts': 9, 'src/new.ts': 3 }
    expect(lowerDebt({ counts, jsFiles: ['src/y.js', 'src/z.js'], debt })).toEqual({
      note: 'kept',
      tsErrors: { 'src/a.ts': 1, 'src/c.ts': 4 },
      jsFiles: ['src/y.js']
    })
  })
})

describe('listJsFiles', () => {
  it('lists .js and .jsx files under src, sorted', () => {
    const root = mkdtempSync(join(tmpdir(), 'strict-debt-'))
    mkdirSync(join(root, 'src/sub'), { recursive: true })
    for (const f of ['src/b.jsx', 'src/a.js', 'src/sub/c.js', 'src/d.ts', 'src/e.tsx']) writeFileSync(join(root, f), '')
    expect(listJsFiles(root)).toEqual(['src/a.js', 'src/b.jsx', 'src/sub/c.js'])
  })
})
