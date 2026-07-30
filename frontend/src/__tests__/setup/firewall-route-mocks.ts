/**
 * Shared mock wiring for the firewall route handler tests (#616).
 *
 * The 21 firewall routes all sit on the same four dependencies — tenant
 * ownership, RBAC, the connection lookup and the orchestrator client — and
 * every one of their tests needs the same three scenarios: orchestrator
 * answers, orchestrator is ORCHESTRATOR_UNAVAILABLE (Community, falls back to
 * direct PVE), orchestrator fails for another reason (500, no PVE call). This
 * module owns that wiring so the per-file preamble is two lines.
 *
 * Hoisting: `vi.mock` is hoisted above every const initializer, so a factory
 * that closes over a shared mock would read it in its TDZ. `vi.doMock` is NOT
 * hoisted — it registers a mock for *subsequent* dynamic imports, which is
 * exactly the shape these tests already use (`await import('./route')` inside
 * the test body). Hence `installFirewallRouteMocks()` at the top of each test
 * file, and route modules that must stay lazily imported.
 *
 * What is NOT here: `@/lib/firewall/pveDirect` and `@/lib/proxmox/client`.
 * Each route calls a different set of those helpers and some tests
 * deliberately stub one layer rather than the other, so that stub stays in
 * the test file next to the assertions that depend on it.
 */

import { vi } from 'vitest'

import type { callRoute } from './route-test'

/** Loose async mock: these tests assert on call arguments, not on types. */
type AsyncMock = (...args: any[]) => Promise<any>

/** A route handler shaped the way `callRoute` wants it. */
export type RouteHandler = Parameters<typeof callRoute>[0]

/** Handler map of a firewall route module, typed for `callRoute`. */
export type RouteModule = Record<'GET' | 'POST' | 'PUT' | 'DELETE', RouteHandler>

/**
 * The connection `getConnectionById` resolves to. Assertions compare against
 * this very object, so the direct-PVE fallback must forward it untouched.
 */
export const CONN = {
  id: 'conn-1',
  name: 'pve',
  baseUrl: 'https://10.0.0.1:8006',
  apiToken: 'tok=secret',
}

/** `@/lib/tenant` → verifyConnectionOwnership. Resolves null (owned) by default. */
export const verifyConnectionOwnershipMock = vi.fn<(id: string) => Promise<Response | null>>()

/** `@/lib/rbac` → checkPermission. Resolves null (granted) by default. */
export const checkPermissionMock = vi.fn<AsyncMock>()

/** `@/lib/connections/getConnection` → getConnectionById. Resolves CONN by default. */
export const getConnectionByIdMock = vi.fn<(id: string) => Promise<any>>()

/**
 * The verbs `getOrchestratorClient()` exposes to the firewall routes. Every
 * route reads at most a subset; the unused ones simply stay uncalled, and
 * `expect(orchestrator.get).not.toHaveBeenCalled()` still means what it says.
 */
export const orchestrator = {
  get: vi.fn<AsyncMock>(),
  post: vi.fn<AsyncMock>(),
  put: vi.fn<AsyncMock>(),
  delete: vi.fn<AsyncMock>(),
}

/**
 * Register the four shared module mocks. Call once at the top level of a test
 * file, before any `await import('./route')`.
 */
export function installFirewallRouteMocks(): void {
  vi.doMock('@/lib/tenant', () => ({
    verifyConnectionOwnership: verifyConnectionOwnershipMock,
  }))

  vi.doMock('@/lib/rbac', () => ({
    checkPermission: checkPermissionMock,
    PERMISSIONS: { NODE_VIEW: 'node.view', NODE_MANAGE: 'node.manage' },
  }))

  vi.doMock('@/lib/connections/getConnection', () => ({
    getConnectionById: getConnectionByIdMock,
  }))

  vi.doMock('@/lib/orchestrator/client', () => ({
    getOrchestratorClient: () => orchestrator,
  }))
}

/**
 * `beforeEach` body: wipe call history and put the shared mocks back on the
 * happy path (connection owned, permission granted, CONN resolvable). Also
 * silences the fallback's console output — the "falling back to direct PVE"
 * log line and the 500 path's error dump — which no route test asserts on.
 */
export function resetFirewallRouteMocks(): void {
  vi.clearAllMocks()
  verifyConnectionOwnershipMock.mockResolvedValue(null)
  checkPermissionMock.mockResolvedValue(null)
  getConnectionByIdMock.mockResolvedValue(CONN)
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
}

/**
 * The error `lib/orchestrator/client.ts` tags when nothing listens on
 * ORCHESTRATOR_URL — the only condition that may trigger the PVE fallback.
 */
export function unavailable(): Error {
  const err: any = new Error('Orchestrator unavailable')

  err.code = 'ORCHESTRATOR_UNAVAILABLE'

  return err
}

/** A denial Response, as the RBAC and tenant-ownership guards return one. */
export function denied(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), { status })
}

/**
 * Type the handlers off a lazily imported route module. The `import('./route')`
 * itself has to stay in the test file (relative specifier) and has to stay
 * lazy so `installFirewallRouteMocks()` runs first:
 *
 *   const { GET } = handlersOf(await import('./route'))
 */
export function handlersOf(mod: unknown): RouteModule {
  return mod as RouteModule
}
