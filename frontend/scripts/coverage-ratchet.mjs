// Overall-coverage ratchet. Reads the committed floor and the live SonarCloud
// overall `coverage` measure, fails if coverage dropped below the floor.
// Per-PR coverage is governed by the SonarCloud Quality Gate (new-code >=80%);
// this ratchet protects the overall number on main from silent drift.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

export function evaluateRatchet({ coverage, floor }) {
  const c = Number(coverage)
  const f = Number(floor)
  const ok = c >= f
  return {
    ok,
    coverage: c,
    floor: f,
    message: ok
      ? `coverage ${c}% >= floor ${f}%`
      : `coverage ${c}% is below floor ${f}% (regression)`,
  }
}

export async function fetchSonarCoverage({ token, projectKey, branch }) {
  const url = new URL('https://sonarcloud.io/api/measures/component')
  url.searchParams.set('component', projectKey)
  url.searchParams.set('metricKeys', 'coverage')
  if (branch) url.searchParams.set('branch', branch)
  const res = await fetch(url, { headers: { Authorization: 'Basic ' + Buffer.from(`${token}:`).toString('base64') } })
  if (!res.ok) throw new Error(`SonarCloud API ${res.status}`)
  const json = await res.json()
  const measure = json?.component?.measures?.find((m) => m.metric === 'coverage')
  if (!measure) throw new Error('coverage measure not present yet')
  return Number(measure.value)
}

// CLI entrypoint: node scripts/coverage-ratchet.mjs
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const here = dirname(fileURLToPath(import.meta.url))
  const { floor } = JSON.parse(readFileSync(join(here, '..', '.coverage-floor.json'), 'utf8'))
  const token = process.env.SONAR_TOKEN
  const projectKey = process.env.SONAR_PROJECT_KEY || 'adminsyspro_proxcenter-ui'
  const branch = process.env.SONAR_BRANCH || 'main'
  if (!token) {
    console.error('SONAR_TOKEN missing; skipping ratchet (informational).')
    process.exit(0)
  }
  try {
    const coverage = await fetchSonarCoverage({ token, projectKey, branch })
    const r = evaluateRatchet({ coverage, floor })
    console.log(r.message)
    process.exit(r.ok ? 0 : 1)
  } catch (e) {
    console.error(`Ratchet skipped: ${e.message}`)
    process.exit(0) // do not block on transient API/timing issues
  }
}
