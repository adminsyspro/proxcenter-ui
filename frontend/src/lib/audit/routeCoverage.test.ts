import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { READ_ONLY_MUTATION_ROUTES } from './readOnlyRoutes'

// Every mutating route must land in the audit log (ui#1105): a route that
// exports POST/PUT/PATCH/DELETE is either wrapped with withAudit() or listed
// in READ_ONLY_MUTATION_ROUTES with the reason it changes nothing.

const API_DIR = path.join(process.cwd(), 'src/app/api')
const METHOD = '(POST|PUT|PATCH|DELETE)'

// NextAuth's catch-all handles login itself, audited in src/lib/auth/config.ts.
const EXCLUDED = new Set(['auth/[...nextauth]'])

function routeFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) routeFiles(full, out)
    else if (entry.name === 'route.ts') out.push(full)
  }
  return out
}

interface MutatingExport { method: string; wrapped: boolean }

function mutatingExports(source: string): MutatingExport[] {
  const found: MutatingExport[] = []
  for (const m of source.matchAll(new RegExp(`^export\\s+(?:async\\s+)?function\\s+${METHOD}\\b`, 'gm'))) {
    found.push({ method: m[1], wrapped: false })
  }
  for (const m of source.matchAll(new RegExp(`^export\\s+const\\s+${METHOD}\\s*=\\s*(\\S+)`, 'gm'))) {
    found.push({ method: m[1], wrapped: m[2].startsWith('withAudit(') })
  }
  for (const m of source.matchAll(new RegExp(`^export\\s*\\{[^}]*\\bas\\s+${METHOD}\\b`, 'gm'))) {
    found.push({ method: m[1], wrapped: false })
  }
  return found
}

const routes = routeFiles(API_DIR).map(file => ({
  route: path.relative(API_DIR, path.dirname(file)).split(path.sep).join('/'),
  exports: mutatingExports(fs.readFileSync(file, 'utf8')),
}))

describe('audit coverage of mutating API routes', () => {
  it('finds the route tree', () => {
    expect(routes.length).toBeGreaterThan(300)
  })

  it('wraps every mutating export with withAudit unless the route is read-only', () => {
    const unaudited = routes
      .filter(r => !EXCLUDED.has(r.route) && !(r.route in READ_ONLY_MUTATION_ROUTES))
      .flatMap(r => r.exports.filter(e => !e.wrapped).map(e => `${e.method} ${r.route}`))

    expect(unaudited).toEqual([])
  })

  it('lists only existing routes that really export a mutating method', () => {
    const byRoute = new Map(routes.map(r => [r.route, r.exports]))
    const stale = Object.keys(READ_ONLY_MUTATION_ROUTES).filter(route => !byRoute.get(route)?.length)

    expect(stale).toEqual([])
  })

  it('gives a reason for every read-only route', () => {
    for (const reason of Object.values(READ_ONLY_MUTATION_ROUTES)) expect(reason.trim().length).toBeGreaterThan(10)
  })
})
