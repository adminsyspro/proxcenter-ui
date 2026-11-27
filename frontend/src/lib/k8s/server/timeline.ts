// Cluster history, read on demand: Kubernetes events, rollout revisions
// (Deployment ReplicaSets, StatefulSet and DaemonSet ControllerRevisions, with
// the image change of each revision) and the actions taken from ProxCenter
// (audit log). Nothing is watched or stored; events live as long as the
// cluster keeps them (one hour by default), revisions and actions stay.

import { AppsV1Api, CoreV1Api } from '@kubernetes/client-node'
import type { K8sErrorCode } from './errors'
import { classifyK8sError } from './errors'
import { buildKubeClient, type BuildKubeClientInput } from './client'

const PER_CALL_TIMEOUT_MS = 10_000
/** Page size of each list call, the bound on what one history read costs the API server. */
export const TIMELINE_LIST_LIMIT = 500
export const TIMELINE_MAX_ENTRIES = 300
const REVISION_ANNOTATION = 'deployment.kubernetes.io/revision'
const REVISION_HISTORY_ANNOTATION = 'deployment.kubernetes.io/revision-history'
const RESTARTED_AT = 'kubectl.kubernetes.io/restartedAt'

/** What a revision changed: the images, only the restart stamp, or something else in the pod template. */
export type RolloutChange = 'image' | 'restart' | 'config'

interface Base { at: string; kind: string; namespace?: string; name: string }
export type TimelineEntry =
  | (Base & { source: 'event'; type: string; reason: string; message: string; count: number })
  | (Base & { source: 'rollout'; revision: number; images: string[]; previousImages: string[]; change: RolloutChange })
  | (Base & { source: 'action'; action: string; status: string; user?: string; details?: Record<string, unknown> })

function rfc3339(d: Date | string | undefined | null): string {
  if (!d) return ''
  const date = typeof d === 'string' ? new Date(d) : d
  if (Number.isNaN(date.getTime()) || date.getTime() === 0) return ''
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

function withDeadline<T>(p: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`k8s call exceeded ${PER_CALL_TIMEOUT_MS}ms deadline`)), PER_CALL_TIMEOUT_MS)
    p.then(v => { clearTimeout(timer); resolve(v) }, e => { clearTimeout(timer); reject(e) })
  })
}

export function eventEntry(e: any): TimelineEntry {
  const obj = e.involvedObject ?? {}
  return {
    source: 'event',
    at: rfc3339(e.lastTimestamp ?? e.eventTime ?? e.metadata?.creationTimestamp),
    kind: String(obj.kind ?? '').toLowerCase(),
    namespace: obj.namespace ?? e.metadata?.namespace ?? undefined,
    name: obj.name ?? '',
    type: e.type ?? '',
    reason: e.reason ?? '',
    message: String(e.message ?? '').slice(0, 2000),
    count: e.count ?? 1,
  }
}

function imagesOf(template: any): string[] {
  return (template?.spec?.containers ?? []).map((c: any) => c?.image).filter((i: unknown): i is string => typeof i === 'string')
}

interface Revisioned { owner: { kind: string; uid: string; name: string }; namespace?: string; revision: number; at: string; images: string[]; template: any }

function ownerOf(obj: any): Revisioned['owner'] | null {
  const ref = (obj.metadata?.ownerReferences ?? []).find((o: any) => o.controller) ?? obj.metadata?.ownerReferences?.[0]
  return ref ? { kind: String(ref.kind).toLowerCase(), uid: ref.uid, name: ref.name } : null
}

/**
 * When a revision started. A rollback reuses the ReplicaSet of the earlier
 * revision (its revision-history annotation says so), whose creation time is
 * then the old one: the controller's last write to it is the rollback.
 */
export function revisionTime(rs: any): string {
  if (rs.metadata?.annotations?.[REVISION_HISTORY_ANNOTATION]) {
    const writes = (rs.metadata?.managedFields ?? []).map((f: any) => rfc3339(f.time)).filter(Boolean).sort((a: string, b: string) => a.localeCompare(b))
    if (writes.length) return writes[writes.length - 1]
  }
  return rfc3339(rs.metadata?.creationTimestamp)
}

/** Pod template without the parts that change on every revision by construction. */
function comparableTemplate(template: any): string {
  const t = structuredClone(template ?? {})
  if (t.metadata?.labels) delete t.metadata.labels['pod-template-hash']
  if (t.metadata?.annotations) {
    delete t.metadata.annotations[RESTARTED_AT]
    if (Object.keys(t.metadata.annotations).length === 0) delete t.metadata.annotations
  }
  return JSON.stringify(t)
}

export function rolloutChange(prev: { images: string[]; template: any }, next: { images: string[]; template: any }): RolloutChange {
  if (prev.images.join('\n') !== next.images.join('\n')) return 'image'
  const restarted = prev.template?.metadata?.annotations?.[RESTARTED_AT] !== next.template?.metadata?.annotations?.[RESTARTED_AT]
  return restarted && comparableTemplate(prev.template) === comparableTemplate(next.template) ? 'restart' : 'config'
}

/**
 * One entry per revision, oldest revision of each workload excluded when it
 * is the first one (creation shows in the workload's age), each carrying the
 * images of the revision before it.
 */
export function rolloutEntries(replicaSets: any[], controllerRevisions: any[]): TimelineEntry[] {
  const revs: Revisioned[] = []
  for (const rs of replicaSets) {
    const owner = ownerOf(rs)
    const revision = Number.parseInt(rs.metadata?.annotations?.[REVISION_ANNOTATION] ?? '', 10)
    if (!owner || owner.kind !== 'deployment' || Number.isNaN(revision)) continue
    revs.push({ owner, namespace: rs.metadata?.namespace, revision, at: revisionTime(rs), images: imagesOf(rs.spec?.template), template: rs.spec?.template })
  }
  for (const cr of controllerRevisions) {
    const owner = ownerOf(cr)
    if (!owner || (owner.kind !== 'statefulset' && owner.kind !== 'daemonset')) continue
    revs.push({ owner, namespace: cr.metadata?.namespace, revision: Number(cr.revision ?? 0), at: rfc3339(cr.metadata?.creationTimestamp), images: imagesOf(cr.data?.spec?.template), template: cr.data?.spec?.template })
  }
  const byOwner = new Map<string, Revisioned[]>()
  for (const r of revs) byOwner.set(r.owner.uid, [...(byOwner.get(r.owner.uid) ?? []), r])
  const out: TimelineEntry[] = []
  for (const list of byOwner.values()) {
    list.sort((a, b) => a.revision - b.revision)
    for (let i = 1; i < list.length; i++) {
      const r = list[i]
      const prev = list[i - 1]
      out.push({ source: 'rollout', at: r.at, kind: r.owner.kind, namespace: r.namespace, name: r.owner.name, revision: r.revision, images: r.images, previousImages: prev.images, change: rolloutChange(prev, r) })
    }
  }
  return out
}

/** Parses the resourceId the K8S routes audit with: cluster, cluster/node, cluster/ns/kind/name. */
export function actionEntry(row: { timestamp: Date; action: string; status: string; resourceType: string | null; resourceId: string | null; resourceName: string | null; userEmail: string | null; details: unknown }): TimelineEntry {
  const parts = (row.resourceId ?? '').split('/')
  let base: Omit<Base, 'at'> = { kind: 'cluster', name: row.resourceName ?? '' }
  if (parts.length === 4) base = { kind: parts[2], namespace: parts[1], name: parts[3] }
  else if (parts.length === 2) base = { kind: 'node', name: parts[1] }
  const details = row.details && typeof row.details === 'object' ? row.details as Record<string, unknown> : undefined
  return { source: 'action', at: rfc3339(row.timestamp), ...base, action: row.action, status: row.status, user: row.userEmail ?? undefined, details }
}

export function mergeTimeline(entries: TimelineEntry[], namespace?: string): TimelineEntry[] {
  return entries
    .filter(e => e.at && (!namespace || e.namespace === namespace))
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, TIMELINE_MAX_ENTRIES)
}

export async function readClusterHistory(
  input: BuildKubeClientInput,
  namespace?: string,
): Promise<{ ok: boolean; errorCode?: K8sErrorCode; value?: TimelineEntry[]; partial?: boolean }> {
  const built = buildKubeClient(input)
  if (!built.ok || !built.makeApiClient) return { ok: false, errorCode: 'config' }
  const core = built.makeApiClient(CoreV1Api)
  const apps = built.makeApiClient(AppsV1Api)
  const limit = TIMELINE_LIST_LIMIT
  const [ev, rs, cr] = await Promise.allSettled([
    withDeadline(namespace ? core.listNamespacedEvent({ namespace, limit }) : core.listEventForAllNamespaces({ limit })),
    withDeadline(namespace ? apps.listNamespacedReplicaSet({ namespace, limit }) : apps.listReplicaSetForAllNamespaces({ limit })),
    withDeadline(namespace ? apps.listNamespacedControllerRevision({ namespace, limit }) : apps.listControllerRevisionForAllNamespaces({ limit })),
  ])
  if (ev.status === 'rejected' && rs.status === 'rejected' && cr.status === 'rejected') {
    return { ok: false, errorCode: classifyK8sError(ev.reason) }
  }
  const entries: TimelineEntry[] = [
    ...(ev.status === 'fulfilled' ? (ev.value.items ?? []).map(eventEntry) : []),
    ...rolloutEntries(rs.status === 'fulfilled' ? rs.value.items ?? [] : [], cr.status === 'fulfilled' ? cr.value.items ?? [] : []),
  ]
  const partial = [ev, rs, cr].some(r => r.status === 'rejected')
  return { ok: true, value: entries, partial }
}
