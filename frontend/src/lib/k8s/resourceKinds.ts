import type { K8sResourceKind } from './types'

export type ColumnType = 'text' | 'number' | 'age' | 'ratio' | 'badge' | 'progress'

export interface ColumnDef {
  /** Key into ResourceListItem.summary (or 'name' / 'namespace' / 'createdAt') */
  key: string
  /** i18n key suffix under kubernetes.explorer.col.* */
  header: string
  type: ColumnType
  /** Defaults to key when omitted */
  sortKey?: string
}

export interface KindDef {
  apiKind: K8sResourceKind
  /** English fallback; UI prefers i18n kubernetes.explorer.kind.<apiKind> */
  label: string
  scope: 'namespaced' | 'cluster'
  /** i18n key suffix under kubernetes.explorer.group.* */
  navGroup: string
  /** Remix Icon class (e.g. 'ri-server-line') shown in the kind nav. */
  icon: string
  /** Optional SVG asset path shown instead of the Remix font icon (e.g. the
   *  Kubernetes logo for nodes). Rendered by <KindIcon> when present. */
  iconImg?: string
  columns: ColumnDef[]
  /** Column and direction the table opens with; the first column ascending when absent. */
  defaultSort?: { key: string; dir: 'asc' | 'desc' }
}

/** Icon for the Overview nav entry (not a resource kind). */
export const OVERVIEW_ICON = 'ri-dashboard-line'

// ── Shared column definitions ───────────────────────────────────────────────

const NAME: ColumnDef = { key: 'name', header: 'name', type: 'text' }
const NS: ColumnDef = { key: 'namespace', header: 'namespace', type: 'text' }
const AGE: ColumnDef = { key: 'createdAt', header: 'age', type: 'age', sortKey: 'createdAt' }

// ── Catalogue ───────────────────────────────────────────────────────────────

export const RESOURCE_KINDS: KindDef[] = [
  {
    apiKind: 'node',
    label: 'Nodes',
    scope: 'cluster',
    navGroup: 'cluster',
    icon: 'ri-server-line',
    iconImg: '/images/kubernetes-logo.svg',
    columns: [
      NAME,
      { key: 'ready', header: 'ready', type: 'badge' },
      { key: 'roles', header: 'roles', type: 'text' },
      { key: 'pods', header: 'pods', type: 'number' },
      { key: 'version', header: 'version', type: 'text' },
      { key: 'internalIP', header: 'internalIP', type: 'text' },
      { key: 'cpuPct', header: 'cpu', type: 'progress' },
      { key: 'memPct', header: 'memory', type: 'progress' },
      AGE,
    ],
  },
  {
    apiKind: 'namespace',
    label: 'Namespaces',
    scope: 'cluster',
    navGroup: 'cluster',
    icon: 'ri-stack-line',
    columns: [
      NAME,
      { key: 'phase', header: 'phase', type: 'badge' },
      AGE,
    ],
  },
  {
    apiKind: 'pod',
    label: 'Pods',
    scope: 'namespaced',
    navGroup: 'workloads',
    icon: 'ri-box-3-line',
    columns: [
      NAME,
      NS,
      { key: 'phase', header: 'phase', type: 'badge' },
      { key: 'ready', header: 'ready', type: 'ratio' },
      { key: 'restarts', header: 'restarts', type: 'number' },
      { key: 'node', header: 'node', type: 'text' },
      { key: 'podIP', header: 'podIP', type: 'text' },
      // CPU/RAM as a % of the pod's node capacity (merged in client-side from
      // metrics.k8s.io; blank when the metrics-server is absent).
      { key: 'cpuPct', header: 'cpu', type: 'progress' },
      { key: 'memPct', header: 'memory', type: 'progress' },
      AGE,
    ],
  },
  {
    apiKind: 'deployment',
    label: 'Deployments',
    scope: 'namespaced',
    navGroup: 'workloads',
    icon: 'ri-rocket-line',
    columns: [
      NAME,
      NS,
      { key: 'ready', header: 'ready', type: 'ratio' },
      { key: 'upToDate', header: 'upToDate', type: 'number' },
      { key: 'available', header: 'available', type: 'number' },
      AGE,
    ],
  },
  {
    apiKind: 'statefulset',
    label: 'StatefulSets',
    scope: 'namespaced',
    navGroup: 'workloads',
    icon: 'ri-database-2-line',
    columns: [
      NAME,
      NS,
      { key: 'ready', header: 'ready', type: 'ratio' },
      AGE,
    ],
  },
  {
    apiKind: 'daemonset',
    label: 'DaemonSets',
    scope: 'namespaced',
    navGroup: 'workloads',
    icon: 'ri-loop-left-line',
    columns: [
      NAME,
      NS,
      { key: 'ready', header: 'ready', type: 'ratio' },
      { key: 'available', header: 'available', type: 'number' },
      AGE,
    ],
  },
  {
    apiKind: 'job',
    label: 'Jobs',
    scope: 'namespaced',
    navGroup: 'workloads',
    icon: 'ri-play-circle-line',
    columns: [
      NAME,
      NS,
      { key: 'completions', header: 'completions', type: 'text' },
      { key: 'status', header: 'status', type: 'badge' },
      AGE,
    ],
  },
  {
    apiKind: 'cronjob',
    label: 'CronJobs',
    scope: 'namespaced',
    navGroup: 'workloads',
    icon: 'ri-timer-line',
    columns: [
      NAME,
      NS,
      { key: 'schedule', header: 'schedule', type: 'text' },
      { key: 'suspend', header: 'suspend', type: 'badge' },
      { key: 'lastSchedule', header: 'lastSchedule', type: 'age' },
      AGE,
    ],
  },
  {
    apiKind: 'service',
    label: 'Services',
    scope: 'namespaced',
    navGroup: 'network',
    icon: 'ri-router-line',
    columns: [
      NAME,
      NS,
      { key: 'type', header: 'type', type: 'badge' },
      { key: 'clusterIP', header: 'clusterIP', type: 'text' },
      { key: 'ports', header: 'ports', type: 'text' },
      AGE,
    ],
  },
  {
    apiKind: 'ingress',
    label: 'Ingresses',
    scope: 'namespaced',
    navGroup: 'network',
    icon: 'ri-global-line',
    columns: [
      NAME,
      NS,
      { key: 'hosts', header: 'hosts', type: 'text' },
      AGE,
    ],
  },
  {
    apiKind: 'configmap',
    label: 'ConfigMaps',
    scope: 'namespaced',
    navGroup: 'config',
    icon: 'ri-file-list-2-line',
    columns: [
      NAME,
      NS,
      { key: 'keys', header: 'keys', type: 'number' },
      AGE,
    ],
  },
  {
    apiKind: 'pvc',
    label: 'PersistentVolumeClaims',
    scope: 'namespaced',
    navGroup: 'storage',
    icon: 'ri-database-line',
    columns: [
      NAME,
      NS,
      { key: 'status', header: 'status', type: 'badge' },
      { key: 'capacity', header: 'capacity', type: 'text' },
      { key: 'storageClass', header: 'storageClass', type: 'text' },
      AGE,
    ],
  },
  {
    apiKind: 'pv',
    label: 'PersistentVolumes',
    scope: 'cluster',
    navGroup: 'storage',
    icon: 'ri-hard-drive-2-line',
    columns: [
      NAME,
      { key: 'status', header: 'status', type: 'badge' },
      { key: 'capacity', header: 'capacity', type: 'text' },
      { key: 'storageClass', header: 'storageClass', type: 'text' },
      AGE,
    ],
  },
  {
    apiKind: 'event',
    label: 'Events',
    scope: 'namespaced',
    navGroup: 'events',
    icon: 'ri-notification-3-line',
    columns: [
      { key: 'type', header: 'type', type: 'badge' },
      { key: 'reason', header: 'reason', type: 'text' },
      { key: 'object', header: 'object', type: 'text' },
      { key: 'message', header: 'message', type: 'text' },
      { key: 'count', header: 'count', type: 'number' },
      { key: 'lastSeen', header: 'lastSeen', type: 'age' },
    ],
    defaultSort: { key: 'lastSeen', dir: 'desc' },
  },
]

// ── Lookup helpers ──────────────────────────────────────────────────────────

const byKind = new Map(RESOURCE_KINDS.map(k => [k.apiKind, k]))

export function kindByApiKind(apiKind: string): KindDef | undefined {
  return byKind.get(apiKind as K8sResourceKind)
}

// ── Navigation groups ───────────────────────────────────────────────────────

export const NAV_GROUPS: { group: string; kinds: K8sResourceKind[] }[] = [
  { group: 'cluster',   kinds: ['node', 'namespace'] },
  { group: 'workloads', kinds: ['deployment', 'statefulset', 'daemonset', 'job', 'cronjob', 'pod'] },
  { group: 'network',   kinds: ['service', 'ingress'] },
  { group: 'config',    kinds: ['configmap'] },
  { group: 'storage',   kinds: ['pvc', 'pv'] },
  { group: 'events',    kinds: ['event'] },
]
