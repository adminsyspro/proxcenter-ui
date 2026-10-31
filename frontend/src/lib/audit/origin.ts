// src/lib/audit/origin.ts
//
// Who asked for an action, when it was not a click on the action's own
// button (roadmap#188). The execute route of the assistant's approved actions
// runs the existing route handler inside `runWithAuditOrigin(...)`: every audit
// row that handler writes, its own or the withAudit() safety net, then
// carries `via`, `conversationId` and `actionId` in its details, so the
// journal tells an action approved on an assistant card from the same action
// clicked in the UI. Nothing from the request reaches the store: only the
// execute route sets it, with values taken from a card it verified.
//
// On globalThis under a Symbol.for key, like ./scope.ts: Next dev can give a
// route compiled later its own instance of every module, and the writer (the
// execute route) and the reader (audit()) must share one store.

import { AsyncLocalStorage } from "node:async_hooks"

export interface AuditOrigin {
  via: "assistant"
  conversationId: string
  actionId: string
}

// `active` is cleared the moment the dispatch returns. AsyncLocalStorage
// hands the store to every timer and promise created inside the run, so work
// the handler started without awaiting it (a refresh, a sync) would otherwise
// tag its rows "via assistant" whenever it ends, long after the action. The
// store is one object shared by all those continuations: flipping its flag
// switches the tag off for all of them at once.
type ActiveOrigin = AuditOrigin & { active: boolean }

const KEY = Symbol.for("proxcenter.auditOrigin")
type Store = AsyncLocalStorage<ActiveOrigin>
const g = globalThis as unknown as Record<symbol, Store | undefined>

const auditOrigin: Store = g[KEY] ?? (g[KEY] = new AsyncLocalStorage<ActiveOrigin>())

/** Runs `fn` (the dispatch) with `origin` active, and only until it settles. */
export async function runWithAuditOrigin<T>(origin: AuditOrigin, fn: () => Promise<T>): Promise<T> {
  const store: ActiveOrigin = { ...origin, active: true }

  try {
    return await auditOrigin.run(store, fn)
  } finally {
    store.active = false
  }
}

/**
 * `details` with the current origin merged in, its keys winning; the very
 * same value when no origin is active, so every row written outside an
 * approved action is stored exactly as before. audit() calls it before its
 * first await, so a row the dispatch fires without awaiting is still tagged.
 */
export function withAuditOrigin(details: Record<string, any> | undefined): Record<string, any> | undefined {
  const origin = auditOrigin.getStore()
  if (!origin?.active) return details
  return {
    ...(details ?? {}),
    via: origin.via,
    conversationId: origin.conversationId,
    actionId: origin.actionId,
  }
}
