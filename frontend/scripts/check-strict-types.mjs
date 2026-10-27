// Strict-mode ratchet for the JS -> strict TS migration (roadmap#171).
// tsconfig.json stays `strict: false` until the migration ends, so this runs
// `tsc --strict` on the whole program and compares the result with the
// committed debt in .strict-debt.json:
// - a file outside the debt must have zero strict errors;
// - a file in the debt may not exceed its budget, and a budget that is no
//   longer reached must be lowered (`--update`), so the debt only shrinks;
// - no new .js/.jsx file may appear under src/, and a converted one must
//   leave the list.
// A syntax-only output fails the run: a parse error hides every semantic
// error of the program, typically a stale .next/dev/types/validator.ts locally.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative, sep } from 'node:path'

const ERROR_LINE = /^(.+?)\(\d+,\d+\): error (TS\d+): /

// tsc stops at syntactic diagnostics when there are any, so an output made
// only of TS1xxx errors means the semantic check never ran. TS1xxx errors
// reported alongside semantic ones (e.g. TS1501) are ordinary errors.
export function parseTscOutput(output) {
  const counts = {}
  const tsOneLines = []
  let semantic = 0
  for (const line of output.split('\n')) {
    const m = ERROR_LINE.exec(line.trim())
    if (!m) continue
    const [, file, code] = m
    const path = file.split(sep).join('/')
    if (/^TS1\d{3}$/.test(code)) tsOneLines.push(line.trim())
    else semantic++
    if (path.startsWith('.next/')) continue
    counts[path] = (counts[path] || 0) + 1
  }
  return { counts, syntax: semantic === 0 ? tsOneLines : [] }
}

export function evaluateStrictDebt({ counts, syntax = [], jsFiles, debt }) {
  const failures = []
  const lowered = []
  const budgets = debt.tsErrors || {}
  for (const line of syntax) failures.push(`syntax error, strict results unreliable: ${line}`)
  for (const [file, n] of Object.entries(counts)) {
    const budget = budgets[file]
    if (budget === undefined) failures.push(`${file}: ${n} strict error(s), the file is not in the debt`)
    else if (n > budget) failures.push(`${file}: ${n} strict error(s), budget ${budget}`)
  }
  for (const [file, budget] of Object.entries(budgets)) {
    const n = counts[file] || 0
    if (n < budget) lowered.push(`${file}: ${n} strict error(s), budget ${budget}`)
  }
  const known = new Set(debt.jsFiles || [])
  const present = new Set(jsFiles)
  for (const file of jsFiles) if (!known.has(file)) failures.push(`${file}: new JavaScript file, write it in TypeScript`)
  for (const file of known) if (!present.has(file)) lowered.push(`${file}: converted or removed, still listed as JavaScript`)
  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  return {
    ok: failures.length === 0 && lowered.length === 0,
    failures,
    lowered,
    summary: `${total} strict error(s) in ${Object.keys(counts).length} file(s), ${jsFiles.length} JavaScript file(s) left`
  }
}

// Lowers budgets and drops converted files. Never raises a budget or adds a
// file: a regression has to be fixed, not written into the debt.
export function lowerDebt({ counts, jsFiles, debt }) {
  const tsErrors = {}
  for (const [file, budget] of Object.entries(debt.tsErrors || {})) {
    const n = Math.min(counts[file] || 0, budget)
    if (n > 0) tsErrors[file] = n
  }
  const present = new Set(jsFiles)
  return { ...debt, tsErrors, jsFiles: (debt.jsFiles || []).filter(f => present.has(f)) }
}

export function listJsFiles(root, dir = 'src') {
  const out = []
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`
    if (entry.isDirectory()) out.push(...listJsFiles(root, path))
    else if (/\.(js|jsx)$/.test(entry.name)) out.push(path)
  }
  return out.sort()
}

function runTsc(root) {
  const tsc = createRequire(join(root, 'package.json')).resolve('typescript/bin/tsc')
  try {
    return execFileSync(process.execPath, [tsc, '--noEmit', '--incremental', 'false', '--pretty', 'false', '--strict', '-p', 'tsconfig.json'], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024
    })
  } catch (e) {
    if (typeof e.stdout === 'string') return e.stdout
    throw e
  }
}

// CLI entrypoint: node scripts/check-strict-types.mjs [--update]
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const debtPath = join(root, '.strict-debt.json')
  const debt = JSON.parse(readFileSync(debtPath, 'utf8'))
  const { counts, syntax } = parseTscOutput(runTsc(root))
  const jsFiles = listJsFiles(root)
  if (process.argv.includes('--update')) {
    if (syntax.length) {
      console.error(syntax.join('\n'))
      console.error('Syntax errors: debt not updated.')
      process.exit(1)
    }
    writeFileSync(debtPath, JSON.stringify(lowerDebt({ counts, jsFiles, debt }), null, 2) + '\n')
    console.log(`Debt lowered in ${relative(process.cwd(), debtPath)}.`)
  }
  const r = evaluateStrictDebt({ counts, syntax, jsFiles, debt: JSON.parse(readFileSync(debtPath, 'utf8')) })
  console.log(r.summary)
  for (const f of r.failures) console.error(`✗ ${f}`)
  if (r.lowered.length) {
    for (const f of r.lowered) console.error(`↓ ${f}`)
    console.error('The debt went down: run `npm run typecheck:strict -- --update` and commit .strict-debt.json.')
  }
  process.exit(r.ok ? 0 : 1)
}
