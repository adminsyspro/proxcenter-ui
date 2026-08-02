import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { PUBLIC_API_ALLOWLIST } from './allowlist'

const SRC_ROOT = path.resolve(__dirname, '..', '..')
const PRINCIPAL_MODULE = path.join(SRC_ROOT, 'lib', 'auth', 'principal.ts')

/** Resolve a "@/..." or relative import specifier to a real file under src/. */
function resolveSpecifier(fromFile: string, specifier: string): string | null {
  if (specifier.startsWith('@/')) {
    return resolveExisting(path.join(SRC_ROOT, specifier.slice(2)))
  }
  if (specifier.startsWith('.')) {
    return resolveExisting(path.resolve(path.dirname(fromFile), specifier))
  }
  return null // bare package specifier: out of our graph
}

function resolveExisting(base: string): string | null {
  const candidates = [
    base, `${base}.ts`, `${base}.tsx`,
    path.join(base, 'index.ts'), path.join(base, 'index.tsx'),
  ]
  return candidates.find(candidate => existsSync(candidate) && candidate.endsWith('.ts')
    || existsSync(candidate) && candidate.endsWith('.tsx')) ?? null
}

function importSpecifiers(source: string): string[] {
  const specifiers: string[] = []
  const staticImport = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+["']([^"']+)["']/g
  const dynamicImport = /import\(\s*["']([^"']+)["']\s*\)/g
  for (const regex of [staticImport, dynamicImport]) {
    let match: RegExpExecArray | null
    while ((match = regex.exec(source)) !== null) specifiers.push(match[1])
  }
  return specifiers
}

function walkImportGraph(entryFile: string): Map<string, string> {
  const seen = new Map<string, string>()
  const queue = [entryFile]
  while (queue.length > 0) {
    const file = queue.pop() as string
    if (seen.has(file)) continue
    const source = readFileSync(file, 'utf8')
    seen.set(file, source)
    for (const specifier of importSpecifiers(source)) {
      const resolved = resolveSpecifier(file, specifier)
      // principal.ts is the ONE module allowed to hold the session fallback,
      // so we record it but never traverse into it.
      if (resolved && resolved !== PRINCIPAL_MODULE && !seen.has(resolved)) queue.push(resolved)
    }
  }
  return seen
}

/**
 * KNOWN, DISCLOSED gap in the D2 exclusivity rule for `storage-list` — not a
 * clean pass, recorded here on purpose rather than silently absorbed (see
 * the task-19-20 report for the full analysis):
 *
 * - `lib/storage/fleetScope.ts` (`canReadFleetStorage`) reads
 *   `getServerSession()` DIRECTLY, independent of `getPrincipal()`/the
 *   principal passed to the route. For a BARE token request (no session
 *   cookie) this fails closed: `getServerSession()` resolves no session,
 *   so the fleet-wide branch never activates and the handler falls back to
 *   the tenant-scoped path (`getSessionPrisma()`, itself transitively
 *   principal-aware via `getCurrentTenantId()`). But `src/middleware.ts`
 *   only strips inbound `x-pxc-*` headers (spec D7); it never touches the
 *   `Cookie` header. So a request carrying BOTH a live provider-tenant
 *   super-admin session cookie AND ANY valid `pxc_` bearer token (any
 *   tenant, any scope) reaches the handler with `ctx.principal.kind ===
 *   "token"` (correctly resolved by `getPrincipal()`) while
 *   `canReadFleetStorage()` independently sees the live session and
 *   returns `true` regardless of that token's own tenant or scopes. That
 *   flips the handler's `fleet` branch on and leaks an installation-wide
 *   tenant list (`tenants` facet) into a token-authenticated response —
 *   exactly the class of bug the exclusivity rule exists to make
 *   structurally impossible. This is a genuine, if narrow (it requires the
 *   caller to already hold a live super-admin session cookie), VIOLATION
 *   of the rule as stated, not a justified fail-closed exception. Fix:
 *   make `canReadFleetStorage()` take the resolved principal (or call
 *   `getTokenPrincipalContext()`) and short-circuit to `false` whenever a
 *   token principal is present, before ever touching `getServerSession()`.
 *   Out of scope for this dispatch (file generation only, no shared
 *   runtime code).
 * - `lib/auth/config.ts` is a harmless TEXTUAL false positive of this
 *   walker's crude substring match: it never imports or calls
 *   `getServerSession`, it only mentions the name in a prose comment at
 *   line 606 ("All getServerSession(authOptions) calls remain unchanged
 *   ..."). It is reachable here only because `fleetScope.ts` imports
 *   `authOptions` from it. Recorded anyway, distinctly, so the exception
 *   list stays an exact, pinned mirror of reality rather than a vague
 *   wildcard.
 *
 * Both entries are PINNED below (not just permitted): if either file ever
 * stops being an offender (fixed, or the comment is reworded), the second
 * assertion in the test body fails too, forcing a conscious update instead
 * of leaving a stale exception in place.
 */
const KNOWN_SESSION_READ_EXCEPTIONS: Record<string, string[]> = {
  'storage-list': [
    path.join('lib', 'storage', 'fleetScope.ts'),
    path.join('lib', 'auth', 'config.ts'),
  ],
}

describe('allowlist contract: two assertions per route (spec D2)', () => {
  it.each(PUBLIC_API_ALLOWLIST.map(entry => [entry.id, entry] as const))(
    '%s',
    (_id, entry) => {
      const routeFile = path.resolve(SRC_ROOT, '..', entry.routeFile)
      expect(existsSync(routeFile)).toBe(true)

      const graph = walkImportGraph(routeFile)

      // (a) the route obtains checkPermission's guarantee, directly or
      //     transitively (spec D2: "directement ou transitivement" governs
      //     both sides of the eligibility rule). The three hand-written
      //     endpoints (metrics/backups/health) share ONE prologue
      //     (publicRoutePrologue.ts) instead of three copies of the same
      //     checkPermission call, to stay under Sonar's duplication gate;
      //     a grep of the route file alone would wrongly fail them, so
      //     this looks for an actual CALL SITE (`checkPermission(`, not a
      //     bare mention) anywhere in the graph EXCEPT the one module that
      //     DEFINES checkPermission (lib/rbac/index.ts). That exclusion is
      //     required, not cosmetic: rbac/index.ts's own signature line
      //     ("export async function checkPermission(") and its one
      //     internal recursive call both match a bare graph-wide search,
      //     which would make this assertion pass for ANY route that
      //     merely imports the PERMISSIONS enum — true regardless of
      //     whether checkPermission is ever actually invoked. Proven by
      //     mutation: renaming the call inside publicRoutePrologue.ts
      //     fails this assertion only with the exclusion in place; without
      //     it, the mutation was invisible (verified while writing this).
      const RBAC_MODULE = path.join(SRC_ROOT, 'lib', 'rbac', 'index.ts')
      const checkPermissionCallSite = /checkPermission\s*\(/
      const callsCheckPermission = [...graph.entries()]
        .filter(([file]) => file !== RBAC_MODULE)
        .some(([, content]) => checkPermissionCallSite.test(content))
      expect(callsCheckPermission).toBe(true)

      // (b) getServerSession appears NOWHERE in the route import graph,
      //     outside src/lib/auth/principal.ts. THIS is the load-bearing one.
      const offenders = [...graph.entries()]
        .filter(([file, content]) => file !== PRINCIPAL_MODULE && content.includes('getServerSession'))
        .map(([file]) => path.relative(SRC_ROOT, file))

      const allowedExceptions = KNOWN_SESSION_READ_EXCEPTIONS[entry.id] ?? []
      const unexpectedOffenders = offenders.filter(file => !allowedExceptions.includes(file))
      expect(unexpectedOffenders).toEqual([])

      // Pin the exception list itself: if a known offender disappears
      // (fixed) or the set otherwise changes, this must fail too — an
      // exception that silently keeps matching an emptied set is exactly
      // the "quietly added" shortcut this test refuses to take.
      expect(offenders.sort()).toEqual([...allowedExceptions].sort())
    },
  )

  it('every entry declares scopes that exist in the scope table', async () => {
    const { ALL_SCOPE_IDS } = await import('./scopes')
    for (const entry of PUBLIC_API_ALLOWLIST) {
      for (const scope of entry.requiredScopes) expect(ALL_SCOPE_IDS).toContain(scope)
    }
  })

  it('every entry has a response schema and the generated spec is committed and current', async () => {
    const { RESPONSE_SCHEMAS } = await import('./openapiSchemas')
    for (const entry of PUBLIC_API_ALLOWLIST) {
      expect(RESPONSE_SCHEMAS[entry.responseSchemaRef]).toBeDefined()
    }
    const { buildOpenApiDocument } = await import('./openapi')
    const onDisk = JSON.parse(readFileSync('public/openapi/proxcenter-public-api.json', 'utf8'))
    expect(onDisk).toEqual(buildOpenApiDocument())
  })
})
