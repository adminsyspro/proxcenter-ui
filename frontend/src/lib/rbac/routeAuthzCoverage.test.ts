import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { AUTHZ_GUARDS, ROUTES_WITHOUT_PERMISSION_CHECK } from './routeAuthz'

// Every API route has a permission check within reach, or says why it needs
// none (see routeAuthz.ts for what "within reach" means and does not mean).

const SRC = path.join(process.cwd(), 'src')
const API_DIR = path.join(SRC, 'app/api')
// Where the guards are defined: importing a permission constant from there is
// not a check.
const GUARD_DEFINITIONS = path.join(SRC, 'lib/rbac') + path.sep

const names = AUTHZ_GUARDS.join('|')
const GUARD_CALL = new RegExp(String.raw`(?<![.\w])(?:${names})\s*\(`)
const GUARD_DEFINITION = new RegExp(String.raw`\b(?:function|const)\s+(?:${names})\b`, 'g')
// Value imports and re-exports of a local module ("@/..." or relative).
const LOCAL_MODULE = /(?:import\s+(?!type\b)[^;]*?|export\s+(?!type\b)[^;]*?)from\s+['"]((?:@\/|\.)[^'"]+)['"]/g

function routeFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) routeFiles(full, out)
    else if (entry.name === 'route.ts') out.push(full)
  }
  return out
}

function resolveModule(specifier: string, from: string): string | null {
  const base = specifier.startsWith('@/') ? path.join(SRC, specifier.slice(2)) : path.resolve(path.dirname(from), specifier)
  for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

/** Source of every non-test TypeScript file under a directory. */
function libSources(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) libSources(full, out)
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(fs.readFileSync(full, 'utf8'))
  }
  return out
}

const callCache = new Map<string, boolean>()

/** True when the file calls a guard; defining one does not count. */
function callsGuard(file: string): boolean {
  let known = callCache.get(file)
  if (known === undefined) {
    known = GUARD_CALL.test(fs.readFileSync(file, 'utf8').replace(GUARD_DEFINITION, ''))
    callCache.set(file, known)
  }
  return known
}

function hasCheckWithinReach(file: string): boolean {
  if (callsGuard(file)) return true
  const source = fs.readFileSync(file, 'utf8')
  for (const match of source.matchAll(LOCAL_MODULE)) {
    const target = resolveModule(match[1], file)
    if (target && !target.startsWith(GUARD_DEFINITIONS) && callsGuard(target)) return true
  }
  return false
}

const routes = routeFiles(API_DIR).map(file => ({
  route: path.relative(API_DIR, path.dirname(file)).split(path.sep).join('/'),
  covered: hasCheckWithinReach(file),
}))

describe('authorization coverage of the API routes', () => {
  it('finds the route tree', () => {
    expect(routes.length).toBeGreaterThan(600)
  })

  it('has a permission check within reach of every route, unless the route is listed with its reason', () => {
    const unchecked = routes.filter(r => !r.covered && !(r.route in ROUTES_WITHOUT_PERMISSION_CHECK)).map(r => r.route)

    expect(unchecked).toEqual([])
  })

  it('lists only existing routes that still have no permission check within reach', () => {
    const byRoute = new Map(routes.map(r => [r.route, r.covered]))
    const stale = Object.keys(ROUTES_WITHOUT_PERMISSION_CHECK).filter(route => byRoute.get(route) !== false)

    expect(stale).toEqual([])
  })

  it('gives a reason for every listed route', () => {
    for (const reason of Object.values(ROUTES_WITHOUT_PERMISSION_CHECK)) expect(reason.trim().length).toBeGreaterThan(10)
  })

  it('names guards that exist', () => {
    const defined = (name: string) => new RegExp(String.raw`\b(?:function|const)\s+${name}\b`)
    const sources = libSources(path.join(SRC, 'lib'))
    const missing = AUTHZ_GUARDS.filter(name => !sources.some(s => defined(name).test(s)))

    expect(missing).toEqual([])
  })
})
