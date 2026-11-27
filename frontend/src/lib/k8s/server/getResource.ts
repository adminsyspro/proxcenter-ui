/**
 * Server-only. Assembles the full ResourceDetail for a single K8s object.
 * Fetches via the appropriate API client, builds base + sections (Task 2),
 * and attaches sanitized YAML (Task 3).
 */
import {
  CoreV1Api,
  AppsV1Api,
  BatchV1Api,
  NetworkingV1Api,
} from '@kubernetes/client-node'
import type { ResourceDetail, K8sResourceKind } from '../types'
import type { K8sErrorCode } from './errors'
import { classifyK8sError } from './errors'
import { buildKubeClient, type BuildKubeClientInput } from './client'
import { buildDetailBase } from './detail'
import { sanitizeToYaml } from './sanitize'

// ── per-kind fetch dispatch ────────────────────────────────────────────────
//
// C1-C3 LESSON: all ObjectParamAPI get methods return the object directly
// (no .body wrapper). Verified against:
//   ObjectParamAPI.d.ts — readNamespacedPod  -> Promise<V1Pod>
//                       — readNode           -> Promise<V1Node>
//                       — readNamespace      -> Promise<V1Namespace>
//                       — readNamespacedDeployment -> Promise<V1Deployment>
//                       — readNamespacedStatefulSet -> Promise<V1StatefulSet>
//                       — readNamespacedDaemonSet   -> Promise<V1DaemonSet>
//                       — readNamespacedJob         -> Promise<V1Job>
//                       — readNamespacedCronJob     -> Promise<V1CronJob>
//                       — readNamespacedService     -> Promise<V1Service>
//                       — readNamespacedIngress     -> Promise<V1Ingress>
//                       — readNamespacedConfigMap   -> Promise<V1ConfigMap>
//                       — readNamespacedPersistentVolumeClaim -> Promise<V1PersistentVolumeClaim>
//                       — readPersistentVolume      -> Promise<V1PersistentVolume>

type FetchFn = (
  makeApiClient: <T>(cls: new (...a: any[]) => T) => T,
  namespace: string | undefined,
  name: string,
) => Promise<any>

const KIND_FETCH: Partial<Record<K8sResourceKind, FetchFn>> = {
  pod: (make, ns, name) =>
    make(CoreV1Api).readNamespacedPod({ name, namespace: ns! }),

  node: (make, _ns, name) =>
    make(CoreV1Api).readNode({ name }),

  namespace: (make, _ns, name) =>
    make(CoreV1Api).readNamespace({ name }),

  deployment: (make, ns, name) =>
    make(AppsV1Api).readNamespacedDeployment({ name, namespace: ns! }),

  statefulset: (make, ns, name) =>
    make(AppsV1Api).readNamespacedStatefulSet({ name, namespace: ns! }),

  daemonset: (make, ns, name) =>
    make(AppsV1Api).readNamespacedDaemonSet({ name, namespace: ns! }),

  job: (make, ns, name) =>
    make(BatchV1Api).readNamespacedJob({ name, namespace: ns! }),

  cronjob: (make, ns, name) =>
    make(BatchV1Api).readNamespacedCronJob({ name, namespace: ns! }),

  service: (make, ns, name) =>
    make(CoreV1Api).readNamespacedService({ name, namespace: ns! }),

  ingress: (make, ns, name) =>
    make(NetworkingV1Api).readNamespacedIngress({ name, namespace: ns! }),

  configmap: (make, ns, name) =>
    make(CoreV1Api).readNamespacedConfigMap({ name, namespace: ns! }),

  pvc: (make, ns, name) =>
    make(CoreV1Api).readNamespacedPersistentVolumeClaim({ name, namespace: ns! }),

  pv: (make, _ns, name) =>
    make(CoreV1Api).readPersistentVolume({ name }),
}

// ── public API ─────────────────────────────────────────────────────────────

export async function getResourceDetail(
  input: BuildKubeClientInput,
  kind: K8sResourceKind,
  namespace: string | undefined,
  name: string,
): Promise<{ ok: boolean; errorCode?: K8sErrorCode; value?: ResourceDetail }> {
  const fetchFn = KIND_FETCH[kind]
  if (!fetchFn) return { ok: false, errorCode: 'not_found' }

  const built = buildKubeClient(input)
  if (!built.ok || !built.makeApiClient) return { ok: false, errorCode: 'config' }

  let obj: any
  try {
    obj = await fetchFn(built.makeApiClient, namespace, name)
  } catch (err) {
    return { ok: false, errorCode: classifyK8sError(err) }
  }

  const detail = buildDetailBase(kind, obj)
  detail.yaml = sanitizeToYaml(obj)

  return { ok: true, value: detail }
}
