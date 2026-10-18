/**
 * Tenant of server code that runs outside any HTTP request (roadmap#53).
 *
 * The migration pipelines resolve some of their connections through the
 * request's principal (getCurrentTenantId reads `headers()`). That works in
 * the after() continuation of the request that started a job, but the batch
 * scheduler also starts queued jobs from a timer, after a restart, where Next
 * has no request scope and `headers()` throws. The scheduler runs each job
 * inside runWithBackgroundTenant(batch.tenantId, ...): getCurrentTenantId and
 * getConnectionById read that tenant first.
 *
 * Only server code sets it; no request input reaches it. The store lives on
 * globalThis: a dev recompile gives modules a fresh instance, and the reader
 * (lib/tenant) and the writer (the scheduler) must share one store.
 */
import { AsyncLocalStorage } from "node:async_hooks"

const KEY = Symbol.for("proxcenter.backgroundTenant")
type Store = AsyncLocalStorage<{ tenantId: string }>
const g = globalThis as unknown as Record<symbol, Store | undefined>
const store: Store = g[KEY] ?? (g[KEY] = new AsyncLocalStorage<{ tenantId: string }>())

export function runWithBackgroundTenant<T>(tenantId: string, fn: () => T): T {
  return store.run({ tenantId }, fn)
}

/** The tenant set by runWithBackgroundTenant around the current call, if any. */
export function backgroundTenantId(): string | undefined {
  return store.getStore()?.tenantId
}
