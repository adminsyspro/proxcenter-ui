// Node day-2 operations: cordon/uncordon and drain. These are the first
// mutating calls in the k8s subsystem; every request goes through the same
// SSRF-guarded client as the read paths (buildKubeClient).

import { CoreV1Api, PatchStrategy, setHeaderOptions } from '@kubernetes/client-node'
import type { K8sErrorCode } from './errors'
import { classifyK8sError } from './errors'
import { buildKubeClient, type BuildKubeClientInput } from './client'
import { classifyDrainPods, type DrainResult, type PodRef } from '../nodeDrain'

const PER_CALL_TIMEOUT_MS = 10_000
const DRAIN_BUDGET_MS = 40_000

// withDeadline: reject after ms so one hung API call cannot eat the whole
// drain budget. The underlying request is not aborted, only abandoned.
function withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`k8s call exceeded ${ms}ms deadline`)), ms)
    p.then(
      (v) => { clearTimeout(timer); resolve(v) },
      (e) => { clearTimeout(timer); reject(e) },
    )
  })
}

// Without this Content-Type override, client-node 1.4.0 sends json-patch and
// the strategic-merge body is rejected. setHeaderOptions installs the header
// via a middleware closure on the request configuration.
const strategicMergeOpts = () => setHeaderOptions('Content-Type', PatchStrategy.StrategicMergePatch)

export async function setNodeCordon(
  input: BuildKubeClientInput,
  nodeName: string,
  unschedulable: boolean,
): Promise<{ ok: boolean; errorCode?: K8sErrorCode; value?: { unschedulable: boolean } }> {
  const built = buildKubeClient(input)
  if (!built.ok || !built.makeApiClient) return { ok: false, errorCode: 'config' }
  const api = built.makeApiClient(CoreV1Api)

  try {
    await withDeadline(
      api.patchNode({ name: nodeName, body: { spec: { unschedulable } } }, strategicMergeOpts()),
      PER_CALL_TIMEOUT_MS,
    )
    const node = await withDeadline(api.readNode({ name: nodeName }), PER_CALL_TIMEOUT_MS)
    return { ok: true, value: { unschedulable: node?.spec?.unschedulable === true } }
  } catch (err) {
    return { ok: false, errorCode: classifyK8sError(err) }
  }
}

function podKey(p: PodRef): string {
  return `${p.namespace}/${p.name}`
}

export async function drainNode(
  input: BuildKubeClientInput,
  nodeName: string,
  opts: { force: boolean; dryRun: boolean },
): Promise<{ ok: boolean; errorCode?: K8sErrorCode; value?: DrainResult }> {
  const startedAt = Date.now()
  const built = buildKubeClient(input)
  if (!built.ok || !built.makeApiClient) return { ok: false, errorCode: 'config' }
  const api = built.makeApiClient(CoreV1Api)

  let cordoned = false
  if (!opts.dryRun) {
    const c = await setNodeCordon(input, nodeName, true)
    if (!c.ok) return { ok: false, errorCode: c.errorCode }
    cordoned = true
  }

  let pods: any[]
  try {
    const list = await withDeadline(
      api.listPodForAllNamespaces({ fieldSelector: `spec.nodeName=${nodeName}` }),
      PER_CALL_TIMEOUT_MS,
    )
    pods = list?.items ?? []
  } catch (err) {
    return { ok: false, errorCode: classifyK8sError(err) }
  }

  const cls = classifyDrainPods(pods, { force: opts.force })

  if (opts.dryRun) {
    return {
      ok: true,
      value: {
        cordoned: false,
        evicted: 0,
        skipped: cls.skipped.length,
        remaining: cls.evict,
        blockedByPdb: [],
        evictionFailures: [],
        refusedEmptyDir: cls.refusedEmptyDir,
        refusedUnmanaged: cls.refusedUnmanaged,
        done: false,
      },
    }
  }

  // Evict each pod, best effort, within an overall wall-clock budget so the
  // route stays bounded; whatever is left is picked up by the client loop.
  let evicted = 0
  const blockedByPdb: PodRef[] = []
  // Evictions that failed for a non-PDB, non-404 reason (RBAC, admission
  // webhook, apiserver error). Surfaced so a drain that can never progress
  // reports WHY instead of the client loop spinning silently.
  const evictionFailures: PodRef[] = []
  let evictionFailureReason: string | undefined
  // notConfirmedGone is ONLY the fallback used when the final re-list fails;
  // on the success path `remaining` is derived from the re-list Set below.
  const notConfirmedGone: PodRef[] = []

  for (const pod of cls.evict) {
    // Stop starting new evictions early enough that the last one (+ its deadline)
    // and the re-list below still finish under nginx's 60s proxy_read_timeout.
    if (Date.now() - startedAt > DRAIN_BUDGET_MS - PER_CALL_TIMEOUT_MS) { notConfirmedGone.push(pod); continue }
    try {
      await withDeadline(
        api.createNamespacedPodEviction({
          name: pod.name,
          namespace: pod.namespace,
          body: { apiVersion: 'policy/v1', kind: 'Eviction', metadata: { name: pod.name, namespace: pod.namespace } },
        }),
        PER_CALL_TIMEOUT_MS,
      )
      evicted++
    } catch (err) {
      const code = (err as { code?: number })?.code
      if (code === 429) {
        // Eviction would violate a PodDisruptionBudget; retry on a later pass.
        blockedByPdb.push(pod)
        notConfirmedGone.push(pod)
      } else if (code === 404) {
        evicted++ // already gone
      } else {
        evictionFailures.push(pod)
        notConfirmedGone.push(pod)
        if (!evictionFailureReason) {
          const msg = (err as { body?: { message?: string } })?.body?.message
          evictionFailureReason = msg || (code ? `HTTP ${code}` : 'eviction failed')
        }
      }
    }
  }

  // Re-list once: remaining = evict-set pods still present on the node
  // (PDB-blocked, failed, budget-skipped, or evicted but still terminating).
  let remaining: PodRef[]
  try {
    const relist = await withDeadline(
      api.listPodForAllNamespaces({ fieldSelector: `spec.nodeName=${nodeName}` }),
      PER_CALL_TIMEOUT_MS,
    )
    const present = new Set<string>(
      (relist?.items ?? []).map((p: any) => `${p?.metadata?.namespace ?? ''}/${p?.metadata?.name ?? ''}`),
    )
    remaining = cls.evict.filter((p) => present.has(podKey(p)))
  } catch {
    // The drain already mutated the cluster, so do not fail the whole call:
    // report every pod not confirmed gone and let the client loop re-run.
    remaining = notConfirmedGone
  }

  return {
    ok: true,
    value: {
      cordoned,
      evicted,
      skipped: cls.skipped.length,
      remaining,
      blockedByPdb,
      evictionFailures,
      evictionFailureReason,
      refusedEmptyDir: cls.refusedEmptyDir,
      refusedUnmanaged: cls.refusedUnmanaged,
      done: remaining.length === 0 && cls.refusedEmptyDir.length === 0 && cls.refusedUnmanaged.length === 0,
    },
  }
}

/** Whether a node exists and is cordoned (no new pod scheduled on it). */
export async function readNodeCordon(
  input: BuildKubeClientInput,
  nodeName: string,
): Promise<{ ok: boolean; errorCode?: K8sErrorCode; value?: { exists: boolean; cordoned: boolean } }> {
  const built = buildKubeClient(input)
  if (!built.ok || !built.makeApiClient) return { ok: false, errorCode: 'config' }
  const api = built.makeApiClient(CoreV1Api)
  try {
    const node = await withDeadline(api.readNode({ name: nodeName }), PER_CALL_TIMEOUT_MS)
    return { ok: true, value: { exists: true, cordoned: node?.spec?.unschedulable === true } }
  } catch (err) {
    const code = classifyK8sError(err)
    if (code === 'not_found') return { ok: true, value: { exists: false, cordoned: false } }
    return { ok: false, errorCode: code }
  }
}

/**
 * Deletes the node object of a worker whose VM is gone, so it does not stay
 * NotReady in the cluster. A node already gone is a success.
 */
export async function deleteNodeObject(
  input: BuildKubeClientInput,
  nodeName: string,
): Promise<{ ok: boolean; errorCode?: K8sErrorCode }> {
  const built = buildKubeClient(input)
  if (!built.ok || !built.makeApiClient) return { ok: false, errorCode: 'config' }
  const api = built.makeApiClient(CoreV1Api)
  try {
    await withDeadline(api.deleteNode({ name: nodeName }), PER_CALL_TIMEOUT_MS)
    return { ok: true }
  } catch (err) {
    const code = classifyK8sError(err)
    return code === 'not_found' ? { ok: true } : { ok: false, errorCode: code }
  }
}
