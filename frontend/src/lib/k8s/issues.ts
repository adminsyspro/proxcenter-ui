// "Problems" queue of a cluster: what is broken right now, ranked, computed
// from the resource lists the overview already reads. No extra API call per
// problem and nothing stored.

import type { K8sResourceKind, ResourceListItem } from './types'

export type IssueSeverity = 'critical' | 'warning'

export type IssueReason =
  | 'nodeNotReady' | 'nodePressure' | 'nodeCordoned'
  | 'crashLoop' | 'imagePull' | 'oomKilled' | 'configError' | 'podFailed' | 'evicted' | 'unschedulable' | 'pending' | 'restarting'
  | 'workloadDown' | 'workloadDegraded'
  | 'jobFailed' | 'pvcPending'

export interface Issue {
  severity: IssueSeverity
  reason: IssueReason
  kind: K8sResourceKind
  item: ResourceListItem
  /** Extra value shown in the reason text (restart count, ready ratio, pressure types). */
  detail?: string
}

export interface IssueInput {
  nodes?: ResourceListItem[]
  pods?: ResourceListItem[]
  deployments?: ResourceListItem[]
  statefulsets?: ResourceListItem[]
  daemonsets?: ResourceListItem[]
  jobs?: ResourceListItem[]
  pvcs?: ResourceListItem[]
}

/** Restarts from which a running pod is listed even when it is ready at the moment. */
export const RESTART_THRESHOLD = 5

const POD_REASONS: Record<string, { reason: IssueReason; severity: IssueSeverity }> = {
  CrashLoopBackOff: { reason: 'crashLoop', severity: 'critical' },
  ImagePullBackOff: { reason: 'imagePull', severity: 'critical' },
  ErrImagePull: { reason: 'imagePull', severity: 'critical' },
  InvalidImageName: { reason: 'imagePull', severity: 'critical' },
  OOMKilled: { reason: 'oomKilled', severity: 'critical' },
  CreateContainerConfigError: { reason: 'configError', severity: 'critical' },
  CreateContainerError: { reason: 'configError', severity: 'critical' },
  RunContainerError: { reason: 'configError', severity: 'critical' },
  Evicted: { reason: 'evicted', severity: 'warning' },
  Unschedulable: { reason: 'unschedulable', severity: 'warning' },
}

function ratio(item: ResourceListItem): { ready: number; desired: number } | null {
  const m = /^(\d+)\/(\d+)$/.exec(item.summary?.['ready'] ?? '')
  return m ? { ready: Number(m[1]), desired: Number(m[2]) } : null
}

function nodeIssues(nodes: ResourceListItem[]): Issue[] {
  const out: Issue[] = []
  for (const n of nodes) {
    if (n.summary?.['ready'] !== 'True') {
      out.push({ severity: 'critical', reason: 'nodeNotReady', kind: 'node', item: n })
      continue
    }
    const pressure = n.summary?.['pressure']
    if (pressure) out.push({ severity: 'warning', reason: 'nodePressure', kind: 'node', item: n, detail: pressure.split(',').join(', ') })
    if (n.summary?.['unschedulable'] === 'true') out.push({ severity: 'warning', reason: 'nodeCordoned', kind: 'node', item: n })
  }
  return out
}

function podIssue(p: ResourceListItem): Issue | null {
  const phase = p.summary?.['phase'] ?? ''
  if (phase === 'Succeeded') return null
  const reason = p.summary?.['reason'] ?? ''
  const known = POD_REASONS[reason]
  if (known) return { ...known, kind: 'pod', item: p }
  const restarts = Number(p.summary?.['restarts'] ?? 0)
  // Between two back-offs a crash-looping container shows its exit reason
  // (Error) instead of CrashLoopBackOff: the restarts tell them apart.
  if (reason === 'Error' && restarts > 0) return { severity: 'critical', reason: 'crashLoop', kind: 'pod', item: p }
  if (phase === 'Failed') return { severity: 'critical', reason: 'podFailed', kind: 'pod', item: p, detail: p.summary?.['reason'] || undefined }
  if (phase === 'Pending') return { severity: 'warning', reason: 'pending', kind: 'pod', item: p }
  if (restarts >= RESTART_THRESHOLD) return { severity: 'warning', reason: 'restarting', kind: 'pod', item: p, detail: String(restarts) }
  return null
}

function workloadIssues(kind: K8sResourceKind, items: ResourceListItem[]): Issue[] {
  const out: Issue[] = []
  for (const w of items) {
    const r = ratio(w)
    if (!r || r.desired === 0 || r.ready >= r.desired) continue
    const detail = `${r.ready}/${r.desired}`
    out.push(r.ready === 0
      ? { severity: 'critical', reason: 'workloadDown', kind, item: w, detail }
      : { severity: 'warning', reason: 'workloadDegraded', kind, item: w, detail })
  }
  return out
}

const SEVERITY_RANK: Record<IssueSeverity, number> = { critical: 0, warning: 1 }
// Within a severity: infrastructure first, then what users see, then the pods behind it.
const KIND_RANK: Partial<Record<K8sResourceKind, number>> = {
  node: 0, deployment: 1, statefulset: 1, daemonset: 1, job: 2, pvc: 3, pod: 4,
}

export function detectIssues(input: IssueInput): Issue[] {
  const issues: Issue[] = [
    ...nodeIssues(input.nodes ?? []),
    ...(input.pods ?? []).map(podIssue).filter((i): i is Issue => i !== null),
    ...workloadIssues('deployment', input.deployments ?? []),
    ...workloadIssues('statefulset', input.statefulsets ?? []),
    ...workloadIssues('daemonset', input.daemonsets ?? []),
    ...(input.jobs ?? []).filter(j => j.summary?.['status'] === 'Failed')
      .map((j): Issue => ({ severity: 'critical', reason: 'jobFailed', kind: 'job', item: j })),
    ...(input.pvcs ?? []).filter(p => p.summary?.['status'] === 'Pending')
      .map((p): Issue => ({ severity: 'warning', reason: 'pvcPending', kind: 'pvc', item: p })),
  ]
  return issues.sort((a, b) =>
    SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
    || (KIND_RANK[a.kind] ?? 9) - (KIND_RANK[b.kind] ?? 9)
    || (a.item.namespace ?? '').localeCompare(b.item.namespace ?? '')
    || a.item.name.localeCompare(b.item.name))
}
