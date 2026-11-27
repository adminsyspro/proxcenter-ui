// Workload actions offered on the explorer rows and in the detail drawer:
// which kind gets which action, and the validation of an action request.
// Shared by the route (server) and the explorer (client), so it imports
// nothing from the Kubernetes client.

import type { K8sResourceKind } from './types'

export type WorkloadAction = 'restart' | 'scale' | 'rollback' | 'delete'

export const MAX_REPLICAS = 1000

const ACTIONS_BY_KIND: Partial<Record<K8sResourceKind, WorkloadAction[]>> = {
  deployment: ['restart', 'scale', 'rollback'],
  statefulset: ['restart', 'scale'],
  daemonset: ['restart'],
  pod: ['delete'],
}

export function actionsFor(kind: K8sResourceKind): WorkloadAction[] {
  return ACTIONS_BY_KIND[kind] ?? []
}

/** Remix icon classes of the actions (table row and drawer). */
export const WORKLOAD_ACTION_ICONS: Record<WorkloadAction, string> = {
  restart: 'ri-restart-line',
  scale: 'ri-stack-line',
  rollback: 'ri-history-line',
  delete: 'ri-delete-bin-line',
}

export type WorkloadActionRequest =
  | { action: 'restart'; kind: 'deployment' | 'statefulset' | 'daemonset'; namespace: string; name: string }
  | { action: 'scale'; kind: 'deployment' | 'statefulset'; namespace: string; name: string; replicas: number }
  | { action: 'rollback'; kind: 'deployment'; namespace: string; name: string; revision: number }
  | { action: 'delete'; kind: 'pod'; namespace: string; name: string }

// RFC 1123 subdomain (object names) and label (namespaces).
const NAME_RE = /^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$/
const NAMESPACE_RE = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/

export function isValidName(name: unknown): name is string {
  return typeof name === 'string' && name.length <= 253 && NAME_RE.test(name)
}

export function isValidNamespace(ns: unknown): ns is string {
  return typeof ns === 'string' && ns.length <= 63 && NAMESPACE_RE.test(ns)
}

export function parseWorkloadAction(body: unknown):
  | { ok: true; value: WorkloadActionRequest; error?: undefined }
  | { ok: false; value?: undefined; error: string } {
  const b = (body ?? {}) as Record<string, unknown>
  const action = b.action as WorkloadAction
  const kind = b.kind as K8sResourceKind
  if (!actionsFor(kind).includes(action)) return { ok: false, error: 'action not available for this kind' }
  if (!isValidNamespace(b.namespace)) return { ok: false, error: 'invalid namespace' }
  if (!isValidName(b.name)) return { ok: false, error: 'invalid name' }
  const base = { namespace: b.namespace, name: b.name }

  if (action === 'scale') {
    const replicas = b.replicas
    if (typeof replicas !== 'number' || !Number.isInteger(replicas) || replicas < 0 || replicas > MAX_REPLICAS) {
      return { ok: false, error: `replicas must be an integer between 0 and ${MAX_REPLICAS}` }
    }
    return { ok: true, value: { action, kind: kind as 'deployment' | 'statefulset', ...base, replicas } }
  }
  if (action === 'rollback') {
    const revision = b.revision
    if (typeof revision !== 'number' || !Number.isInteger(revision) || revision < 1) {
      return { ok: false, error: 'revision must be a positive integer' }
    }
    return { ok: true, value: { action, kind: 'deployment', ...base, revision } }
  }
  if (action === 'delete') return { ok: true, value: { action, kind: 'pod', ...base } }
  return { ok: true, value: { action, kind: kind as 'deployment' | 'statefulset' | 'daemonset', ...base } }
}
