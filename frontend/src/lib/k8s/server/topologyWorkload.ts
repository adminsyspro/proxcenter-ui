/**
 * Pure workload relationship resolution for the K8s topology view.
 * No I/O, no side-effects. Consumes raw Kubernetes object lists and
 * produces groups, resources, and edges for the topology DTO.
 * Spec: sections 4.1-4.6 of 2026-06-30-k8s-topology-design.md
 */

import type {
  K8sTopologyGroup,
  K8sTopologyResource,
  K8sTopologyEdge,
} from '../topologyTypes'

// ---------------------------------------------------------------------------
// Input type
// ---------------------------------------------------------------------------

export interface WorkloadInput {
  namespaceMode: 'single' | 'all'
  namespace: string | null
  pods: Record<string, unknown>[]
  services: Record<string, unknown>[]
  ingresses: Record<string, unknown>[]
  deployments: Record<string, unknown>[]
  statefulsets: Record<string, unknown>[]
  daemonsets: Record<string, unknown>[]
  jobs: Record<string, unknown>[]
  cronjobs: Record<string, unknown>[]
  replicasets: Record<string, unknown>[]
  configmaps: Record<string, unknown>[]
  /** Per-kind capped flags passed by the orchestrator. Key = lowercase kind name. */
  cappedKinds: Record<string, boolean>
}

export interface WorkloadGraph {
  groups: K8sTopologyGroup[]
  resources: K8sTopologyResource[]
  edges: K8sTopologyEdge[]
}

// ---------------------------------------------------------------------------
// Internal raw-object field accessors (tsconfig strict:false tolerant)
// ---------------------------------------------------------------------------

function meta(obj: Record<string, unknown>): Record<string, unknown> {
  return (obj.metadata as Record<string, unknown>) ?? {}
}

function spec(obj: Record<string, unknown>): Record<string, unknown> {
  return (obj.spec as Record<string, unknown>) ?? {}
}

function labels(obj: Record<string, unknown>): Record<string, string> {
  return (meta(obj).labels as Record<string, string>) ?? {}
}

function ownerRefs(obj: Record<string, unknown>): Array<Record<string, unknown>> {
  return (meta(obj).ownerReferences as Array<Record<string, unknown>>) ?? []
}

function nsOf(obj: Record<string, unknown>): string {
  return (meta(obj).namespace as string) ?? ''
}

function uidOf(obj: Record<string, unknown>): string {
  return (meta(obj).uid as string) ?? ''
}

function nameOf(obj: Record<string, unknown>): string {
  return (meta(obj).name as string) ?? ''
}

// creationTimestamp arrives as a Date from @kubernetes/client-node (its
// ObjectSerializer deserializes date-time fields to Date), but can be an ISO
// string from other paths/fixtures. Normalize to epoch millis for sorting;
// unknown/invalid values sort last (0). Never call String methods on it.
function creationMillis(obj: Record<string, unknown>): number {
  const raw = meta(obj).creationTimestamp
  if (!raw) return 0
  const t = new Date(raw as string | number | Date).getTime()
  return Number.isNaN(t) ? 0 : t
}

/** Stable namespace-qualified resource ID. */
function makeId(ns: string, kind: string, name: string): string {
  return `${ns}/${kind}/${name}`
}

/** Group key for all-namespaces mode: <ns>/<app>. */
function makeGroupKey(ns: string, app: string, mode: 'single' | 'all'): string {
  return mode === 'all' ? `${ns}/${app}` : app
}

// ---------------------------------------------------------------------------
// 4.1 Owner resolution
// ---------------------------------------------------------------------------

type WorkloadKind = 'deployment' | 'statefulset' | 'daemonset' | 'job' | 'cronjob' | 'replicaset' | 'pod'

interface WorkloadNode {
  uid: string
  kind: WorkloadKind
  name: string
  namespace: string
  raw: Record<string, unknown>
  synthetic?: boolean
}

/** Map uid -> WorkloadNode for all top-level workloads (Deploy/STS/DS/Job/CronJob). */
function buildWorkloadMap(
  deployments: Record<string, unknown>[],
  statefulsets: Record<string, unknown>[],
  daemonsets: Record<string, unknown>[],
  jobs: Record<string, unknown>[],
  cronjobs: Record<string, unknown>[],
  replicasets: Record<string, unknown>[],
): Map<string, WorkloadNode> {
  const map = new Map<string, WorkloadNode>()
  for (const d of deployments) {
    map.set(uidOf(d), { uid: uidOf(d), kind: 'deployment', name: nameOf(d), namespace: nsOf(d), raw: d })
  }
  for (const s of statefulsets) {
    map.set(uidOf(s), { uid: uidOf(s), kind: 'statefulset', name: nameOf(s), namespace: nsOf(s), raw: s })
  }
  for (const d of daemonsets) {
    map.set(uidOf(d), { uid: uidOf(d), kind: 'daemonset', name: nameOf(d), namespace: nsOf(d), raw: d })
  }
  for (const j of jobs) {
    map.set(uidOf(j), { uid: uidOf(j), kind: 'job', name: nameOf(j), namespace: nsOf(j), raw: j })
  }
  for (const c of cronjobs) {
    map.set(uidOf(c), { uid: uidOf(c), kind: 'cronjob', name: nameOf(c), namespace: nsOf(c), raw: c })
  }
  for (const r of replicasets) {
    map.set(uidOf(r), { uid: uidOf(r), kind: 'replicaset', name: nameOf(r), namespace: nsOf(r), raw: r })
  }
  return map
}

/**
 * Returns the controller ownerRef entry from the list, or null.
 * Prefers the entry with controller:true; if none, returns the first entry.
 */
function controllerRef(refs: Array<Record<string, unknown>>): Record<string, unknown> | null {
  if (!refs.length) return null
  const ctrl = refs.find(r => r.controller === true)
  return ctrl ?? refs[0]
}

/**
 * Resolve the "effective workload owner" of a pod by following the chain:
 * Pod -> ReplicaSet -> Deployment (collapse the RS hop)
 * Pod -> StatefulSet / DaemonSet / Job
 * Returns null for orphan pods (no controller owner).
 */
function resolveOwner(
  pod: Record<string, unknown>,
  workloadByUid: Map<string, WorkloadNode>,
): WorkloadNode | null {
  const refs = ownerRefs(pod)
  const ref = controllerRef(refs)
  if (!ref) return null

  const ownerUid = ref.uid as string
  const ownerNode = workloadByUid.get(ownerUid)
  if (!ownerNode) return null

  if (ownerNode.kind === 'replicaset') {
    // Try to follow RS -> Deployment
    const rsRefs = ownerRefs(ownerNode.raw)
    const rsRef = controllerRef(rsRefs)
    if (rsRef) {
      const deployNode = workloadByUid.get(rsRef.uid as string)
      if (deployNode && deployNode.kind === 'deployment') {
        return deployNode
      }
    }
    // Orphan RS (no Deployment owner): return the RS node itself (may be synthetic)
    return ownerNode
  }

  return ownerNode
}

// ---------------------------------------------------------------------------
// Synthetic RS nodes for orphan ReplicaSets that own pods
// ---------------------------------------------------------------------------

function collectSyntheticRs(
  replicasets: Record<string, unknown>[],
  workloadByUid: Map<string, WorkloadNode>,
): Set<string> {
  const synthetic = new Set<string>()
  for (const rs of replicasets) {
    const uid = uidOf(rs)
    const rsNode = workloadByUid.get(uid)
    if (!rsNode) continue
    // Check if the RS has a Deployment owner
    const refs = ownerRefs(rs)
    const ref = controllerRef(refs)
    if (ref) {
      const owner = workloadByUid.get(ref.uid as string)
      if (owner && owner.kind === 'deployment') continue
    }
    // No Deployment owner: this RS is potentially synthetic
    synthetic.add(uid)
  }
  return synthetic
}

// ---------------------------------------------------------------------------
// Pod health
// ---------------------------------------------------------------------------

const FAILING_REASONS = new Set(['CrashLoopBackOff', 'ImagePullBackOff', 'Error', 'OOMKilled', 'Failed'])

function podWorstReason(pod: Record<string, unknown>): string | null {
  const status = (pod.status as Record<string, unknown>) ?? {}
  const containerStatuses = (status.containerStatuses as Array<Record<string, unknown>>) ?? []
  for (const cs of containerStatuses) {
    const state = (cs.state as Record<string, unknown>) ?? {}
    const waiting = (state.waiting as Record<string, unknown>)
    if (waiting?.reason && FAILING_REASONS.has(waiting.reason as string)) {
      return waiting.reason as string
    }
    const terminated = (state.terminated as Record<string, unknown>)
    if (terminated?.reason && FAILING_REASONS.has(terminated.reason as string)) {
      return terminated.reason as string
    }
  }
  const phase = status.phase as string
  if (phase === 'Failed') return 'Failed'
  return null
}

function isPodHealthyLongRunning(pod: Record<string, unknown>): boolean {
  const status = (pod.status as Record<string, unknown>) ?? {}
  const phase = status.phase as string
  if (phase !== 'Running') return false
  const containerStatuses = (status.containerStatuses as Array<Record<string, unknown>>) ?? []
  return containerStatuses.every(cs => cs.ready === true)
}

function isPodHealthyJob(pod: Record<string, unknown>): boolean {
  const status = (pod.status as Record<string, unknown>) ?? {}
  const phase = status.phase as string
  return phase === 'Succeeded' || phase === 'Running'
}

// ---------------------------------------------------------------------------
// Group label extraction
// ---------------------------------------------------------------------------

function extractAppLabel(obj: Record<string, unknown>): string | null {
  const lbl = labels(obj)
  return lbl['app.kubernetes.io/name'] ?? lbl['app'] ?? null
}

interface GroupRef { key: string; label: string; namespace: string }

// Compute the app group for a workload-like object.
// label chain: app.kubernetes.io/instance > /name > app ; else the object's own
// name (so each unlabeled workload is its own tile). The KEY stays a single
// makeGroupKey() so all-namespace keys remain <ns>/<app>; the LABEL is the raw
// app/workload name (never the composed key).
function groupOf(obj: Record<string, unknown>, mode: 'single' | 'all'): GroupRef {
  const lbl = labels(obj)
  const app =
    lbl['app.kubernetes.io/instance'] ??
    lbl['app.kubernetes.io/name'] ??
    lbl['app'] ??
    nameOf(obj) // fallback: the workload's own name
  const ns = nsOf(obj)
  return { key: makeGroupKey(ns, app, mode), label: app, namespace: ns }
}

// ---------------------------------------------------------------------------
// ConfigMap refs extraction from a pod template spec
// ---------------------------------------------------------------------------

function collectConfigMapNamesFromPodSpec(
  podSpec: Record<string, unknown>,
  ns: string,
  configmapNs: Map<string, Record<string, unknown>>,
): Set<string> {
  const found = new Set<string>()

  function scanContainer(c: Record<string, unknown>) {
    // envFrom[].configMapRef
    const envFrom = (c.envFrom as Array<Record<string, unknown>>) ?? []
    for (const ef of envFrom) {
      const ref = (ef.configMapRef as Record<string, unknown>)
      if (ref?.name) found.add(ref.name as string)
    }
    // env[].valueFrom.configMapKeyRef
    const env = (c.env as Array<Record<string, unknown>>) ?? []
    for (const e of env) {
      const valueFrom = (e.valueFrom as Record<string, unknown>)
      if (valueFrom) {
        const ckr = (valueFrom.configMapKeyRef as Record<string, unknown>)
        if (ckr?.name) found.add(ckr.name as string)
      }
    }
  }

  const containers = (podSpec.containers as Array<Record<string, unknown>>) ?? []
  const initContainers = (podSpec.initContainers as Array<Record<string, unknown>>) ?? []
  const ephemeralContainers = (podSpec.ephemeralContainers as Array<Record<string, unknown>>) ?? []
  for (const c of [...containers, ...initContainers, ...ephemeralContainers]) {
    scanContainer(c)
  }

  // volumes: configMap + projected.sources[].configMap
  const volumes = (podSpec.volumes as Array<Record<string, unknown>>) ?? []
  for (const vol of volumes) {
    const cm = (vol.configMap as Record<string, unknown>)
    if (cm?.name) found.add(cm.name as string)

    const projected = (vol.projected as Record<string, unknown>)
    if (projected) {
      const sources = (projected.sources as Array<Record<string, unknown>>) ?? []
      for (const src of sources) {
        const srcCm = (src.configMap as Record<string, unknown>)
        if (srcCm?.name) found.add(srcCm.name as string)
      }
    }
  }

  // Filter to only CMs that exist in the same namespace
  const result = new Set<string>()
  for (const name of found) {
    if (configmapNs.has(`${ns}/${name}`)) result.add(name)
  }
  return result
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function resolveWorkloadGraph(input: WorkloadInput): WorkloadGraph {
  const {
    namespaceMode,
    pods,
    services,
    ingresses,
    deployments,
    statefulsets,
    daemonsets,
    jobs,
    cronjobs,
    replicasets,
    configmaps,
    cappedKinds,
  } = input

  const resources: K8sTopologyResource[] = []
  const edges: K8sTopologyEdge[] = []

  // key -> GroupRef (label + namespace), populated by every groupOf() call
  // and every workload group assignment, so ensureGroup() can carry them.
  const groupRefByKey = new Map<string, GroupRef>()

  // -------------------------------------------------------------------------
  // Build UID maps
  // -------------------------------------------------------------------------
  const workloadByUid = buildWorkloadMap(deployments, statefulsets, daemonsets, jobs, cronjobs, replicasets)
  const syntheticRsUids = collectSyntheticRs(replicasets, workloadByUid)

  // ConfigMap lookup by ns/name
  const configmapByNsName = new Map<string, Record<string, unknown>>()
  for (const cm of configmaps) {
    configmapByNsName.set(`${nsOf(cm)}/${nameOf(cm)}`, cm)
  }

  // -------------------------------------------------------------------------
  // 4.1 Resolve pod owners + build pod groups
  // -------------------------------------------------------------------------

  // workloadUid -> pod[]
  const podsByWorkload = new Map<string, Array<Record<string, unknown>>>()
  const orphanPods: Array<Record<string, unknown>> = []

  for (const pod of pods) {
    const owner = resolveOwner(pod, workloadByUid)
    if (!owner) {
      orphanPods.push(pod)
    } else {
      const list = podsByWorkload.get(owner.uid) ?? []
      list.push(pod)
      podsByWorkload.set(owner.uid, list)
    }
  }

  // Track which RS uids actually have pods (only those become synthetic nodes)
  const rsWithPods = new Set<string>()
  for (const [uid] of podsByWorkload) {
    const node = workloadByUid.get(uid)
    if (node?.kind === 'replicaset') rsWithPods.add(uid)
  }

  // -------------------------------------------------------------------------
  // CronJob: determine which jobs to surface (active + latest completed, cap)
  // -------------------------------------------------------------------------

  // Map CronJob uid -> {activeJobUids, latestCompletedUid}
  const cronJobToVisibleJobs = new Map<string, { active: Set<string>; latestCompleted: string | null; historicalCount: number }>()

  for (const cj of cronjobs) {
    const cjUid = uidOf(cj)
    const cjStatus = (cj.status as Record<string, unknown>) ?? {}
    const activeRefs = (cjStatus.active as Array<Record<string, unknown>>) ?? []
    const activeUids = new Set<string>(activeRefs.map(r => r.uid as string).filter(Boolean))

    // Find all jobs owned by this CronJob
    const ownedJobs = jobs.filter(j => {
      const refs = ownerRefs(j)
      return refs.some(r => r.uid === cjUid && r.kind === 'CronJob')
    })

    const completedJobs = ownedJobs
      .filter(j => {
        const jStatus = (j.status as Record<string, unknown>) ?? {}
        return !activeUids.has(uidOf(j)) && (jStatus.completionTime || jStatus.succeeded)
      })
      // Newest first (descending creation time).
      .sort((a, b) => creationMillis(b) - creationMillis(a))

    const latestCompleted = completedJobs.length > 0 ? uidOf(completedJobs[0]) : null
    const historicalCount = completedJobs.length > 1 ? completedJobs.length - 1 : 0

    cronJobToVisibleJobs.set(cjUid, { active: activeUids, latestCompleted, historicalCount })
  }

  // Set of job UIDs that are visible (active or latest completed for their CronJob)
  const visibleJobUids = new Set<string>()
  for (const [, info] of cronJobToVisibleJobs) {
    for (const uid of info.active) visibleJobUids.add(uid)
    if (info.latestCompleted) visibleJobUids.add(info.latestCompleted)
  }
  // Jobs with no CronJob owner are always visible
  for (const j of jobs) {
    const refs = ownerRefs(j)
    const ref = controllerRef(refs)
    if (!ref || !workloadByUid.get(ref.uid as string) || workloadByUid.get(ref.uid as string)?.kind !== 'cronjob') {
      visibleJobUids.add(uidOf(j))
    }
  }

  // -------------------------------------------------------------------------
  // 4.4 Group key assignment for workloads
  // -------------------------------------------------------------------------

  // workloadUid -> GroupRef
  const workloadGroup = new Map<string, GroupRef>()
  for (const [uid, node] of workloadByUid) {
    const gref = groupOf(node.raw, namespaceMode)
    workloadGroup.set(uid, gref)
    groupRefByKey.set(gref.key, gref)
  }

  // -------------------------------------------------------------------------
  // Emit workload resource nodes
  // -------------------------------------------------------------------------

  // We'll emit synthetic RS nodes, real workload nodes (deploy/sts/ds/job/cj)
  // but skip RSes that have a Deployment owner (they are just implementation detail)

  // Emit Deployments
  for (const d of deployments) {
    const uid = uidOf(d)
    const ns = nsOf(d)
    const name = nameOf(d)
    const gk = workloadGroup.get(uid)?.key ?? 'ungrouped'
    resources.push({
      id: makeId(ns, 'deployment', name),
      uid,
      kind: 'deployment',
      name,
      namespace: ns,
      groupKey: gk,
      healthy: true,
    })
  }

  // Emit StatefulSets
  for (const s of statefulsets) {
    const uid = uidOf(s)
    const ns = nsOf(s)
    const name = nameOf(s)
    const gk = workloadGroup.get(uid)?.key ?? 'ungrouped'
    resources.push({
      id: makeId(ns, 'statefulset', name),
      uid,
      kind: 'statefulset',
      name,
      namespace: ns,
      groupKey: gk,
      healthy: true,
    })
  }

  // Emit DaemonSets
  for (const d of daemonsets) {
    const uid = uidOf(d)
    const ns = nsOf(d)
    const name = nameOf(d)
    const gk = workloadGroup.get(uid)?.key ?? 'ungrouped'
    resources.push({
      id: makeId(ns, 'daemonset', name),
      uid,
      kind: 'daemonset',
      name,
      namespace: ns,
      groupKey: gk,
      healthy: true,
    })
  }

  // Emit CronJobs
  for (const cj of cronjobs) {
    const uid = uidOf(cj)
    const ns = nsOf(cj)
    const name = nameOf(cj)
    const gk = workloadGroup.get(uid)?.key ?? 'ungrouped'
    const info = cronJobToVisibleJobs.get(uid)
    const subline = info && info.historicalCount > 0 ? `+${info.historicalCount} historical` : undefined
    resources.push({
      id: makeId(ns, 'cronjob', name),
      uid,
      kind: 'cronjob',
      name,
      namespace: ns,
      groupKey: gk,
      healthy: true,
      subline,
    })
  }

  // Emit Jobs (visible: standalone + active/latest-completed for CronJobs)
  for (const j of jobs) {
    const uid = uidOf(j)
    if (!visibleJobUids.has(uid)) continue
    const ns = nsOf(j)
    const name = nameOf(j)
    const gk = workloadGroup.get(uid)?.key ?? 'ungrouped'
    const jStatus = (j.status as Record<string, unknown>) ?? {}
    const completed = (jStatus.succeeded as number) ?? 0
    const failed = (jStatus.failed as number) ?? 0
    const active = (jStatus.active as number) ?? 0

    // Edge: CronJob -> Job (owns)
    const refs = ownerRefs(j)
    const ref = controllerRef(refs)
    if (ref) {
      const ownerNode = workloadByUid.get(ref.uid as string)
      if (ownerNode?.kind === 'cronjob') {
        edges.push({
          source: makeId(ownerNode.namespace, 'cronjob', ownerNode.name),
          target: makeId(ns, 'job', name),
          rel: 'owns',
        })
      }
    }

    resources.push({
      id: makeId(ns, 'job', name),
      uid,
      kind: 'job',
      name,
      namespace: ns,
      groupKey: gk,
      healthy: failed === 0,
      completed,
      failed,
      active,
    })
  }

  // Emit synthetic ReplicaSet nodes (orphan RS with pods)
  for (const rs of replicasets) {
    const uid = uidOf(rs)
    if (!syntheticRsUids.has(uid)) continue
    if (!rsWithPods.has(uid)) continue  // Only emit if it actually has pods
    const ns = nsOf(rs)
    const name = nameOf(rs)
    const gk = workloadGroup.get(uid)?.key ?? 'ungrouped'
    resources.push({
      id: makeId(ns, 'replicaset', name),
      uid,
      kind: 'replicaset',
      name,
      namespace: ns,
      groupKey: gk,
      healthy: true,
      synthetic: true,
    })
  }

  // -------------------------------------------------------------------------
  // 4.3 Pod Groups per workload
  // -------------------------------------------------------------------------

  for (const [wUid, wPods] of podsByWorkload) {
    const wNode = workloadByUid.get(wUid)
    if (!wNode) continue

    const ns = wNode.namespace
    const wKind = wNode.kind
    const wName = wNode.name
    const isJobKind = wKind === 'job' || wKind === 'cronjob'

    // Skip pod groups for invisible jobs
    if (wKind === 'job' && !visibleJobUids.has(wUid)) continue

    let healthyCount = 0
    let completedCount = 0
    let failedCount = 0
    let activeCount = 0
    let worstReason: string | null = null
    const nodePlacement: string[] = []

    for (const pod of wPods) {
      const nodeName = (spec(pod).nodeName as string)
      if (nodeName && !nodePlacement.includes(nodeName)) nodePlacement.push(nodeName)

      const phase = ((pod.status as Record<string, unknown>)?.phase as string)

      if (isJobKind) {
        if (phase === 'Succeeded') {
          healthyCount++
          completedCount++
        } else if (phase === 'Failed') {
          failedCount++
        } else {
          activeCount++
        }
      } else {
        if (isPodHealthyLongRunning(pod)) {
          healthyCount++
        }
        const wr = podWorstReason(pod)
        if (wr && !worstReason) worstReason = wr
      }
    }

    const gk = workloadGroup.get(wUid)?.key ?? 'ungrouped'
    const pgId = makeId(ns, 'podGroup', wName)

    const podGroupRes: K8sTopologyResource = {
      id: pgId,
      uid: `pg:${wUid}`,
      kind: 'podGroup',
      name: wName,
      namespace: ns,
      groupKey: gk,
      healthy: !worstReason,
      synthetic: true,
      podCount: wPods.length,
      healthyCount,
      nodePlacement,
      detailRef: { kind: wKind, namespace: ns, name: wName, uid: wUid },
      ...(cappedKinds.pods ? { incomplete: true } : {}),
      ...(worstReason ? { reason: worstReason } : {}),
    }

    if (isJobKind) {
      podGroupRes.completed = completedCount
      podGroupRes.failed = failedCount
      podGroupRes.active = activeCount
    }

    resources.push(podGroupRes)

    // Edge: workload -> podGroup (owns)
    const wId = makeId(ns, wKind, wName)
    edges.push({ source: wId, target: pgId, rel: 'owns' })
  }

  // -------------------------------------------------------------------------
  // Orphan pods as individual pod nodes
  // -------------------------------------------------------------------------

  for (const pod of orphanPods) {
    const ns = nsOf(pod)
    const name = nameOf(pod)
    const uid = uidOf(pod)
    const gref = groupOf(pod, namespaceMode)
    groupRefByKey.set(gref.key, gref)
    const gk = gref.key

    resources.push({
      id: makeId(ns, 'pod', name),
      uid,
      kind: 'pod',
      name,
      namespace: ns,
      groupKey: gk,
      healthy: isPodHealthyLongRunning(pod),
      ...(podWorstReason(pod) ? { reason: podWorstReason(pod)! } : {}),
    })
  }

  // -------------------------------------------------------------------------
  // 4.2 Service selector edges
  // -------------------------------------------------------------------------

  // Build pod label map: ns -> pod[] (with labels)
  // Also build workload-ownership map: pod uid -> workload node
  const podLabelsByNs = new Map<string, Array<{ uid: string; labels: Record<string, string>; owner: WorkloadNode | null }>>()
  for (const pod of pods) {
    const ns = nsOf(pod)
    const lbl = labels(pod)
    const owner = resolveOwner(pod, workloadByUid)
    const list = podLabelsByNs.get(ns) ?? []
    list.push({ uid: uidOf(pod), labels: lbl, owner })
    podLabelsByNs.set(ns, list)
  }

  // Emit service resources + selects edges
  const svcGroupKeys = new Map<string, string>()  // svc ns/name -> groupKey

  for (const svc of services) {
    const ns = nsOf(svc)
    const name = nameOf(svc)
    const uid = uidOf(svc)
    const svcId = makeId(ns, 'svc', name)
    const selectorSpec = (spec(svc).selector as Record<string, string>)

    let svcGroupKey: string | null = null
    if (extractAppLabel(svc)) {
      const gref = groupOf(svc, namespaceMode)
      groupRefByKey.set(gref.key, gref)
      svcGroupKey = gref.key
    }

    // Find matched pods (namespace-local, ALL selector labels must match)
    const matchedWorkloadUids = new Set<string>()
    const matchedOrphanPodUids = new Set<string>()

    if (selectorSpec && Object.keys(selectorSpec).length > 0) {
      const nsPodsData = podLabelsByNs.get(ns) ?? []
      for (const podData of nsPodsData) {
        // Check all selector labels match
        const matches = Object.entries(selectorSpec).every(([k, v]) => podData.labels[k] === v)
        if (!matches) continue

        if (podData.owner) {
          matchedWorkloadUids.add(podData.owner.uid)
        } else {
          matchedOrphanPodUids.add(podData.uid)
        }
      }
    }

    // Inherit group from matched workloads if no own label
    if (!svcGroupKey) {
      const groupsHit = new Set<string>()
      for (const wUid of matchedWorkloadUids) {
        const gk = workloadGroup.get(wUid)?.key
        if (gk) groupsHit.add(gk)
      }
      if (groupsHit.size === 1) {
        svcGroupKey = [...groupsHit][0]
      } else if (groupsHit.size > 1) {
        svcGroupKey = 'shared'
      } else {
        svcGroupKey = 'ungrouped'
      }
    }

    svcGroupKeys.set(`${ns}/${name}`, svcGroupKey)

    const svcRes: K8sTopologyResource = {
      id: svcId,
      uid,
      kind: 'service',
      name,
      namespace: ns,
      groupKey: svcGroupKey,
      healthy: true,
      ...(cappedKinds.services ? { incomplete: true } : {}),
      ...(cappedKinds.pods && matchedWorkloadUids.size > 0 ? { incomplete: true } : {}),
    }
    resources.push(svcRes)

    // Emit selects edges
    if (selectorSpec && Object.keys(selectorSpec).length > 0) {
      for (const wUid of matchedWorkloadUids) {
        const wNode = workloadByUid.get(wUid)
        if (!wNode) continue
        const targetId = makeId(wNode.namespace, wNode.kind, wNode.name)
        const targetGroupKey = workloadGroup.get(wUid)?.key ?? 'ungrouped'
        const crossGroup = svcGroupKey !== targetGroupKey
        edges.push({ source: svcId, target: targetId, rel: 'selects', ...(crossGroup ? { crossGroup: true } : {}) })
      }
      for (const podUid of matchedOrphanPodUids) {
        const orphanPod = orphanPods.find(p => uidOf(p) === podUid)
        if (!orphanPod) continue
        const podId = makeId(nsOf(orphanPod), 'pod', nameOf(orphanPod))
        edges.push({ source: svcId, target: podId, rel: 'selects' })
      }
    }
  }

  // -------------------------------------------------------------------------
  // 4.2 Ingress -> Service edges
  // -------------------------------------------------------------------------

  for (const ing of ingresses) {
    const ns = nsOf(ing)
    const name = nameOf(ing)
    const uid = uidOf(ing)
    const ingSpec = spec(ing)
    const ingId = makeId(ns, 'ingress', name)

    const routedSvcNames = new Set<string>()

    // spec.defaultBackend.service.name
    const defaultBackend = (ingSpec.defaultBackend as Record<string, unknown>)
    if (defaultBackend) {
      const backendSvc = (defaultBackend.service as Record<string, unknown>)
      if (backendSvc?.name) routedSvcNames.add(backendSvc.name as string)
    }

    // rules[].http.paths[].backend.service.name
    const rules = (ingSpec.rules as Array<Record<string, unknown>>) ?? []
    for (const rule of rules) {
      const http = (rule.http as Record<string, unknown>)
      if (!http) continue
      const paths = (http.paths as Array<Record<string, unknown>>) ?? []
      for (const path of paths) {
        const backend = (path.backend as Record<string, unknown>)
        if (!backend) continue
        // Ignore resource backends
        if (backend.resource) continue
        const backendSvc = (backend.service as Record<string, unknown>)
        if (backendSvc?.name) routedSvcNames.add(backendSvc.name as string)
      }
    }

    // Determine ingress group key
    let ingGroupKey: string | null = null
    if (extractAppLabel(ing)) {
      const gref = groupOf(ing, namespaceMode)
      groupRefByKey.set(gref.key, gref)
      ingGroupKey = gref.key
    }

    // Inherit from routed services if no label
    if (!ingGroupKey && routedSvcNames.size > 0) {
      const svcGroups = new Set<string>()
      for (const svcName of routedSvcNames) {
        const gk = svcGroupKeys.get(`${ns}/${svcName}`)
        if (gk) svcGroups.add(gk)
      }
      if (svcGroups.size === 1) ingGroupKey = [...svcGroups][0]
      else if (svcGroups.size > 1) ingGroupKey = 'shared'
      else ingGroupKey = 'ungrouped'
    }
    if (!ingGroupKey) ingGroupKey = 'ungrouped'

    resources.push({
      id: ingId,
      uid,
      kind: 'ingress',
      name,
      namespace: ns,
      groupKey: ingGroupKey,
      healthy: true,
    })

    for (const svcName of routedSvcNames) {
      const targetSvc = services.find(s => nsOf(s) === ns && nameOf(s) === svcName)
      if (!targetSvc) continue
      const targetId = makeId(ns, 'svc', svcName)
      const targetSvcGroupKey = svcGroupKeys.get(`${ns}/${svcName}`) ?? 'ungrouped'
      const crossGroup = ingGroupKey !== targetSvcGroupKey
      edges.push({ source: ingId, target: targetId, rel: 'routes', ...(crossGroup ? { crossGroup: true } : {}) })
    }
  }

  // -------------------------------------------------------------------------
  // 4.2 ConfigMap -> workload edges
  // -------------------------------------------------------------------------

  // For each workload (deploy/sts/ds/job/cj), extract the pod template spec
  function getPodTemplateSpec(node: WorkloadNode): Record<string, unknown> | null {
    const raw = node.raw
    const s = spec(raw)
    if (node.kind === 'cronjob') {
      const jobTemplate = (s.jobTemplate as Record<string, unknown>)
      if (!jobTemplate) return null
      const jSpec = (jobTemplate.spec as Record<string, unknown>)
      if (!jSpec) return null
      const template = (jSpec.template as Record<string, unknown>)
      return (template?.spec as Record<string, unknown>) ?? null
    }
    const template = (s.template as Record<string, unknown>)
    if (!template) return null
    return (template.spec as Record<string, unknown>) ?? null
  }

  const emittedCmUids = new Set<string>()
  // workload id -> set of cm names it references
  const workloadCmEdges = new Map<string, Set<string>>()

  for (const [wUid, wNode] of workloadByUid) {
    // Skip hidden jobs (capped CronJob history)
    if (wNode.kind === 'job' && !visibleJobUids.has(wUid)) continue

    const podTemplateSpec = getPodTemplateSpec(wNode)
    if (!podTemplateSpec) continue

    const cmNames = collectConfigMapNamesFromPodSpec(podTemplateSpec, wNode.namespace, configmapByNsName)
    if (cmNames.size === 0) continue

    const wId = makeId(wNode.namespace, wNode.kind, wNode.name)
    workloadCmEdges.set(wId, cmNames)
  }

  // Also collect for synthetic RS nodes
  for (const rs of replicasets) {
    const uid = uidOf(rs)
    if (!syntheticRsUids.has(uid) || !rsWithPods.has(uid)) continue
    // RS doesn't have pod templates in the same way (no spec.template exposed in our raw shape),
    // skip CM resolution for RS synthetic nodes.
  }

  // Now emit CM nodes and edges
  // We need to resolve CM group keys: inherit from the workload that configures it
  // (if unambiguous) else shared/ungrouped

  const cmToWorkloadGroups = new Map<string, Set<string>>()  // cm ns/name -> set of workload groupKeys
  const cmToWorkloadIds = new Map<string, Set<string>>()

  for (const [wId, cmNames] of workloadCmEdges) {
    // Find the workload's namespace and group
    const wResource = resources.find(r => r.id === wId)
    const wNs = wResource?.namespace ?? ''
    const wGroupKey = wResource?.groupKey ?? 'ungrouped'

    for (const cmName of cmNames) {
      const key = `${wNs}/${cmName}`
      const gkSet = cmToWorkloadGroups.get(key) ?? new Set()
      gkSet.add(wGroupKey)
      cmToWorkloadGroups.set(key, gkSet)

      const idSet = cmToWorkloadIds.get(key) ?? new Set()
      idSet.add(wId)
      cmToWorkloadIds.set(key, idSet)
    }
  }

  for (const cm of configmaps) {
    const ns = nsOf(cm)
    const name = nameOf(cm)
    const uid = uidOf(cm)
    const key = `${ns}/${name}`

    const workloadIds = cmToWorkloadIds.get(key)
    if (!workloadIds || workloadIds.size === 0) continue  // Only emit CMs that are referenced

    const cmId = makeId(ns, 'configmap', name)
    if (emittedCmUids.has(uid)) continue
    emittedCmUids.add(uid)

    const data = (cm.data as Record<string, unknown>) ?? {}
    const keyCount = Object.keys(data).length
    const subline = keyCount === 1 ? '1 key' : `${keyCount} keys`

    const cmGroupKeys = cmToWorkloadGroups.get(key) ?? new Set()
    let cmGroupKey: string
    if (cmGroupKeys.size === 1) {
      cmGroupKey = [...cmGroupKeys][0]
    } else if (cmGroupKeys.size > 1) {
      cmGroupKey = 'shared'
    } else if (extractAppLabel(cm)) {
      const gref = groupOf(cm, namespaceMode)
      groupRefByKey.set(gref.key, gref)
      cmGroupKey = gref.key
    } else {
      cmGroupKey = 'ungrouped'
    }

    resources.push({
      id: cmId,
      uid,
      kind: 'configmap',
      name,
      namespace: ns,
      groupKey: cmGroupKey,
      healthy: true,
      subline,
    })

    for (const wId of workloadIds) {
      const wResource = resources.find(r => r.id === wId)
      const wGroupKey = wResource?.groupKey ?? 'ungrouped'
      const crossGroup = cmGroupKey !== wGroupKey
      edges.push({ source: cmId, target: wId, rel: 'configures', ...(crossGroup ? { crossGroup: true } : {}) })
    }
  }

  // -------------------------------------------------------------------------
  // 4.4 Build groups + detect shared bucket
  // -------------------------------------------------------------------------

  const groupMap = new Map<string, K8sTopologyGroup>()

  function ensureGroup(key: string, isShared = false) {
    if (!groupMap.has(key)) {
      const ref = groupRefByKey.get(key)
      groupMap.set(key, {
        key,
        label: ref?.label ?? key,
        ...(ref?.namespace ? { namespace: ref.namespace } : {}),
        count: 0,
        ...(isShared ? { shared: true } : {}),
      })
    }
    if (isShared) groupMap.get(key)!.shared = true
  }

  for (const res of resources) {
    const gk = res.groupKey
    const isShared = gk === 'shared'
    ensureGroup(gk, isShared)
    groupMap.get(gk)!.count++
  }

  // crossGroup edges: mark edges that cross group boundaries
  for (const edge of edges) {
    const src = resources.find(r => r.id === edge.source)
    const tgt = resources.find(r => r.id === edge.target)
    if (src && tgt && src.groupKey !== tgt.groupKey && !edge.crossGroup) {
      edge.crossGroup = true
    }
  }

  const groups = [...groupMap.values()]

  return { groups, resources, edges }
}
