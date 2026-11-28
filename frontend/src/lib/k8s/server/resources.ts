import {
  CoreV1Api,
  AppsV1Api,
  BatchV1Api,
  NetworkingV1Api,
} from '@kubernetes/client-node'
import type { ResourceListItem, K8sResourceKind } from '../types'
import type { K8sErrorCode } from './errors'
import { classifyK8sError } from './errors'
import { buildKubeClient, type BuildKubeClientInput } from './client'
import { parseCpuMillis, parseMemBytes } from './metrics'

const LIST_CAP = 500

type ListResourcesInput = BuildKubeClientInput

function rfc3339(ts: Date | string | undefined): string {
  if (!ts) return ''
  const d = typeof ts === 'string' ? new Date(ts) : ts
  if (isNaN(d.getTime())) return ''
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

function base(kind: string, obj: any): ResourceListItem {
  const meta = obj.metadata ?? {}
  return {
    kind,
    namespace: meta.namespace ?? undefined,
    name: meta.name ?? '',
    uid: meta.uid ?? '',
    createdAt: rfc3339(meta.creationTimestamp),
    summary: {},
  }
}

function derefI32(n: number | undefined | null): number {
  return n ?? 0
}

// ── per-kind projectors ────────────────────────────────────────────────────

function projectPod(p: any): ResourceListItem {
  const it = base('pod', p)
  const containers: any[] = p.spec?.containers ?? []
  const statuses: any[] = p.status?.containerStatuses ?? []
  let ready = 0
  let restarts = 0
  for (const cs of statuses) {
    if (cs.ready) ready++
    restarts += cs.restartCount ?? 0
  }
  it.summary['phase'] = p.status?.phase ?? ''
  it.summary['ready'] = `${ready}/${containers.length}`
  it.summary['restarts'] = String(restarts)
  it.summary['node'] = p.spec?.nodeName ?? ''
  it.summary['podIP'] = p.status?.podIP ?? ''
  const reason = podReason(p)
  if (reason) it.summary['reason'] = reason
  return it
}

/**
 * Why a pod is unhealthy, in kubectl's words: the waiting or terminated
 * reason of its first failing container (OOMKilled from the last run of a
 * restarting one), else the pod's own reason (Evicted), else Unschedulable
 * for a pod the scheduler could not place. Empty for a healthy pod.
 */
export function podReason(p: any): string {
  for (const cs of [...(p.status?.initContainerStatuses ?? []), ...(p.status?.containerStatuses ?? [])]) {
    if (cs.ready) continue
    const waiting = cs.state?.waiting?.reason
    if (waiting && waiting !== 'ContainerCreating' && waiting !== 'PodInitializing') {
      return cs.lastState?.terminated?.reason === 'OOMKilled' ? 'OOMKilled' : waiting
    }
    const terminated = cs.state?.terminated?.reason
    if (terminated && terminated !== 'Completed') return terminated
  }
  if (p.status?.reason) return p.status.reason
  const scheduled = (p.status?.conditions ?? []).find((c: any) => c.type === 'PodScheduled')
  if (scheduled?.status === 'False' && scheduled.reason) return scheduled.reason
  return ''
}

// Exported for tests.
const NODE_PRESSURE_CONDITIONS = new Set(['MemoryPressure', 'DiskPressure', 'PIDPressure', 'NetworkUnavailable'])

export function projectNode(n: any): ResourceListItem {
  const it = base('node', n)
  let ready = 'False'
  for (const cnd of (n.status?.conditions ?? [])) {
    if (cnd.type === 'Ready' && cnd.status === 'True') ready = 'True'
  }
  it.summary['ready'] = ready
  it.summary['version'] = n.status?.nodeInfo?.kubeletVersion ?? ''
  for (const a of (n.status?.addresses ?? [])) {
    if (a.type === 'InternalIP') it.summary['internalIP'] = a.address
    if (a.type === 'Hostname') it.summary['hostname'] = a.address
  }
  const roles: string[] = []
  for (const k of Object.keys(n.metadata?.labels ?? {})) {
    if (k.startsWith('node-role.kubernetes.io/')) {
      roles.push(k.slice('node-role.kubernetes.io/'.length))
    }
  }
  roles.sort((a, b) => a.localeCompare(b))
  it.summary['roles'] = roles.join(',')
  // Identity fields for VM-to-K8s-node correlation.
  const rawUuid: string = n.status?.nodeInfo?.systemUUID ?? ''
  if (rawUuid) it.summary['systemUUID'] = rawUuid.toLowerCase()
  const providerID: string = n.spec?.providerID ?? ''
  if (providerID) it.summary['providerID'] = providerID
  it.summary['unschedulable'] = n.spec?.unschedulable === true ? 'true' : 'false'
  // Size of the node as Kubernetes sees it (cores, memory in bytes): the
  // workers of one cluster may differ.
  const cpuMilli = parseCpuMillis(n.status?.capacity?.cpu ?? '')
  const memBytes = parseMemBytes(n.status?.capacity?.memory ?? '')
  if (cpuMilli > 0) it.summary['cpuSize'] = String(cpuMilli / 1000)
  if (memBytes > 0) it.summary['memSize'] = String(memBytes)
  const pressure = (n.status?.conditions ?? [])
    .filter((c: any) => NODE_PRESSURE_CONDITIONS.has(c.type) && c.status === 'True')
    .map((c: any) => c.type)
  if (pressure.length) it.summary['pressure'] = pressure.join(',')
  return it
}

function projectDeployment(d: any): ResourceListItem {
  const it = base('deployment', d)
  it.summary['ready'] = `${d.status?.readyReplicas ?? 0}/${derefI32(d.spec?.replicas)}`
  it.summary['upToDate'] = String(d.status?.updatedReplicas ?? 0)
  it.summary['available'] = String(d.status?.availableReplicas ?? 0)
  return it
}

function projectStatefulSet(s: any): ResourceListItem {
  const it = base('statefulset', s)
  it.summary['ready'] = `${s.status?.readyReplicas ?? 0}/${derefI32(s.spec?.replicas)}`
  return it
}

function projectDaemonSet(d: any): ResourceListItem {
  const it = base('daemonset', d)
  it.summary['ready'] = `${d.status?.numberReady ?? 0}/${d.status?.desiredNumberScheduled ?? 0}`
  return it
}

function projectJob(j: any): ResourceListItem {
  const it = base('job', j)
  it.summary['completions'] = `${j.status?.succeeded ?? 0}/${derefI32(j.spec?.completions)}`
  if (j.status?.completionTime != null) {
    it.summary['status'] = 'Complete'
  } else if ((j.status?.failed ?? 0) > 0) {
    it.summary['status'] = 'Failed'
  } else {
    it.summary['status'] = 'Running'
  }
  return it
}

function projectCronJob(c: any): ResourceListItem {
  const it = base('cronjob', c)
  it.summary['schedule'] = c.spec?.schedule ?? ''
  it.summary['suspend'] = String(c.spec?.suspend ?? false)
  if (c.status?.lastScheduleTime != null) {
    it.summary['lastSchedule'] = rfc3339(c.status.lastScheduleTime)
  }
  return it
}

function projectService(s: any): ResourceListItem {
  const it = base('service', s)
  it.summary['type'] = s.spec?.type ?? ''
  it.summary['clusterIP'] = s.spec?.clusterIP ?? ''
  const portStrs: string[] = []
  for (const p of (s.spec?.ports ?? [])) {
    portStrs.push(`${p.port}/${p.protocol}`)
  }
  it.summary['ports'] = portStrs.join(',')
  return it
}

function projectIngress(i: any): ResourceListItem {
  const it = base('ingress', i)
  const hosts: string[] = []
  for (const r of (i.spec?.rules ?? [])) {
    if (r.host) hosts.push(r.host)
  }
  it.summary['hosts'] = hosts.join(',')
  return it
}

function projectConfigMap(c: any): ResourceListItem {
  const it = base('configmap', c)
  const keys = Object.keys(c.data ?? {}).length + Object.keys(c.binaryData ?? {}).length
  it.summary['keys'] = String(keys)
  return it
}

const MAX_EVENT_MESSAGE = 2000

function eventTime(e: any): number {
  const t = e.lastTimestamp ?? e.eventTime ?? e.metadata?.creationTimestamp
  const ms = t ? new Date(t).getTime() : 0
  return Number.isNaN(ms) ? 0 : ms
}

function projectEventRow(e: any): ResourceListItem {
  const it = base('event', e)
  const message: string = e.message ?? ''
  it.summary['type'] = e.type ?? ''
  it.summary['reason'] = e.reason ?? ''
  it.summary['object'] = `${e.involvedObject?.kind ?? ''}/${e.involvedObject?.name ?? ''}`
  it.summary['message'] = message.length > MAX_EVENT_MESSAGE ? message.slice(0, MAX_EVENT_MESSAGE) : message
  it.summary['count'] = String(e.count ?? 0)
  const seen = eventTime(e)
  it.summary['lastSeen'] = seen ? rfc3339(new Date(seen)) : ''
  return it
}

function projectPvc(p: any): ResourceListItem {
  const it = base('pvc', p)
  it.summary['status'] = p.status?.phase ?? ''
  it.summary['storageClass'] = p.spec?.storageClassName ?? ''
  it.summary['capacity'] = p.status?.capacity?.storage ?? ''
  return it
}

function projectPv(p: any): ResourceListItem {
  const it = base('pv', p)
  it.summary['status'] = p.status?.phase ?? ''
  it.summary['storageClass'] = p.spec?.storageClassName ?? ''
  it.summary['capacity'] = p.spec?.capacity?.storage ?? ''
  return it
}

function projectNamespace(n: any): ResourceListItem {
  const it = base('namespace', n)
  it.summary['phase'] = n.status?.phase ?? ''
  return it
}

// ── dispatch table ─────────────────────────────────────────────────────────

type KindEntry = {
  scope: 'cluster' | 'namespaced'
  fetch: (makeApiClient: <T>(cls: new (...a: any[]) => T) => T, namespace?: string) => Promise<any[]>
  project: (obj: any) => ResourceListItem
  /** Keep the order returned by fetch instead of sorting by namespace and name. */
  keepOrder?: boolean
}

export const KIND_TABLE: Partial<Record<K8sResourceKind, KindEntry>> = {
  pod: {
    scope: 'namespaced',
    fetch: (make, ns) => {
      const api = make(CoreV1Api)
      return ns
        ? api.listNamespacedPod({ namespace: ns }).then(r => r.items)
        : api.listPodForAllNamespaces().then(r => r.items)
    },
    project: projectPod,
  },
  node: {
    scope: 'cluster',
    fetch: (make) => make(CoreV1Api).listNode().then(r => r.items),
    project: projectNode,
  },
  namespace: {
    scope: 'cluster',
    fetch: (make) => make(CoreV1Api).listNamespace().then(r => r.items),
    project: projectNamespace,
  },
  deployment: {
    scope: 'namespaced',
    fetch: (make, ns) => {
      const api = make(AppsV1Api)
      return ns
        ? api.listNamespacedDeployment({ namespace: ns }).then(r => r.items)
        : api.listDeploymentForAllNamespaces().then(r => r.items)
    },
    project: projectDeployment,
  },
  statefulset: {
    scope: 'namespaced',
    fetch: (make, ns) => {
      const api = make(AppsV1Api)
      return ns
        ? api.listNamespacedStatefulSet({ namespace: ns }).then(r => r.items)
        : api.listStatefulSetForAllNamespaces().then(r => r.items)
    },
    project: projectStatefulSet,
  },
  daemonset: {
    scope: 'namespaced',
    fetch: (make, ns) => {
      const api = make(AppsV1Api)
      return ns
        ? api.listNamespacedDaemonSet({ namespace: ns }).then(r => r.items)
        : api.listDaemonSetForAllNamespaces().then(r => r.items)
    },
    project: projectDaemonSet,
  },
  job: {
    scope: 'namespaced',
    fetch: (make, ns) => {
      const api = make(BatchV1Api)
      return ns
        ? api.listNamespacedJob({ namespace: ns }).then(r => r.items)
        : api.listJobForAllNamespaces().then(r => r.items)
    },
    project: projectJob,
  },
  cronjob: {
    scope: 'namespaced',
    fetch: (make, ns) => {
      const api = make(BatchV1Api)
      return ns
        ? api.listNamespacedCronJob({ namespace: ns }).then(r => r.items)
        : api.listCronJobForAllNamespaces().then(r => r.items)
    },
    project: projectCronJob,
  },
  service: {
    scope: 'namespaced',
    fetch: (make, ns) => {
      const api = make(CoreV1Api)
      return ns
        ? api.listNamespacedService({ namespace: ns }).then(r => r.items)
        : api.listServiceForAllNamespaces().then(r => r.items)
    },
    project: projectService,
  },
  ingress: {
    scope: 'namespaced',
    fetch: (make, ns) => {
      const api = make(NetworkingV1Api)
      return ns
        ? api.listNamespacedIngress({ namespace: ns }).then(r => r.items)
        : api.listIngressForAllNamespaces().then(r => r.items)
    },
    project: projectIngress,
  },
  // Most recent first: the table shows what is happening now, not an
  // alphabetical list of generated event names.
  event: {
    scope: 'namespaced',
    keepOrder: true,
    fetch: (make, ns) => {
      const api = make(CoreV1Api)
      const list = ns ? api.listNamespacedEvent({ namespace: ns }) : api.listEventForAllNamespaces()
      return list.then(r => [...r.items].sort((a, b) => eventTime(b) - eventTime(a)))
    },
    project: projectEventRow,
  },
  configmap: {
    scope: 'namespaced',
    fetch: (make, ns) => {
      const api = make(CoreV1Api)
      return ns
        ? api.listNamespacedConfigMap({ namespace: ns }).then(r => r.items)
        : api.listConfigMapForAllNamespaces().then(r => r.items)
    },
    project: projectConfigMap,
  },
  pvc: {
    scope: 'namespaced',
    fetch: (make, ns) => {
      const api = make(CoreV1Api)
      return ns
        ? api.listNamespacedPersistentVolumeClaim({ namespace: ns }).then(r => r.items)
        : api.listPersistentVolumeClaimForAllNamespaces().then(r => r.items)
    },
    project: projectPvc,
  },
  pv: {
    scope: 'cluster',
    fetch: (make) => make(CoreV1Api).listPersistentVolume().then(r => r.items),
    project: projectPv,
  },
}

// ── public API ─────────────────────────────────────────────────────────────

export async function listResources(
  input: ListResourcesInput,
  kind: K8sResourceKind,
  namespace?: string,
): Promise<{ ok: boolean; errorCode?: K8sErrorCode; value?: { items: ResourceListItem[]; truncated: boolean } }> {
  const entry = KIND_TABLE[kind]
  if (!entry) return { ok: false, errorCode: 'not_found' }

  const built = buildKubeClient(input)
  if (!built.ok || !built.makeApiClient) {
    return { ok: false, errorCode: 'config' }
  }

  const ns = entry.scope === 'cluster' ? undefined : namespace

  let rawItems: any[]
  try {
    rawItems = await entry.fetch(built.makeApiClient, ns)
  } catch (err) {
    return { ok: false, errorCode: classifyK8sError(err) }
  }

  const projected = rawItems.map(entry.project)

  if (!entry.keepOrder) {
    projected.sort((a, b) => {
      const nsCmp = (a.namespace ?? '').localeCompare(b.namespace ?? '')
      if (nsCmp !== 0) return nsCmp
      return a.name.localeCompare(b.name)
    })
  }

  const truncated = projected.length > LIST_CAP
  const items = truncated ? projected.slice(0, LIST_CAP) : projected

  return { ok: true, value: { items, truncated } }
}
