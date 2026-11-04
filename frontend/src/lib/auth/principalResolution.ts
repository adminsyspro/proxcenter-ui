// src/lib/auth/principalResolution.ts
//
// Marks the async span of a getPrincipal() call (roadmap#208). Resolving a
// token principal can reach the orchestrator (the license verdict of step 8),
// and every orchestrator call names its actor by resolving the principal:
// without this mark the second resolution reached step 8 again, before the
// first one had cached the verdict, and the request looped forever. The actor
// helper reads the mark and leaves the call unattributed instead.
//
// On globalThis under a Symbol.for key, like ../audit/origin.ts: Next dev can
// give a route compiled later its own instance of every module, and the
// writer (principal.ts) and the reader (orchestrator/actor.ts) must share one
// store.

import { AsyncLocalStorage } from "node:async_hooks"

const KEY = Symbol.for("proxcenter.principalResolution")
type Store = AsyncLocalStorage<true>
const g = globalThis as unknown as Record<symbol, Store | undefined>

const resolving: Store = g[KEY] ?? (g[KEY] = new AsyncLocalStorage<true>())

/** Runs `fn` (one principal resolution) with the mark set. */
export function runResolvingPrincipal<T>(fn: () => Promise<T>): Promise<T> {
  return resolving.run(true, fn)
}

/** True while the current async context is inside a principal resolution. */
export function isResolvingPrincipal(): boolean {
  return resolving.getStore() === true
}
