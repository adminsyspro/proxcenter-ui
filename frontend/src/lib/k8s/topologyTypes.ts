import type { K8sUnmatchedReason, K8sMatchKey } from './server/topologyCorrelate'

export type { K8sUnmatchedReason, K8sMatchKey }

export type BridgeStatus = 'enabled' | 'disabled_no_visibility' | 'scan_failed'

export interface DetailRef {
  kind: string
  namespace?: string
  name: string
  uid?: string
}

export type K8sResourceKind =
  | 'ingress'
  | 'service'
  | 'deployment'
  | 'statefulset'
  | 'daemonset'
  | 'job'
  | 'cronjob'
  | 'replicaset'
  | 'configmap'
  | 'podGroup'
  | 'pod'

export type K8sEdgeRel = 'owns' | 'selects' | 'routes' | 'configures'

export interface K8sTopologyGroup {
  key: string
  label: string
  namespace?: string
  count: number
  shared?: boolean
}

export interface K8sTopologyResource {
  id: string
  uid: string
  kind: K8sResourceKind
  name: string
  namespace?: string
  groupKey: string
  subline?: string
  healthy: boolean
  reason?: string
  incomplete?: boolean
  synthetic?: boolean
  detailRef?: DetailRef
  podCount?: number
  healthyCount?: number
  completed?: number
  failed?: number
  active?: number
  nodePlacement?: string[]
}

export interface K8sTopologyEdge {
  source: string
  target: string
  rel: K8sEdgeRel
  crossGroup?: boolean
}

export interface K8sTopologyHost {
  id: string
  hostName: string
  clusterName?: string
  connectionId?: string
}

export interface K8sTopologyK8sNode {
  uid: string
  id: string
  name: string
  ready: boolean
  version: string
  internalIP?: string
  hostId: string
  detailRef: DetailRef
  match?: {
    key: K8sMatchKey
    vmid?: number
    vmName?: string
    confidence: 'high' | 'medium' | 'low'
  }
  unmatchedReason?: K8sUnmatchedReason
}

export interface K8sTopologyData {
  namespaceMode: 'single' | 'all'
  namespace: string | null
  groups: K8sTopologyGroup[]
  resources: K8sTopologyResource[]
  edges: K8sTopologyEdge[]
  infra: {
    bridgeStatus: BridgeStatus
    external: boolean
    hosts: K8sTopologyHost[]
    k8sNodes: K8sTopologyK8sNode[]
  }
  meta: {
    truncated: boolean
    perKind: Record<string, { listed: number; capped: boolean }>
    correlation: {
      bridgeStatus: BridgeStatus
      attempted: number
      matched: number
      byKey: Partial<Record<K8sMatchKey, number>>
      unmapped: number
      ambiguous: number
      skippedOutOfScope: number
      vmScanCapped: boolean
      configFetchFailed: number
    }
  }
}
