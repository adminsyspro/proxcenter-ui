// Dev-only. Generates the CIS Controls v8.1 safeguard catalogue from the
// pinned CIS Controls Navigator extraction.
// Run: npx tsx scripts/extract-cis-safeguards.ts
// Input (pinned, see src/lib/compliance/frameworks/SOURCES.md):
//   - scripts/cis-controls-v8.1-safeguards.json, a one-time extraction from the
//     public CIS Controls Navigator listing (safeguard ids + short titles only;
//     CIS descriptive text is copyright Center for Internet Security and is not
//     reproduced). Never re-scrape cisecurity.org: this committed file is the
//     only input.
import { writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FrameworkControl } from '../src/lib/compliance/frameworks/types'

const INPUT = join(__dirname, 'cis-controls-v8.1-safeguards.json')
const OUT = join(__dirname, '../src/lib/compliance/frameworks/catalog.cis-controls-v8-1.ts')

interface Safeguard { id: string; title: string }
interface SourceJson {
  _provenance: Record<string, unknown>
  controls: Record<string, string>
  perControlCounts: Record<string, number>
  safeguards: Safeguard[]
}

// Canonical per-control safeguard distribution for CIS Controls v8.1.
// Source: pinned extraction's own perControlCounts block, cross-checked against
// the public CIS Controls Navigator listing at extraction time.
const CANONICAL_PER_CONTROL_COUNTS: Record<string, number> = {
  '1': 5, '2': 7, '3': 14, '4': 12, '5': 6, '6': 8, '7': 7, '8': 12, '9': 7,
  '10': 7, '11': 5, '12': 8, '13': 11, '14': 9, '15': 7, '16': 14, '17': 9, '18': 5,
}

function load(): SourceJson {
  return JSON.parse(readFileSync(INPUT, 'utf8'))
}

function familyPrefix(id: string): string {
  return id.split('.')[0]
}

function extract(doc: SourceJson): FrameworkControl[] {
  const out: FrameworkControl[] = []
  for (const s of doc.safeguards) {
    const parent = familyPrefix(s.id)
    const name = doc.controls[parent]
    if (!name) throw new Error(`[integrity] CIS Controls v8.1: no control name for parent "${parent}" (safeguard ${s.id}).`)
    out.push({ id: s.id, title: s.title, family: `${parent.padStart(2, '0')} ${name}` })
  }
  return out
}

// Integrity guard for the pinned, one-time extraction (unofficial, hand-scraped
// source). Throws loudly on any drift so the build fails rather than silently
// emitting wrong data.
function assertIntegrity(doc: SourceJson, controls: FrameworkControl[]): void {
  // 1. Total count
  if (doc._provenance.expectedSafeguards !== 153 || controls.length !== 153) {
    throw new Error(
      `[integrity] CIS Controls v8.1: expected 153 safeguards, got ${controls.length} ` +
      `(source declares ${doc._provenance.expectedSafeguards}).`
    )
  }

  // 2. Distinct families
  const familyCounts: Record<string, number> = {}
  for (const c of controls) {
    const fk = familyPrefix(c.id)
    familyCounts[fk] = (familyCounts[fk] ?? 0) + 1
  }
  const distinctFamilies = Object.keys(familyCounts).length
  if (distinctFamilies !== 18) {
    throw new Error(
      `[integrity] CIS Controls v8.1: expected 18 distinct controls, got ${distinctFamilies}. ` +
      `Controls found: ${Object.keys(familyCounts).join(', ')}`
    )
  }

  // 3. Per-control counts, against both the canonical table above and the
  // source file's own declared distribution.
  for (const [fk, expected] of Object.entries(CANONICAL_PER_CONTROL_COUNTS)) {
    const actual = familyCounts[fk] ?? 0
    if (actual !== expected) {
      throw new Error(
        `[integrity] CIS Controls v8.1: control ${fk} (${doc.controls[fk]}): ` +
        `expected ${expected} safeguards, got ${actual}.`
      )
    }
    const declared = doc.perControlCounts[fk]
    if (declared !== expected) {
      throw new Error(
        `[integrity] CIS Controls v8.1: source perControlCounts for control ${fk} ` +
        `is ${declared}, does not match canonical ${expected}.`
      )
    }
  }

  // 4. Well-formed ids, unique
  for (const c of controls) {
    if (!/^\d{1,2}\.\d{1,2}$/.test(c.id)) {
      throw new Error(`[integrity] CIS Controls v8.1: malformed safeguard id "${c.id}".`)
    }
  }
  if (new Set(controls.map(c => c.id)).size !== controls.length) {
    throw new Error('[integrity] CIS Controls v8.1: duplicate safeguard ids found.')
  }

  // Print per-control counts on success
  console.log('CIS Controls v8.1 integrity check PASSED. Per-control counts:')
  for (const [fk, count] of Object.entries(familyCounts).sort((a, b) => Number(a[0]) - Number(b[0]))) {
    console.log(`  ${fk.padStart(2, '0')} (${doc.controls[fk]}): ${count}`)
  }
}

// Re-indent a JSON.stringify(..., null, 2) block by two spaces so it nests
// under the `export const ... = ` line, matching the shape the NIST catalogues
// already use (known to satisfy ESLint and Prettier in this repo).
function reindent(json: string): string {
  const indented = json
    .split('\n')
    .map(line => (line.length ? '  ' + line : line))
    .join('\n')
  return indented.replace(/^ +/, '')
}

function emit(controls: FrameworkControl[]) {
  const body = reindent(JSON.stringify(controls, null, 2))
  const header = `// GENERATED by scripts/extract-cis-safeguards.ts — do not edit by hand.
// Input (pinned): scripts/cis-controls-v8.1-safeguards.json — identifiers and
// short titles only. CIS descriptive text is copyright Center for Internet
// Security and is NOT reproduced here.
// Authority:  https://www.cisecurity.org/controls/cis-controls-list
// Extracted:  2026-08-05, from the public CIS Controls Navigator listing.
// Family is the parent control, zero-padded, so that the localeCompare sort in
// assessFramework yields numeric order (04 before 12) in the UI and the PDF.
import type { FrameworkControl } from './types'

export const CIS_CONTROLS_V8_1_CONTROLS: FrameworkControl[] = `
  writeFileSync(OUT, header + body + '\n')
}

function main() {
  const doc = load()
  const controls = extract(doc)

  // Mandatory integrity guard: fails loudly if the pinned extraction has drifted
  assertIntegrity(doc, controls)

  emit(controls)
  console.log(`Written catalog.cis-controls-v8-1.ts (${controls.length} safeguards)`)
}

main()
