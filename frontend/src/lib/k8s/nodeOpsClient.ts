// Shared client for the node day-2 op routes (cordon/drain). Used by the drawer
// (NodeOpsPanel) and the Nodes table row actions so the fetch/parse/error shape
// stays in one place.

import type { DrainResult } from './nodeDrain'

/** Backoff between passes of the client-side drain continuation loop. */
export const DRAIN_BACKOFF_MS = 3000

/** Per-node state of a background drain, surfaced in the Nodes table + drawer. */
export type DrainPhase = 'draining' | 'done' | 'stopped' | 'error'
export interface DrainRowState {
  phase: DrainPhase
  /** Latest drain pass result (evict/skip/refuse/blocked counts). */
  result?: DrainResult
  /** Set when phase === 'error'. */
  error?: string
}

/** Remix icon classes for the node day-2 actions (drawer buttons + table row). */
export const NODE_OP_ICONS = {
  cordon: 'ri-lock-line',
  uncordon: 'ri-lock-unlock-line',
  drain: 'ri-drop-line',
} as const

/** POST a node op and return the parsed body; throws Error(message) on !ok. */
export async function postNodeOp(
  clusterId: string,
  nodeName: string,
  op: 'cordon' | 'drain',
  body: Record<string, unknown>,
): Promise<any> {
  const res = await fetch(
    `/api/v1/k8s/clusters/${clusterId}/nodes/${encodeURIComponent(nodeName)}/${op}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
  )
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`)
  return data
}
