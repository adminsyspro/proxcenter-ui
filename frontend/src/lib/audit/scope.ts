// src/lib/audit/scope.ts
//
// Request-scoped flag shared by withAudit() and audit() (issue #1105).
//
// withAudit() runs a route handler inside this store with `explicit: false`.
// Every audit() call made while the handler runs flips it to true, which is
// how the wrapper knows the route already wrote its own, richer row and must
// not add a generic duplicate. Nothing from the request reaches the store:
// only the two server modules above touch it.
//
// The store lives on globalThis under a Symbol.for key for the same reason as
// lib/tenant/background.ts: Next dev can give a route compiled after a
// background task its own instance of every module, and the reader (audit())
// and the writer (withAudit()) must share one store.

import { AsyncLocalStorage } from "node:async_hooks"

export interface AuditScope {
  /** True once audit() has been called inside the scope. */
  explicit: boolean
}

const KEY = Symbol.for("proxcenter.auditScope")
type Store = AsyncLocalStorage<AuditScope>
const g = globalThis as unknown as Record<symbol, Store | undefined>

export const auditScope: Store = g[KEY] ?? (g[KEY] = new AsyncLocalStorage<AuditScope>())

/** Record that the current request wrote its own audit row; a no-op outside withAudit(). */
export function markAuditExplicit(): void {
  const scope = auditScope.getStore()
  if (scope) scope.explicit = true
}
