import {
  CoreV1Api,
  AppsV1Api,
  BatchV1Api,
  NetworkingV1Api,
} from '@kubernetes/client-node'
import { buildKubeClient } from './client'
import { classifyK8sError } from './errors'
import { resolveWorkloadGraph } from './topologyWorkload'
import { resolveInfraVisibility } from './infraVisibility'
import { buildVmIdentityMap } from './vmIdentity'
import { correlateNodes } from './topologyCorrelate'
import type { K8sNodeIdentity, CorrelatedNode } from './topologyCorrelate'
import { getNodeMapping } from '../repository'
import type {
  K8sTopologyData,
  K8sTopologyHost,
  K8sTopologyK8sNode,
  BridgeStatus,
  K8sMatchKey,
  K8sUnmatchedReason,
} from '../topologyTypes'
import type { SanitizedCredential } from '../types'

const LIST_CAP = 500

export interface GetClusterTopologyInput {
  clusterId: string
  credentialVersion: number
  cred: SanitizedCredential
  tenantId: string
  namespace?: string | null
  proxmoxConnectionId?: string | null
}

// ---------------------------------------------------------------------------
// Bounded list helper
// ---------------------------------------------------------------------------

interface ListResult {
  items: Record<string, unknown>[]
  capped: boolean
}

async function listBounded(listFn: () => Promise<{ items: any[]; metadata?: any }>): Promise<ListResult> {
  const result = await listFn()
  const items: Record<string, unknown>[] = result.items ?? []
  const capped = !!result.metadata?._continue
  return { items, capped }
}

// ---------------------------------------------------------------------------
// K8s node mapping
// ---------------------------------------------------------------------------

function mapK8sNode(
  rawNode: any,
  corr?: { match?: CorrelatedNode['match']; hostId: string; unmatchedReason?: K8sUnmatchedReason },
): K8sTopologyK8sNode {
  const st = rawNode?.status ?? {}
  const addresses: any[] = st.addresses ?? []
  const internalIP = addresses.find((a: any) => a.type === 'InternalIP')?.address as string | undefined
  const ready = (st.conditions ?? []).some((c: any) => c.type === 'Ready' && c.status === 'True')
  const version: string = st.nodeInfo?.kubeletVersion ?? ''
  const nodeName: string = rawNode?.metadata?.name ?? ''
  const uid: string = rawNode?.metadata?.uid ?? ''
  return {
    uid,
    id: `node/${nodeName}`,
    name: nodeName,
    ready,
    version,
    ...(internalIP ? { internalIP } : {}),
    hostId: corr?.hostId ?? '',
    detailRef: { kind: 'node', name: nodeName, uid },
    ...(corr?.match
      ? { match: { key: corr.match.key, vmid: corr.match.vmid, vmName: corr.match.vmName, confidence: corr.match.confidence } }
      : {}),
    ...(corr?.unmatchedReason ? { unmatchedReason: corr.unmatchedReason } : {}),
  }
}

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

export async function getClusterTopology(
  input: GetClusterTopologyInput,
): Promise<{ ok: boolean; value?: K8sTopologyData; error?: string }> {
  const { clusterId, credentialVersion, cred, tenantId, namespace, proxmoxConnectionId } = input

  const built = buildKubeClient({
    clusterId,
    credentialVersion,
    server: cred.apiServerUrl,
    cred: { type: cred.credentialType, value: cred.credential },
    caData: cred.caDataPem,
    serverName: cred.tlsServerName,
    insecure: cred.insecureSkipTlsVerify,
  })
  if (!built.ok || !built.makeApiClient) {
    return { ok: false, error: built.error ?? 'client build failed' }
  }
  const make = built.makeApiClient

  const namespaceMode: 'single' | 'all' = namespace == null ? 'all' : 'single'
  const ns: string | undefined = namespace ?? undefined

  // Step 1: list all needed kinds concurrently.
  let pods: ListResult
  let services: ListResult
  let ingresses: ListResult
  let deployments: ListResult
  let statefulsets: ListResult
  let daemonsets: ListResult
  let jobs: ListResult
  let cronjobs: ListResult
  let replicasets: ListResult
  let configmaps: ListResult
  let nodes: ListResult

  try {
    ;[pods, services, ingresses, deployments, statefulsets, daemonsets, jobs, cronjobs, replicasets, configmaps, nodes] =
      await Promise.all([
        listBounded(() => ns
          ? make(CoreV1Api).listNamespacedPod({ namespace: ns, limit: LIST_CAP })
          : make(CoreV1Api).listPodForAllNamespaces({ limit: LIST_CAP })),
        listBounded(() => ns
          ? make(CoreV1Api).listNamespacedService({ namespace: ns, limit: LIST_CAP })
          : make(CoreV1Api).listServiceForAllNamespaces({ limit: LIST_CAP })),
        listBounded(() => ns
          ? make(NetworkingV1Api).listNamespacedIngress({ namespace: ns, limit: LIST_CAP })
          : make(NetworkingV1Api).listIngressForAllNamespaces({ limit: LIST_CAP })),
        listBounded(() => ns
          ? make(AppsV1Api).listNamespacedDeployment({ namespace: ns, limit: LIST_CAP })
          : make(AppsV1Api).listDeploymentForAllNamespaces({ limit: LIST_CAP })),
        listBounded(() => ns
          ? make(AppsV1Api).listNamespacedStatefulSet({ namespace: ns, limit: LIST_CAP })
          : make(AppsV1Api).listStatefulSetForAllNamespaces({ limit: LIST_CAP })),
        listBounded(() => ns
          ? make(AppsV1Api).listNamespacedDaemonSet({ namespace: ns, limit: LIST_CAP })
          : make(AppsV1Api).listDaemonSetForAllNamespaces({ limit: LIST_CAP })),
        listBounded(() => ns
          ? make(BatchV1Api).listNamespacedJob({ namespace: ns, limit: LIST_CAP })
          : make(BatchV1Api).listJobForAllNamespaces({ limit: LIST_CAP })),
        listBounded(() => ns
          ? make(BatchV1Api).listNamespacedCronJob({ namespace: ns, limit: LIST_CAP })
          : make(BatchV1Api).listCronJobForAllNamespaces({ limit: LIST_CAP })),
        listBounded(() => ns
          ? make(AppsV1Api).listNamespacedReplicaSet({ namespace: ns, limit: LIST_CAP })
          : make(AppsV1Api).listReplicaSetForAllNamespaces({ limit: LIST_CAP })),
        listBounded(() => ns
          ? make(CoreV1Api).listNamespacedConfigMap({ namespace: ns, limit: LIST_CAP })
          : make(CoreV1Api).listConfigMapForAllNamespaces({ limit: LIST_CAP })),
        // Nodes are cluster-scoped: always use listNode.
        listBounded(() => make(CoreV1Api).listNode({ limit: LIST_CAP })),
      ])
  } catch (err) {
    const code = classifyK8sError(err)
    return { ok: false, error: code }
  }

  const cappedKinds: Record<string, boolean> = {
    pods: pods.capped,
    services: services.capped,
    ingresses: ingresses.capped,
    deployments: deployments.capped,
    statefulsets: statefulsets.capped,
    daemonsets: daemonsets.capped,
    jobs: jobs.capped,
    cronjobs: cronjobs.capped,
    replicasets: replicasets.capped,
    configmaps: configmaps.capped,
    nodes: nodes.capped,
  }

  // Step 2: resolve workload graph (pure).
  const graph = resolveWorkloadGraph({
    namespaceMode,
    namespace: namespace ?? null,
    pods: pods.items,
    services: services.items,
    ingresses: ingresses.items,
    deployments: deployments.items,
    statefulsets: statefulsets.items,
    daemonsets: daemonsets.items,
    jobs: jobs.items,
    cronjobs: cronjobs.items,
    replicasets: replicasets.items,
    configmaps: configmaps.items,
    cappedKinds,
  })

  const truncated = Object.values(cappedKinds).some(Boolean)

  const perKind: Record<string, { listed: number; capped: boolean }> = {
    pods: { listed: pods.items.length, capped: pods.capped },
    services: { listed: services.items.length, capped: services.capped },
    ingresses: { listed: ingresses.items.length, capped: ingresses.capped },
    deployments: { listed: deployments.items.length, capped: deployments.capped },
    statefulsets: { listed: statefulsets.items.length, capped: statefulsets.capped },
    daemonsets: { listed: daemonsets.items.length, capped: daemonsets.capped },
    jobs: { listed: jobs.items.length, capped: jobs.capped },
    cronjobs: { listed: cronjobs.items.length, capped: cronjobs.capped },
    replicasets: { listed: replicasets.items.length, capped: replicasets.capped },
    configmaps: { listed: configmaps.items.length, capped: configmaps.capped },
    nodes: { listed: nodes.items.length, capped: nodes.capped },
  }

  // Step 3: bridge gate.
  let bridgeStatus: BridgeStatus
  let hosts: K8sTopologyHost[] = []
  let k8sNodes: K8sTopologyK8sNode[] = []
  let correlationMeta = {
    bridgeStatus: 'disabled_no_visibility' as BridgeStatus,
    attempted: 0,
    matched: 0,
    byKey: {} as Partial<Record<K8sMatchKey, number>>,
    unmapped: 0,
    ambiguous: 0,
    skippedOutOfScope: 0,
    vmScanCapped: false,
    configFetchFailed: 0,
  }

  const visibility = await resolveInfraVisibility(tenantId)

  if (!visibility.enabled) {
    bridgeStatus = 'disabled_no_visibility'
    correlationMeta.bridgeStatus = 'disabled_no_visibility'
  } else {
    const vmResult = await buildVmIdentityMap({ connectionFilter: visibility.connectionFilter })
    if (!vmResult.ok) {
      bridgeStatus = 'scan_failed'
      correlationMeta.bridgeStatus = 'scan_failed'
    } else {
      // Build K8sNodeIdentity[] from raw node objects.
      const nodeIdentities: K8sNodeIdentity[] = nodes.items.map((n: any) => {
        const st = n.status ?? {}
        const addresses: any[] = st.addresses ?? []
        const internalIP = addresses.find((a: any) => a.type === 'InternalIP')?.address ?? ''
        return {
          name: n.metadata?.name ?? '',
          systemUUID: st.nodeInfo?.systemUUID ?? '',
          providerID: n.spec?.providerID ?? '',
          internalIP,
        }
      })

      const mapRows = await getNodeMapping(tenantId, clusterId)
      const authoritative = new Map(mapRows.map(r => [r.nodeName, { connectionId: r.connectionId, vmid: r.vmid }]))

      const correlated: CorrelatedNode[] = correlateNodes(nodeIdentities, vmResult.vms, authoritative)

      // Build host map: one box per (connectionId, host).
      const hostMap = new Map<string, K8sTopologyHost>()

      for (const c of correlated) {
        if (c.match) {
          const key = `${c.match.connectionId}/${c.match.host}`
          if (!hostMap.has(key)) {
            hostMap.set(key, {
              id: key,
              hostName: c.match.host,
              clusterName: c.match.clusterName,
              connectionId: c.match.connectionId,
            })
          }
        }
      }

      // Add unmapped pseudo-box if any node has no match.
      const hasUnmapped = correlated.some(c => !c.match)
      if (hasUnmapped) {
        hostMap.set('unmapped', { id: 'unmapped', hostName: 'Unmapped' })
      }

      hosts = [...hostMap.values()]

      // Build k8sNode entries aligned with the node list.
      k8sNodes = correlated.map((c, idx) => mapK8sNode(nodes.items[idx], {
        match: c.match,
        hostId: c.match ? `${c.match.connectionId}/${c.match.host}` : 'unmapped',
        unmatchedReason: c.unmatchedReason,
      }))

      bridgeStatus = 'enabled'

      // Correlation stats.
      let matched = 0
      let unmapped = 0
      let ambiguous = 0
      const byKey: Partial<Record<K8sMatchKey, number>> = {}

      for (const c of correlated) {
        if (c.match) {
          matched++
          byKey[c.match.key] = (byKey[c.match.key] ?? 0) + 1
        } else {
          if (c.unmatchedReason === 'ambiguous') ambiguous++
          else unmapped++
        }
      }

      correlationMeta = {
        bridgeStatus: 'enabled',
        attempted: correlated.length,
        matched,
        byKey,
        unmapped,
        ambiguous,
        skippedOutOfScope: 0,
        vmScanCapped: vmResult.capped,
        configFetchFailed: vmResult.configFetchFailed,
      }
    }
  }

  // Ensure the Nodes view always has data: when there was no Proxmox
  // correlation (visibility disabled, scan failed, or an external cluster),
  // emit bare node entries from the raw node list.
  if (k8sNodes.length === 0) {
    k8sNodes = (nodes.items ?? []).map((n: any) => mapK8sNode(n))
  }

  // A cluster is External to Proxmox when it is not linked to a Proxmox
  // connection. This is the authoritative signal (not correlation success).
  const external = !proxmoxConnectionId

  const data: K8sTopologyData = {
    namespaceMode,
    namespace: namespace ?? null,
    groups: graph.groups,
    resources: graph.resources,
    edges: graph.edges,
    infra: {
      bridgeStatus,
      external,
      hosts,
      k8sNodes,
    },
    meta: {
      truncated,
      perKind,
      correlation: correlationMeta,
    },
  }

  return { ok: true, value: data }
}
