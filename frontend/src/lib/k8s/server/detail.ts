/**
 * Per-kind K8s resource detail section builders.
 * Ports /internal/kubernetes/resourcedetail.go + the buildDetail base from resources.go.
 * Pure logic — no client calls. YAML is added by Task 6.
 */
import type {
  ResourceDetail,
  DetailSection,
  DetailRow,
  DetailTable,
  OwnerRef,
  ContainerInfo,
  ResourceRef,
} from '../types'

// ── constants ──────────────────────────────────────────────────────────────

export const DETAIL_TABLE_CAP = 100

const sectionInfo       = 'info'
const sectionCapacity   = 'capacity'
const sectionConditions = 'conditions'
const sectionTaints     = 'taints'
const sectionResources  = 'resources'
const sectionVolumes    = 'volumes'
const sectionSelector   = 'selector'
const sectionPorts      = 'ports'
const sectionRules      = 'rules'
const sectionTLS        = 'tls'
const sectionDataKeys   = 'dataKeys'

// ── annotation filter ──────────────────────────────────────────────────────

const sensitiveAnnotationSubstrings = ['token', 'secret', 'password', 'passwd', 'credential', 'key', 'private-key', 'tls.key']

export function isSensitiveAnnotationKey(k: string): boolean {
  const lk = k.toLowerCase()
  if (lk === 'kubectl.kubernetes.io/last-applied-configuration') return true
  for (const s of sensitiveAnnotationSubstrings) {
    if (lk.includes(s)) return true
  }
  return false
}

/** Drops sensitive annotation keys, truncates long values, always returns {}. */
export function filterAnnotations(m: Record<string, string> | undefined | null): Record<string, string> {
  if (!m) return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(m)) {
    if (isSensitiveAnnotationKey(k)) continue
    out[k] = v.length > 2000 ? v.slice(0, 2000) + '...[truncated]' : v
  }
  return out
}

/** Guarantees a non-null map so consumers can safely call Object.keys. */
export function emptyIfNil(m: Record<string, string> | undefined | null): Record<string, string> {
  return m ?? {}
}

// ── low-level helpers ──────────────────────────────────────────────────────

function row(label: string, value: string): DetailRow {
  return { label, value }
}

/** Builds a scalar-row section. */
export function kvSection(titleKey: string, ...rows: DetailRow[]): DetailSection {
  return { title: titleKey, rows }
}

/** Returns null for empty rows; caps at DETAIL_TABLE_CAP and sets truncated. */
export function tableSection(
  titleKey: string,
  columns: string[],
  rows: string[][],
): DetailSection | null {
  if (!rows || rows.length === 0) return null
  let truncated = false
  if (rows.length > DETAIL_TABLE_CAP) {
    rows = rows.slice(0, DETAIL_TABLE_CAP)
    truncated = true
  }
  const table: DetailTable = { columns, rows, truncated }
  return { title: titleKey, table }
}

/** Renders matchLabels (sorted) then matchExpressions as [key, operator, values]. */
export function selectorTable(sel: any): DetailSection | null {
  if (!sel) return null
  const rowsOut: string[][] = []
  const keys = Object.keys(sel.matchLabels ?? {}).sort()
  for (const k of keys) {
    rowsOut.push([k, '=', sel.matchLabels[k]])
  }
  for (const e of (sel.matchExpressions ?? [])) {
    rowsOut.push([e.key, String(e.operator), (e.values ?? []).join(',')])
  }
  return tableSection(sectionSelector, ['key', 'operator', 'values'], rowsOut)
}

// ── misc helpers ───────────────────────────────────────────────────────────

function i32(n: number | undefined | null): string {
  if (n == null) return ''
  return String(Math.trunc(n))
}

function boolp(b: boolean | undefined | null): string {
  if (b == null) return ''
  return b ? 'true' : 'false'
}

function tsStr(t: string | undefined | null): string {
  return t ?? ''
}

function quantityStr(q: string | undefined | null): string {
  return q ?? ''
}

function accessModesStr(modes: string[] | undefined): string {
  return (modes ?? []).join(', ')
}

function rfc3339(ts: string | Date | undefined | null): string {
  if (!ts) return ''
  const d = typeof ts === 'string' ? new Date(ts) : ts
  if (isNaN(d.getTime())) return ''
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

// ── per-kind section builders ──────────────────────────────────────────────

export function detailNode(n: any): DetailSection[] {
  const secs: DetailSection[] = []
  const info: DetailRow[] = [
    row('Kubelet Version', n.status?.nodeInfo?.kubeletVersion ?? ''),
    row('OS Image', n.status?.nodeInfo?.osImage ?? ''),
    row('Kernel Version', n.status?.nodeInfo?.kernelVersion ?? ''),
    row('Container Runtime', n.status?.nodeInfo?.containerRuntimeVersion ?? ''),
    row('Architecture', n.status?.nodeInfo?.architecture ?? ''),
    row('Scheduling', n.spec?.unschedulable === true ? 'SchedulingDisabled' : 'Schedulable'),
  ]
  for (const a of (n.status?.addresses ?? [])) {
    if (a.type === 'InternalIP') {
      info.push(row('Internal IP', a.address ?? ''))
    } else if (a.type === 'Hostname') {
      info.push(row('Hostname', a.address ?? ''))
    }
  }
  // Identity fields for VM-to-K8s-node correlation.
  const rawUuid: string = n.status?.nodeInfo?.systemUUID ?? ''
  if (rawUuid) info.push(row('System UUID', rawUuid.toLowerCase()))
  const providerID: string = n.spec?.providerID ?? ''
  if (providerID) info.push(row('Provider ID', providerID))
  secs.push(kvSection(sectionInfo, ...info))

  const resourceOrder = ['cpu', 'memory', 'pods', 'ephemeral-storage']
  const capRowsOut: string[][] = []
  const capacity: Record<string, string> = n.status?.capacity ?? {}
  const allocatable: Record<string, string> = n.status?.allocatable ?? {}
  for (const rn of resourceOrder) {
    const cap = capacity[rn]
    const alloc = allocatable[rn]
    if (!cap && !alloc) continue
    capRowsOut.push([rn, quantityStr(cap), quantityStr(alloc)])
  }
  const capSec = tableSection(sectionCapacity, ['resource', 'capacity', 'allocatable'], capRowsOut)
  if (capSec) secs.push(capSec)

  const condRowsOut: string[][] = []
  for (const c of (n.status?.conditions ?? [])) {
    condRowsOut.push([String(c.type ?? ''), String(c.status ?? ''), String(c.reason ?? '')])
  }
  const condSec = tableSection(sectionConditions, ['type', 'status', 'reason'], condRowsOut)
  if (condSec) secs.push(condSec)

  const taintRowsOut: string[][] = []
  for (const t of (n.spec?.taints ?? [])) {
    taintRowsOut.push([t.key ?? '', t.value ?? '', t.effect ?? ''])
  }
  const taintSec = tableSection(sectionTaints, ['key', 'value', 'effect'], taintRowsOut)
  if (taintSec) secs.push(taintSec)

  return secs
}

export function detailNamespace(ns: any): DetailSection[] {
  return [kvSection(sectionInfo, row('Phase', ns.status?.phase ?? ''))]
}

/** Returns volume type label only — no secret/configMap/projected details. */
function volumeType(v: any): string {
  const vs = v
  if (vs.secret != null) return 'Secret'
  if (vs.configMap != null) return 'ConfigMap'
  if (vs.persistentVolumeClaim != null) return 'PersistentVolumeClaim'
  if (vs.emptyDir != null) return 'EmptyDir'
  if (vs.projected != null) return 'Projected'
  if (vs.hostPath != null) return 'HostPath'
  if (vs.downwardAPI != null) return 'DownwardAPI'
  return 'Other'
}

function resourceRows(containers: any[], kind: string, out: string[][]): string[][] {
  for (const c of containers) {
    const req = c.resources?.requests ?? {}
    const lim = c.resources?.limits ?? {}
    out.push([
      kind,
      c.name ?? '',
      quantityStr(req.cpu),
      quantityStr(lim.cpu),
      quantityStr(req.memory),
      quantityStr(lim.memory),
    ])
  }
  return out
}

export function detailPod(p: any): DetailSection[] {
  const secs: DetailSection[] = []
  secs.push(kvSection(sectionInfo,
    row('QoS Class', p.status?.qosClass ?? ''),
    row('Node', p.spec?.nodeName ?? ''),
    row('Pod IP', p.status?.podIP ?? ''),
    row('Host IP', p.status?.hostIP ?? ''),
    row('Service Account', p.spec?.serviceAccountName ?? ''),
    row('Priority Class', p.spec?.priorityClassName ?? ''),
  ))

  let resRows: string[][] = []
  resRows = resourceRows(p.spec?.initContainers ?? [], 'init', resRows)
  resRows = resourceRows(p.spec?.containers ?? [], 'app', resRows)
  resRows = resourceRows(p.spec?.ephemeralContainers ?? [], 'ephemeral', resRows)
  const resSec = tableSection(sectionResources, ['type', 'container', 'cpuReq', 'cpuLim', 'memReq', 'memLim'], resRows)
  if (resSec) secs.push(resSec)

  const volRowsOut: string[][] = []
  for (const v of (p.spec?.volumes ?? [])) {
    volRowsOut.push([v.name ?? '', volumeType(v)])
  }
  const volSec = tableSection(sectionVolumes, ['name', 'type'], volRowsOut)
  if (volSec) secs.push(volSec)

  const condRowsOut: string[][] = []
  for (const c of (p.status?.conditions ?? [])) {
    condRowsOut.push([String(c.type ?? ''), String(c.status ?? ''), String(c.reason ?? '')])
  }
  const condSec = tableSection(sectionConditions, ['type', 'status', 'reason'], condRowsOut)
  if (condSec) secs.push(condSec)

  return secs
}

export function detailDeployment(d: any): DetailSection[] {
  const ru = d.spec?.strategy?.rollingUpdate
  const maxSurge = ru?.maxSurge != null ? String(ru.maxSurge) : ''
  const maxUnavail = ru?.maxUnavailable != null ? String(ru.maxUnavailable) : ''
  const secs: DetailSection[] = [kvSection(sectionInfo,
    row('Desired', i32(d.spec?.replicas)),
    row('Updated', i32(d.status?.updatedReplicas)),
    row('Available', i32(d.status?.availableReplicas)),
    row('Ready', i32(d.status?.readyReplicas)),
    row('Strategy', d.spec?.strategy?.type ?? ''),
    row('Max Surge', maxSurge),
    row('Max Unavailable', maxUnavail),
    row('Min Ready Seconds', i32(d.spec?.minReadySeconds ?? 0)),
    row('Revision History Limit', i32(d.spec?.revisionHistoryLimit)),
  )]
  const sel = selectorTable(d.spec?.selector)
  if (sel) secs.push(sel)
  const cond: string[][] = []
  for (const c of (d.status?.conditions ?? [])) {
    cond.push([String(c.type ?? ''), String(c.status ?? ''), String(c.reason ?? '')])
  }
  const condSec = tableSection(sectionConditions, ['type', 'status', 'reason'], cond)
  if (condSec) secs.push(condSec)
  return secs
}

export function detailStatefulSet(s: any): DetailSection[] {
  const ru = s.spec?.updateStrategy?.rollingUpdate
  const partition = ru?.partition != null ? String(ru.partition) : ''
  const secs: DetailSection[] = [kvSection(sectionInfo,
    row('Ready', i32(s.status?.readyReplicas)),
    row('Current', i32(s.status?.currentReplicas)),
    row('Updated', i32(s.status?.updatedReplicas)),
    row('Service Name', s.spec?.serviceName ?? ''),
    row('Pod Management Policy', s.spec?.podManagementPolicy ?? ''),
    row('Update Strategy', s.spec?.updateStrategy?.type ?? ''),
    row('Partition', partition),
    row('Revision History Limit', i32(s.spec?.revisionHistoryLimit)),
  )]
  const sel = selectorTable(s.spec?.selector)
  if (sel) secs.push(sel)
  const cond: string[][] = []
  for (const c of (s.status?.conditions ?? [])) {
    cond.push([String(c.type ?? ''), String(c.status ?? ''), String(c.reason ?? '')])
  }
  const condSec = tableSection(sectionConditions, ['type', 'status', 'reason'], cond)
  if (condSec) secs.push(condSec)
  return secs
}

export function detailDaemonSet(ds: any): DetailSection[] {
  const secs: DetailSection[] = [kvSection(sectionInfo,
    row('Desired', i32(ds.status?.desiredNumberScheduled)),
    row('Current', i32(ds.status?.currentNumberScheduled)),
    row('Ready', i32(ds.status?.numberReady)),
    row('Updated', i32(ds.status?.updatedNumberScheduled)),
    row('Available', i32(ds.status?.numberAvailable)),
    row('Misscheduled', i32(ds.status?.numberMisscheduled)),
    row('Update Strategy', ds.spec?.updateStrategy?.type ?? ''),
  )]
  const sel = selectorTable(ds.spec?.selector)
  if (sel) secs.push(sel)
  return secs
}

export function detailJob(j: any): DetailSection[] {
  const secs: DetailSection[] = [kvSection(sectionInfo,
    row('Completions', i32(j.spec?.completions)),
    row('Parallelism', i32(j.spec?.parallelism)),
    row('Active', i32(j.status?.active ?? 0)),
    row('Succeeded', i32(j.status?.succeeded ?? 0)),
    row('Failed', i32(j.status?.failed ?? 0)),
    row('Start Time', tsStr(j.status?.startTime)),
    row('Completion Time', tsStr(j.status?.completionTime)),
    row('Backoff Limit', i32(j.spec?.backoffLimit)),
  )]
  const cond: string[][] = []
  for (const c of (j.status?.conditions ?? [])) {
    cond.push([String(c.type ?? ''), String(c.status ?? ''), String(c.reason ?? '')])
  }
  const condSec = tableSection(sectionConditions, ['type', 'status', 'reason'], cond)
  if (condSec) secs.push(condSec)
  return secs
}

export function detailCronJob(cj: any): DetailSection[] {
  return [kvSection(sectionInfo,
    row('Schedule', cj.spec?.schedule ?? ''),
    row('Suspend', boolp(cj.spec?.suspend)),
    row('Concurrency Policy', cj.spec?.concurrencyPolicy ?? ''),
    row('Last Schedule Time', tsStr(cj.status?.lastScheduleTime)),
    row('Last Successful Time', tsStr(cj.status?.lastSuccessfulTime)),
    row('Active', i32((cj.status?.active ?? []).length)),
    row('Successful History Limit', i32(cj.spec?.successfulJobsHistoryLimit)),
    row('Failed History Limit', i32(cj.spec?.failedJobsHistoryLimit)),
  )]
}

export function detailService(s: any): DetailSection[] {
  const lbIngresses = s.status?.loadBalancer?.ingress ?? []
  let lbIngress = ''
  if (lbIngresses.length > 0) {
    const first = lbIngresses[0]
    lbIngress = first.ip || first.hostname || ''
  }
  const secs: DetailSection[] = [kvSection(sectionInfo,
    row('Type', s.spec?.type ?? ''),
    row('Cluster IP', s.spec?.clusterIP ?? ''),
    row('Session Affinity', s.spec?.sessionAffinity ?? ''),
    row('External Traffic Policy', s.spec?.externalTrafficPolicy ?? ''),
    row('External IPs', (s.spec?.externalIPs ?? []).join(',')),
    row('Load Balancer', lbIngress),
  )]

  const ports: string[][] = []
  for (const p of (s.spec?.ports ?? [])) {
    const targetPort = p.targetPort != null ? String(p.targetPort) : ''
    ports.push([p.name ?? '', i32(p.port), targetPort, p.protocol ?? '', i32(p.nodePort ?? 0)])
  }
  const portSec = tableSection(sectionPorts, ['name', 'port', 'targetPort', 'protocol', 'nodePort'], ports)
  if (portSec) secs.push(portSec)

  const selector: Record<string, string> = s.spec?.selector ?? {}
  const selKeys = Object.keys(selector).sort()
  const selRows: string[][] = []
  for (const k of selKeys) {
    selRows.push([k, '=', selector[k]])
  }
  const selSec = tableSection(sectionSelector, ['key', 'operator', 'values'], selRows)
  if (selSec) secs.push(selSec)

  return secs
}

function ingressBackendStr(b: any): string {
  if (!b || !b.service) return ''
  const svc = b.service
  const port = svc.port?.name || (svc.port?.number ? String(svc.port.number) : '')
  if (!port) return svc.name ?? ''
  return `${svc.name ?? ''}:${port}`
}

export function detailIngress(ing: any): DetailSection[] {
  const secs: DetailSection[] = []
  const ruleRows: string[][] = []
  if (ing.spec?.defaultBackend) {
    ruleRows.push(['*', '', '', ingressBackendStr(ing.spec.defaultBackend)])
  }
  for (const r of (ing.spec?.rules ?? [])) {
    if (!r.http) continue
    for (const p of (r.http.paths ?? [])) {
      const pt = p.pathType ?? ''
      ruleRows.push([r.host ?? '', p.path ?? '', String(pt), ingressBackendStr(p.backend)])
    }
  }
  const ruleSec = tableSection(sectionRules, ['host', 'path', 'pathType', 'backend'], ruleRows)
  if (ruleSec) secs.push(ruleSec)

  const tlsRows: string[][] = []
  for (const tls of (ing.spec?.tls ?? [])) {
    tlsRows.push([(tls.hosts ?? []).join(','), '[hidden]'])
  }
  const tlsSec = tableSection(sectionTLS, ['hosts', 'secret'], tlsRows)
  if (tlsSec) secs.push(tlsSec)

  const className = ing.spec?.ingressClassName ?? ''
  const lbIngresses = ing.status?.loadBalancer?.ingress ?? []
  let lb = ''
  if (lbIngresses.length > 0) {
    const first = lbIngresses[0]
    lb = first.ip || first.hostname || ''
  }
  secs.push(kvSection(sectionInfo, row('Ingress Class', className), row('Load Balancer', lb)))
  return secs
}

export function detailConfigMap(cm: any): DetailSection[] {
  const keys = [
    ...Object.keys(cm.data ?? {}),
    ...Object.keys(cm.binaryData ?? {}),
  ].sort()
  const rows: string[][] = keys.map(k => [k])
  const sec = tableSection(sectionDataKeys, ['key'], rows)
  if (sec) return [sec]
  return []
}

export function detailPVC(pvc: any): DetailSection[] {
  const sc = pvc.spec?.storageClassName ?? ''
  const vm = pvc.spec?.volumeMode ?? ''
  const req = pvc.spec?.resources?.requests?.storage ?? ''
  return [kvSection(sectionInfo,
    row('Phase', pvc.status?.phase ?? ''),
    row('Volume Name', pvc.spec?.volumeName ?? ''),
    row('Storage Class', sc),
    row('Volume Mode', vm),
    row('Access Modes', accessModesStr(pvc.spec?.accessModes)),
    row('Requested', quantityStr(req)),
  )]
}

function pvSourceType(spec: any): string {
  if (spec.nfs) return 'NFS'
  if (spec.csi) return 'CSI'
  if (spec.iscsi) return 'iSCSI'
  if (spec.rbd) return 'RBD'
  if (spec.cephfs || spec.cephFS) return 'CephFS'
  if (spec.local) return 'Local'
  if (spec.hostPath) return 'HostPath'
  return 'Other'
}

export function detailPV(pv: any): DetailSection[] {
  const spec = pv.spec ?? {}
  const claim = spec.claimRef ? `${spec.claimRef.namespace ?? ''}/${spec.claimRef.name ?? ''}` : ''
  const vm = spec.volumeMode ?? ''
  const cap = spec.capacity?.storage ?? ''
  return [kvSection(sectionInfo,
    row('Phase', pv.status?.phase ?? ''),
    row('Capacity', quantityStr(cap)),
    row('Storage Class', spec.storageClassName ?? ''),
    row('Reclaim Policy', spec.persistentVolumeReclaimPolicy ?? ''),
    row('Access Modes', accessModesStr(spec.accessModes)),
    row('Volume Mode', vm),
    row('Claim', claim),
    row('Source Type', pvSourceType(spec)),
  )]
}

// ── kind dispatcher ────────────────────────────────────────────────────────

type SectionBuilder = (obj: any) => DetailSection[]

export const KIND_SECTION_BUILDERS: Record<string, SectionBuilder> = {
  node:        detailNode,
  namespace:   detailNamespace,
  pod:         detailPod,
  deployment:  detailDeployment,
  statefulset: detailStatefulSet,
  daemonset:   detailDaemonSet,
  job:         detailJob,
  cronjob:     detailCronJob,
  service:     detailService,
  ingress:     detailIngress,
  configmap:   detailConfigMap,
  pvc:         detailPVC,
  pv:          detailPV,
}

function detailSections(kind: string, obj: any): DetailSection[] | undefined {
  const builder = KIND_SECTION_BUILDERS[kind]
  if (!builder) return undefined
  const secs = builder(obj)
  return secs.length > 0 ? secs : undefined
}

// ── container state ────────────────────────────────────────────────────────

function containerState(s: any): string {
  if (s?.running) return 'running'
  if (s?.waiting) return `waiting:${s.waiting.reason ?? ''}`
  if (s?.terminated) return `terminated:${s.terminated.reason ?? ''}`
  return 'unknown'
}

// ── buildDetailBase ────────────────────────────────────────────────────────

/**
 * Assembles a ResourceDetail for any kind from a raw deserialized K8s object.
 * yaml is intentionally left as '' — Task 6 fills it via Task 3's sanitizer.
 */
export function buildDetailBase(kind: string, obj: any): ResourceDetail {
  const meta = obj.metadata ?? {}
  const ref: ResourceRef = {
    kind,
    namespace: meta.namespace ?? undefined,
    name: meta.name ?? '',
    uid: meta.uid ?? '',
  }
  const detail: ResourceDetail = {
    ref,
    createdAt: rfc3339(meta.creationTimestamp),
    labels: emptyIfNil(meta.labels),
    annotations: filterAnnotations(meta.annotations),
    summary: {},
    yaml: '',
  }

  if (meta.ownerReferences && Array.isArray(meta.ownerReferences)) {
    detail.owners = (meta.ownerReferences as any[]).map(o => ({
      kind: o.kind ?? '',
      name: o.name ?? '',
    } as OwnerRef))
  }

  if (kind === 'pod') {
    const statusByName: Record<string, any> = {}
    for (const cs of (obj.status?.containerStatuses ?? [])) {
      statusByName[cs.name] = cs
    }
    const initStatusByName: Record<string, any> = {}
    for (const cs of (obj.status?.initContainerStatuses ?? [])) {
      initStatusByName[cs.name] = cs
    }
    const containers: ContainerInfo[] = []
    for (const ctr of (obj.spec?.initContainers ?? [])) {
      const cs = initStatusByName[ctr.name] ?? {}
      containers.push({
        name: ctr.name ?? '',
        image: ctr.image ?? '',
        ready: cs.ready ?? false,
        restartCount: cs.restartCount ?? 0,
        state: containerState(cs.state),
      })
    }
    for (const ctr of (obj.spec?.containers ?? [])) {
      const cs = statusByName[ctr.name] ?? {}
      containers.push({
        name: ctr.name ?? '',
        image: ctr.image ?? '',
        ready: cs.ready ?? false,
        restartCount: cs.restartCount ?? 0,
        state: containerState(cs.state),
      })
    }
    detail.containers = containers
    detail.summary['phase'] = obj.status?.phase ?? ''
  }

  detail.sections = detailSections(kind, obj)
  return detail
}
