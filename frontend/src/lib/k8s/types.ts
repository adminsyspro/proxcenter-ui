export type K8sCredentialKind = 'token' | 'client_cert'

// ── Slice 2a: K8s read-only explorer types ─────────────────────────────────

export type K8sResourceKind =
  | 'node' | 'namespace' | 'pod' | 'deployment' | 'statefulset' | 'daemonset'
  | 'job' | 'cronjob' | 'service' | 'ingress' | 'configmap' | 'pvc' | 'pv' | 'event'

export interface ResourceRef { kind: string; namespace?: string; name: string; uid: string }

export interface ResourceListItem {
  kind: string
  namespace?: string
  name: string
  uid: string
  createdAt: string
  summary: Record<string, string>
}

export interface OwnerRef { kind: string; name: string }

export interface ContainerInfo {
  name: string
  image: string
  ready: boolean
  restartCount: number
  state: string
}

export interface DetailRow { label: string; value: string }
export interface DetailTable { columns: string[]; rows: string[][]; truncated?: boolean }
export interface DetailSection { title: string; rows?: DetailRow[]; table?: DetailTable }

export interface ResourceDetail {
  ref: ResourceRef
  createdAt: string
  labels: Record<string, string>
  annotations: Record<string, string>
  summary: Record<string, string>
  owners?: OwnerRef[]
  containers?: ContainerInfo[]
  sections?: DetailSection[]
  yaml: string
}

export interface EventItem {
  type: string
  reason: string
  message: string
  object: string
  count: number
  firstSeen: string
  lastSeen: string
}

export type K8sErrorCode = 'forbidden' | 'not_found' | 'conflict' | 'auth_failed' | 'unreachable' | 'config' | 'metrics_unavailable'

export interface ListResourcesResult { items: ResourceListItem[]; truncated: boolean; errorCode?: K8sErrorCode; errorMessage?: string }
export interface GetResourceResult { detail: ResourceDetail | null; errorCode?: K8sErrorCode; errorMessage?: string }
export interface EventsResult { items: EventItem[]; errorCode?: K8sErrorCode; errorMessage?: string }
export interface PodLogsResult { container: string; logs: string; truncated: boolean; errorCode?: K8sErrorCode; errorMessage?: string }

export interface SanitizedCredential {
  apiServerUrl: string
  caDataPem?: string
  tlsServerName?: string
  insecureSkipTlsVerify: boolean
  credentialType: K8sCredentialKind
  credential: string // token, or `${clientCertPem}\n${clientKeyPem}`
  contextName: string
}

export interface ClusterHealth {
  state: 'healthy' | 'degraded' | 'unreachable' | 'auth_failed' | 'stale' | 'unknown'
  version?: string
  nodesReady?: number
  nodesTotal?: number
  errorCode?: string
  errorMessage?: string
}

// ── Phase 2: node resource utilisation ─────────────────────────────────────

export interface NodeUtilization {
  name: string
  cpuUsedMilli: number
  cpuAllocMilli: number
  memUsedBytes: number
  memAllocBytes: number
}

export interface NodeMetricsResult {
  nodes: NodeUtilization[]
  totalNodes: number
  reportingNodes: number
  sampleTime?: string
  errorCode?: string
  errorMessage?: string
}

// Per-pod CPU/RAM usage expressed as a percentage of the pod's node capacity
// (allocatable). Used for the Pods table progress columns.
export interface PodUtilization {
  namespace: string
  name: string
  cpuPct: number
  memPct: number
}

export interface PodMetricsResult {
  pods: PodUtilization[]
  sampleTime?: string
  errorCode?: string
  errorMessage?: string
}
