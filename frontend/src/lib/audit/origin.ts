// src/lib/audit/origin.ts
//
// Who asked for an action, when it was not a click on the action's own
// button (roadmap#188). The execute route of the assistant's approved actions
// runs the existing route handler inside `auditOrigin.run(...)`: every audit
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

const KEY = Symbol.for("proxcenter.auditOrigin")
type Store = AsyncLocalStorage<AuditOrigin>
const g = globalThis as unknown as Record<symbol, Store | undefined>

export const auditOrigin: Store = g[KEY] ?? (g[KEY] = new AsyncLocalStorage<AuditOrigin>())

/**
 * `details` with the current origin merged in, its keys winning; the very
 * same value when no origin is set, so every row written outside an approved
 * action is stored exactly as before.
 */
export function withAuditOrigin(details: Record<string, any> | undefined): Record<string, any> | undefined {
  const origin = auditOrigin.getStore()
  if (!origin) return details
  return {
    ...(details ?? {}),
    via: origin.via,
    conversationId: origin.conversationId,
    actionId: origin.actionId,
  }
}
