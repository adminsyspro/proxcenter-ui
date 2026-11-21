// Dev-only. Generates the static framework catalogues from official NIST OSCAL.
// Run: npx tsx scripts/extract-oscal-controls.ts
// Inputs (pinned, URLs and commits in SOURCES below):
//   - 800-53 r5 catalog + Moderate baseline (usnistgov/oscal-content)
//   - 800-171 r3 requirements (usnistgov/oscal-content, pinned to commit 5006f18c)
//   - 800-171 r2 requirements, used only to derive the CMMC Level 2 practices
//     (FATHOM5 OSCAL mirror, pinned to commit 66d40d56, verified against
//     NIST SP 800-171 Rev 2 official publication)
// Reads from scripts/oscal-cache/ if present, else fetches over HTTPS.
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { FrameworkControl } from '../src/lib/compliance/frameworks/types'

const CACHE = join(__dirname, 'oscal-cache')
const OUT = join(__dirname, '../src/lib/compliance/frameworks')

// Ensure cache dir exists
if (!existsSync(CACHE)) mkdirSync(CACHE, { recursive: true })

const SOURCES = {
  catalog80053: 'https://raw.githubusercontent.com/usnistgov/oscal-content/main/nist.gov/SP800-53/rev5/json/NIST_SP-800-53_rev5_catalog.json',
  moderate80053: 'https://raw.githubusercontent.com/usnistgov/oscal-content/main/nist.gov/SP800-53/rev5/json/NIST_SP-800-53_rev5_MODERATE-baseline_profile.json',
  // Controller override: usnistgov/oscal-content no longer publishes 800-171 Rev 2 (only Rev 3 now).
  // Using FATHOM5 OSCAL mirror pinned to commit 66d40d56 as transcription input.
  // Authority: https://csrc.nist.gov/pubs/sp/800/171/r2/upd1/final (official NIST publication).
  reqs800171: 'https://raw.githubusercontent.com/FATHOM5/oscal/66d40d56467d0ad2f00692448ac966750bd816fb/content/SP800-171/oscal-content/catalogs/NIST_SP-800-171_rev2_catalog.json',
  // Official NIST OSCAL, pinned to the 2026-10-22 publication of the Rev 3 catalog.
  // Authority: https://csrc.nist.gov/pubs/sp/800/171/r3/final
  reqs800171r3: 'https://raw.githubusercontent.com/usnistgov/oscal-content/5006f18c8047643eaa70e35dd0d20a58bcc41856/nist.gov/SP800-171/rev3/json/NIST_SP800-171_rev3_catalog.json',
}

async function load(name: keyof typeof SOURCES): Promise<any> {
  const cached = join(CACHE, `${name}.json`)
  if (existsSync(cached)) return JSON.parse(readFileSync(cached, 'utf8'))
  console.log(`Fetching ${name}...`)
  const res = await fetch(SOURCES[name])
  if (!res.ok) throw new Error(`fetch ${name} failed: ${res.status} ${res.statusText}`)
  const data = await res.json()
  writeFileSync(cached, JSON.stringify(data, null, 2))
  return data
}

const FAMILY_NAMES_800171: Record<string, string> = {
  '3.1': 'Access Control', '3.2': 'Awareness and Training', '3.3': 'Audit and Accountability',
  '3.4': 'Configuration Management', '3.5': 'Identification and Authentication', '3.6': 'Incident Response',
  '3.7': 'Maintenance', '3.8': 'Media Protection', '3.9': 'Personnel Security',
  '3.10': 'Physical Protection', '3.11': 'Risk Assessment', '3.12': 'Security Assessment',
  '3.13': 'System and Communications Protection', '3.14': 'System and Information Integrity',
}
const CMMC_DOMAIN: Record<string, string> = {
  '3.1': 'AC', '3.2': 'AT', '3.3': 'AU', '3.4': 'CM', '3.5': 'IA', '3.6': 'IR', '3.7': 'MA',
  '3.8': 'MP', '3.9': 'PS', '3.10': 'PE', '3.11': 'RA', '3.12': 'CA', '3.13': 'SC', '3.14': 'SI',
}

// Canonical per-family control counts for NIST SP 800-171 Rev 2.
// Source: https://csrc.nist.gov/pubs/sp/800/171/r2/upd1/final
const CANONICAL_800171_FAMILY_COUNTS: Record<string, number> = {
  '3.1': 22, '3.2': 3, '3.3': 9, '3.4': 9, '3.5': 11, '3.6': 3, '3.7': 6,
  '3.8': 9, '3.9': 2, '3.10': 6, '3.11': 3, '3.12': 4, '3.13': 16, '3.14': 7,
}

// Title spot-checks (case-insensitive substring match) per NIST SP 800-171 Rev 2.
const TITLE_SPOT_CHECKS: Array<{ id: string; contains: string }> = [
  { id: '3.1.8', contains: 'unsuccessful logon' },
  { id: '3.5.3', contains: 'multifactor' },
  { id: '3.13.1', contains: 'monitor, control, and protect' },
]

function familyKey171(id: string): string {
  const [a, b] = id.split('.')
  return `${a}.${b}`
}

// 800-171 r2: walk groups -> controls; id like "3.1.1".
function extract800171(doc: any): FrameworkControl[] {
  const out: FrameworkControl[] = []
  for (const group of doc.catalog.groups ?? []) {
    for (const ctrl of group.controls ?? []) {
      const id = ctrl.id.replace(/^.*?(\d+\.\d+\.\d+).*$/, '$1')
      if (!/^3\.\d+\.\d+$/.test(id)) continue
      out.push({ id, title: ctrl.title, family: FAMILY_NAMES_800171[familyKey171(id)] ?? 'Unknown' })
    }
  }
  return out.sort(cmpDotted)
}

// Integrity guard for the FATHOM5 mirror (unofficial source).
// Throws loudly on any drift so the build fails rather than silently emitting wrong data.
function assertIntegrity800171(controls: FrameworkControl[]): void {
  // 1. Total count
  if (controls.length !== 110) {
    throw new Error(
      `[integrity] 800-171 Rev 2: expected 110 controls, got ${controls.length}. ` +
      `Mirror may have drifted from pinned commit 66d40d56.`
    )
  }

  // 2. Per-family counts
  const familyCounts: Record<string, number> = {}
  for (const c of controls) {
    const fk = familyKey171(c.id)
    familyCounts[fk] = (familyCounts[fk] ?? 0) + 1
  }

  const distinctFamilies = Object.keys(familyCounts).length
  if (distinctFamilies !== 14) {
    throw new Error(
      `[integrity] 800-171 Rev 2: expected 14 distinct families, got ${distinctFamilies}. ` +
      `Families found: ${Object.keys(familyCounts).join(', ')}`
    )
  }

  for (const [fk, expected] of Object.entries(CANONICAL_800171_FAMILY_COUNTS)) {
    const actual = familyCounts[fk] ?? 0
    if (actual !== expected) {
      throw new Error(
        `[integrity] 800-171 Rev 2: family ${fk} (${FAMILY_NAMES_800171[fk]}): ` +
        `expected ${expected} controls, got ${actual}.`
      )
    }
  }

  // 3. Title spot-checks
  const byId = new Map(controls.map(c => [c.id, c]))
  for (const { id, contains } of TITLE_SPOT_CHECKS) {
    const ctrl = byId.get(id)
    if (!ctrl) {
      throw new Error(`[integrity] 800-171 Rev 2: control ${id} not found.`)
    }
    if (!ctrl.title.toLowerCase().includes(contains.toLowerCase())) {
      throw new Error(
        `[integrity] 800-171 Rev 2: control ${id} title "${ctrl.title}" ` +
        `does not contain expected substring "${contains}".`
      )
    }
  }

  // Print per-family counts on success
  console.log('800-171 Rev 2 integrity check PASSED. Per-family counts:')
  for (const [fk, count] of Object.entries(familyCounts).sort()) {
    console.log(`  ${fk} (${FAMILY_NAMES_800171[fk]}): ${count}`)
  }
}

// Canonical per-family counts of the requirements NIST SP 800-171 Rev 3 keeps
// in force (97). The withdrawn identifiers stay in the catalogue, flagged
// status=withdrawn, and are not requirements anyone can satisfy or fail.
// Source: https://csrc.nist.gov/pubs/sp/800/171/r3/final
const CANONICAL_800171R3_FAMILY_COUNTS: Record<string, number> = {
  '03.01': 16, '03.02': 2, '03.03': 8, '03.04': 10, '03.05': 8, '03.06': 5,
  '03.07': 3, '03.08': 7, '03.09': 2, '03.10': 5, '03.11': 3, '03.12': 4,
  '03.13': 10, '03.14': 5, '03.15': 3, '03.16': 3, '03.17': 3,
}

const TITLE_SPOT_CHECKS_R3: Array<{ id: string; contains: string }> = [
  { id: '03.01.08', contains: 'unsuccessful logon' },
  { id: '03.05.03', contains: 'multi-factor' },
  { id: '03.13.01', contains: 'boundary protection' },
  { id: '03.17.01', contains: 'supply chain' },
]

// 800-171 r3: walk groups -> controls; id like "SP_800_171_03.01.01". Family is
// the group title, so the three families Rev 3 adds (Planning, System and
// Services Acquisition, Supply Chain Risk Management) come straight from NIST.
function extract800171r3(doc: any): FrameworkControl[] {
  const out: FrameworkControl[] = []
  for (const group of doc.catalog.groups ?? []) {
    for (const ctrl of group.controls ?? []) {
      const withdrawn = (ctrl.props ?? []).some((p: any) => p.name === 'status' && p.value === 'withdrawn')
      if (withdrawn) continue
      const id = String(ctrl.id).replace(/^SP_800_171_/, '')
      if (!/^03\.\d{2}\.\d{2}$/.test(id)) continue
      out.push({ id, title: ctrl.title, family: group.title })
    }
  }
  return out.sort(cmpDotted)
}

function assertIntegrity800171r3(controls: FrameworkControl[]): void {
  const fail = (msg: string): never => { throw new Error(`[integrity] 800-171 Rev 3: ${msg}`) }
  if (controls.length !== 97) fail(`expected 97 requirements in force, got ${controls.length}.`)
  const counts: Record<string, number> = {}
  for (const c of controls) {
    const fk = c.id.slice(0, 5)
    counts[fk] = (counts[fk] ?? 0) + 1
  }
  if (Object.keys(counts).length !== 17) fail(`expected 17 families, got ${Object.keys(counts).join(', ')}.`)
  for (const [fk, expected] of Object.entries(CANONICAL_800171R3_FAMILY_COUNTS)) {
    if ((counts[fk] ?? 0) !== expected) fail(`family ${fk}: expected ${expected}, got ${counts[fk] ?? 0}.`)
  }
  const byId = new Map(controls.map(c => [c.id, c]))
  for (const { id, contains } of TITLE_SPOT_CHECKS_R3) {
    const ctrl = byId.get(id) ?? fail(`requirement ${id} not found.`)
    if (!ctrl.title.toLowerCase().includes(contains)) fail(`requirement ${id} title "${ctrl.title}" lacks "${contains}".`)
  }
  console.log('800-171 Rev 3 integrity check PASSED. Per-family counts:')
  for (const [fk, count] of Object.entries(counts).sort()) console.log(`  ${fk}: ${count}`)
}

// 800-53 r5: profile lists control ids -> resolve titles/families from catalog.
function extract80053(catalog: any, profile: any): FrameworkControl[] {
  const titleById = new Map<string, { title: string; family: string }>()
  for (const group of catalog.catalog.groups ?? []) {
    const family = group.title as string
    const walk = (controls: any[]) => {
      for (const c of controls ?? []) {
        titleById.set(c.id, { title: c.title, family })
        if (c.controls) walk(c.controls)
      }
    }
    walk(group.controls)
  }
  const wanted = new Set<string>()
  for (const imp of profile.profile.imports ?? []) {
    for (const inc of imp['include-controls'] ?? []) for (const w of inc['with-ids'] ?? []) wanted.add(w)
  }
  const out: FrameworkControl[] = []
  for (const id of wanted) {
    const meta = titleById.get(id)
    if (meta) out.push({ id: id.toUpperCase(), title: meta.title, family: meta.family })
  }
  return out.sort((a, b) => a.id.localeCompare(b.id))
}

function cmpDotted(a: FrameworkControl, b: FrameworkControl): number {
  const pa = a.id.split('.').map(Number), pb = b.id.split('.').map(Number)
  return pa[0] - pb[0] || pa[1] - pb[1] || pa[2] - pb[2]
}

function emit(name: string, varName: string, controls: FrameworkControl[]) {
  const body = `// GENERATED by scripts/extract-oscal-controls.ts — do not edit by hand.\n` +
    `import type { FrameworkControl } from './types'\n\n` +
    `export const ${varName}: FrameworkControl[] = ${JSON.stringify(controls, null, 2)}\n`
  writeFileSync(join(OUT, name), body)
}

async function main() {
  const raw171 = await load('reqs800171')
  const c171 = extract800171(raw171)

  // Mandatory integrity guard: fails loudly if the mirror has drifted
  assertIntegrity800171(c171)

  // Rev 2 is no longer emitted as a framework of its own: it survives only as
  // the source of the CMMC Level 2 practices, which the DoD still pins to it.
  const cmmc = c171.map(c => ({
    id: `${CMMC_DOMAIN[familyKey171(c.id)]}.L2-${c.id}`,
    title: c.title,
    family: c.family,
  }))
  emit('catalog.cmmc-l2.ts', 'CMMC_L2_CONTROLS', cmmc)
  console.log(`Written catalog.cmmc-l2.ts (${cmmc.length} practices)`)

  const c171r3 = extract800171r3(await load('reqs800171r3'))
  assertIntegrity800171r3(c171r3)
  emit('catalog.nist-800-171-r3.ts', 'NIST_800_171_R3_CONTROLS', c171r3)
  console.log(`Written catalog.nist-800-171-r3.ts (${c171r3.length} requirements)`)

  const c53 = extract80053(await load('catalog80053'), await load('moderate80053'))
  emit('catalog.nist-800-53-r5.ts', 'NIST_800_53_R5_CONTROLS', c53)
  console.log(`Written catalog.nist-800-53-r5.ts (${c53.length} controls)`)

  console.log(`\n800-171 r3: ${c171r3.length}, cmmc (800-171 r2): ${cmmc.length}, 800-53 moderate: ${c53.length}`)
}
main().catch(e => { console.error(e); process.exit(1) })
