// Workload day-2 operations: restart, scale, rollback, pod delete. Same
// SSRF-guarded client and per-call deadline as the node operations.

import { AppsV1Api, CoreV1Api, PatchStrategy, setHeaderOptions } from '@kubernetes/client-node'
import type { K8sErrorCode } from './errors'
import { classifyK8sError } from './errors'
import { buildKubeClient, type BuildKubeClientInput } from './client'

const PER_CALL_TIMEOUT_MS = 10_000
/** Annotation kubectl sets for `rollout restart`; the controller rolls the pods when it changes. */
export const RESTARTED_AT_ANNOTATION = 'kubectl.kubernetes.io/restartedAt'
const REVISION_ANNOTATION = 'deployment.kubernetes.io/revision'

export type RestartableKind = 'deployment' | 'statefulset' | 'daemonset'
export type ScalableKind = 'deployment' | 'statefulset'

export interface DeploymentRevision {
  revision: number
  createdAt: string
  images: string[]
  /** Pods currently owned by this revision's ReplicaSet. */
  replicas: number
  current: boolean
}

type OpResult<T> = { ok: boolean; errorCode?: K8sErrorCode; value?: T }

function withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`k8s call exceeded ${ms}ms deadline`)), ms)
    p.then(
      (v) => { clearTimeout(timer); resolve(v) },
      (e) => { clearTimeout(timer); reject(e) },
    )
  })
}

const patchOpts = (strategy: (typeof PatchStrategy)[keyof typeof PatchStrategy]) => setHeaderOptions('Content-Type', strategy)

function rfc3339(d: Date | string | undefined): string {
  if (!d) return ''
  const date = typeof d === 'string' ? new Date(d) : d
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

function apps(input: BuildKubeClientInput): AppsV1Api | null {
  const built = buildKubeClient(input)
  if (!built.ok || !built.makeApiClient) return null
  return built.makeApiClient(AppsV1Api)
}

export async function restartWorkload(
  input: BuildKubeClientInput,
  kind: RestartableKind,
  namespace: string,
  name: string,
  now: Date = new Date(),
): Promise<OpResult<{ restartedAt: string }>> {
  const api = apps(input)
  if (!api) return { ok: false, errorCode: 'config' }
  const restartedAt = now.toISOString()
  const body = { spec: { template: { metadata: { annotations: { [RESTARTED_AT_ANNOTATION]: restartedAt } } } } }
  const req = { name, namespace, body }
  const opts = patchOpts(PatchStrategy.StrategicMergePatch)
  try {
    let call: Promise<unknown>
    if (kind === 'deployment') call = api.patchNamespacedDeployment(req, opts)
    else if (kind === 'statefulset') call = api.patchNamespacedStatefulSet(req, opts)
    else call = api.patchNamespacedDaemonSet(req, opts)
    await withDeadline(call, PER_CALL_TIMEOUT_MS)
    return { ok: true, value: { restartedAt } }
  } catch (err) {
    return { ok: false, errorCode: classifyK8sError(err) }
  }
}

export async function scaleWorkload(
  input: BuildKubeClientInput,
  kind: ScalableKind,
  namespace: string,
  name: string,
  replicas: number,
): Promise<OpResult<{ replicas: number }>> {
  const api = apps(input)
  if (!api) return { ok: false, errorCode: 'config' }
  const req = { name, namespace, body: { spec: { replicas } } }
  const opts = patchOpts(PatchStrategy.MergePatch)
  try {
    const call = kind === 'deployment'
      ? api.patchNamespacedDeploymentScale(req, opts)
      : api.patchNamespacedStatefulSetScale(req, opts)
    const scale = await withDeadline(call, PER_CALL_TIMEOUT_MS)
    return { ok: true, value: { replicas: scale?.spec?.replicas ?? replicas } }
  } catch (err) {
    return { ok: false, errorCode: classifyK8sError(err) }
  }
}

function selectorString(matchLabels: Record<string, string> | undefined): string | undefined {
  const entries = Object.entries(matchLabels ?? {})
  return entries.length ? entries.map(([k, v]) => `${k}=${v}`).join(',') : undefined
}

/** ReplicaSets owned by the Deployment, newest revision first. */
async function ownedReplicaSets(api: AppsV1Api, namespace: string, name: string): Promise<{ deployment: any; sets: any[] }> {
  const deployment = await withDeadline(api.readNamespacedDeployment({ name, namespace }), PER_CALL_TIMEOUT_MS)
  const uid = deployment?.metadata?.uid
  const list = await withDeadline(
    api.listNamespacedReplicaSet({ namespace, labelSelector: selectorString(deployment?.spec?.selector?.matchLabels) }),
    PER_CALL_TIMEOUT_MS,
  )
  const sets = (list?.items ?? [])
    .filter((rs: any) => (rs.metadata?.ownerReferences ?? []).some((o: any) => o.uid === uid))
    .sort((a: any, b: any) => revisionOf(b) - revisionOf(a))
  return { deployment, sets }
}

function revisionOf(obj: any): number {
  const n = Number.parseInt(obj?.metadata?.annotations?.[REVISION_ANNOTATION] ?? '', 10)
  return Number.isNaN(n) ? 0 : n
}

export function projectRevision(rs: any, currentRevision: number): DeploymentRevision {
  const revision = revisionOf(rs)
  return {
    revision,
    createdAt: rfc3339(rs.metadata?.creationTimestamp),
    images: (rs.spec?.template?.spec?.containers ?? []).map((c: any) => c.image ?? '').filter(Boolean),
    replicas: rs.status?.replicas ?? 0,
    current: revision === currentRevision,
  }
}

export async function listDeploymentRevisions(
  input: BuildKubeClientInput,
  namespace: string,
  name: string,
): Promise<OpResult<{ revisions: DeploymentRevision[] }>> {
  const api = apps(input)
  if (!api) return { ok: false, errorCode: 'config' }
  try {
    const { deployment, sets } = await ownedReplicaSets(api, namespace, name)
    const current = revisionOf(deployment)
    return { ok: true, value: { revisions: sets.map(rs => projectRevision(rs, current)) } }
  } catch (err) {
    return { ok: false, errorCode: classifyK8sError(err) }
  }
}

/**
 * The pod template of a ReplicaSet, ready to be written back into its
 * Deployment: the hash label the controller adds to each ReplicaSet is
 * removed, as `kubectl rollout undo` does.
 */
export function templateForRollback(rs: any): any {
  const template = structuredClone(rs?.spec?.template ?? {})
  if (template.metadata?.labels) delete template.metadata.labels['pod-template-hash']
  return template
}

export async function rollbackDeployment(
  input: BuildKubeClientInput,
  namespace: string,
  name: string,
  toRevision: number,
): Promise<OpResult<{ revision: number }>> {
  const api = apps(input)
  if (!api) return { ok: false, errorCode: 'config' }
  try {
    const { deployment, sets } = await ownedReplicaSets(api, namespace, name)
    if (toRevision === revisionOf(deployment)) return { ok: false, errorCode: 'conflict' }
    const target = sets.find(rs => revisionOf(rs) === toRevision)
    if (!target) return { ok: false, errorCode: 'not_found' }
    const body = [{ op: 'replace', path: '/spec/template', value: templateForRollback(target) }]
    await withDeadline(
      api.patchNamespacedDeployment({ name, namespace, body }, patchOpts(PatchStrategy.JsonPatch)),
      PER_CALL_TIMEOUT_MS,
    )
    return { ok: true, value: { revision: toRevision } }
  } catch (err) {
    return { ok: false, errorCode: classifyK8sError(err) }
  }
}

export async function deletePod(
  input: BuildKubeClientInput,
  namespace: string,
  name: string,
): Promise<OpResult<{ deleted: true }>> {
  const built = buildKubeClient(input)
  if (!built.ok || !built.makeApiClient) return { ok: false, errorCode: 'config' }
  const api = built.makeApiClient(CoreV1Api)
  try {
    await withDeadline(api.deleteNamespacedPod({ name, namespace }), PER_CALL_TIMEOUT_MS)
    return { ok: true, value: { deleted: true } }
  } catch (err) {
    return { ok: false, errorCode: classifyK8sError(err) }
  }
}
