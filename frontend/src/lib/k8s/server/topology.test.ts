import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SanitizedCredential } from '@/lib/k8s/types'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const buildKubeClientMock = vi.fn()
const resolveWorkloadGraphMock = vi.fn()
const resolveInfraVisibilityMock = vi.fn()
const buildVmIdentityMapMock = vi.fn()
const correlateNodesMock = vi.fn()
const getNodeMappingMock = vi.fn()

vi.mock('@/lib/k8s/server/client', () => ({
  buildKubeClient: (...a: any[]) => buildKubeClientMock(...a),
}))
vi.mock('@/lib/k8s/server/topologyWorkload', () => ({
  resolveWorkloadGraph: (...a: any[]) => resolveWorkloadGraphMock(...a),
}))
vi.mock('@/lib/k8s/server/infraVisibility', () => ({
  resolveInfraVisibility: (...a: any[]) => resolveInfraVisibilityMock(...a),
}))
vi.mock('@/lib/k8s/server/vmIdentity', () => ({
  buildVmIdentityMap: (...a: any[]) => buildVmIdentityMapMock(...a),
}))
vi.mock('@/lib/k8s/server/topologyCorrelate', () => ({
  correlateNodes: (...a: any[]) => correlateNodesMock(...a),
}))
vi.mock('@/lib/k8s/repository', () => ({
  getNodeMapping: (...a: any[]) => getNodeMappingMock(...a),
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const fakeCred: SanitizedCredential = {
  apiServerUrl: 'https://kube.local:6443',
  insecureSkipTlsVerify: false,
  credentialType: 'token',
  credential: 'tok',
  contextName: 'default',
}

const emptyList = { items: [], metadata: {} }

function makeListFn(items: any[] = [], continueToken?: string) {
  return vi.fn().mockResolvedValue({
    items,
    metadata: continueToken ? { _continue: continueToken } : {},
  })
}

const defaultWorkloadGraph = { groups: [], resources: [], edges: [] }

// Per-kind list mocks, keyed by method name.
function makeMakeApiClient(overrides: Record<string, ReturnType<typeof makeListFn>> = {}) {
  const listNamespacedPod = overrides.listNamespacedPod ?? makeListFn()
  const listPodForAllNamespaces = overrides.listPodForAllNamespaces ?? makeListFn()
  const listNamespacedService = overrides.listNamespacedService ?? makeListFn()
  const listServiceForAllNamespaces = overrides.listServiceForAllNamespaces ?? makeListFn()
  const listNamespacedIngress = overrides.listNamespacedIngress ?? makeListFn()
  const listIngressForAllNamespaces = overrides.listIngressForAllNamespaces ?? makeListFn()
  const listNamespacedDeployment = overrides.listNamespacedDeployment ?? makeListFn()
  const listDeploymentForAllNamespaces = overrides.listDeploymentForAllNamespaces ?? makeListFn()
  const listNamespacedStatefulSet = overrides.listNamespacedStatefulSet ?? makeListFn()
  const listStatefulSetForAllNamespaces = overrides.listStatefulSetForAllNamespaces ?? makeListFn()
  const listNamespacedDaemonSet = overrides.listNamespacedDaemonSet ?? makeListFn()
  const listDaemonSetForAllNamespaces = overrides.listDaemonSetForAllNamespaces ?? makeListFn()
  const listNamespacedJob = overrides.listNamespacedJob ?? makeListFn()
  const listJobForAllNamespaces = overrides.listJobForAllNamespaces ?? makeListFn()
  const listNamespacedCronJob = overrides.listNamespacedCronJob ?? makeListFn()
  const listCronJobForAllNamespaces = overrides.listCronJobForAllNamespaces ?? makeListFn()
  const listNamespacedReplicaSet = overrides.listNamespacedReplicaSet ?? makeListFn()
  const listReplicaSetForAllNamespaces = overrides.listReplicaSetForAllNamespaces ?? makeListFn()
  const listNamespacedConfigMap = overrides.listNamespacedConfigMap ?? makeListFn()
  const listConfigMapForAllNamespaces = overrides.listConfigMapForAllNamespaces ?? makeListFn()
  const listNode = overrides.listNode ?? makeListFn()

  return vi.fn().mockImplementation((ApiClass: any) => {
    const name: string = ApiClass?.name ?? ''
    if (name === 'CoreV1Api' || name === 'ObjectCoreV1Api') {
      return {
        listNamespacedPod,
        listPodForAllNamespaces,
        listNamespacedService,
        listServiceForAllNamespaces,
        listNamespacedConfigMap,
        listConfigMapForAllNamespaces,
        listNode,
      }
    }
    if (name === 'AppsV1Api' || name === 'ObjectAppsV1Api') {
      return {
        listNamespacedDeployment,
        listDeploymentForAllNamespaces,
        listNamespacedStatefulSet,
        listStatefulSetForAllNamespaces,
        listNamespacedDaemonSet,
        listDaemonSetForAllNamespaces,
        listNamespacedReplicaSet,
        listReplicaSetForAllNamespaces,
      }
    }
    if (name === 'BatchV1Api' || name === 'ObjectBatchV1Api') {
      return {
        listNamespacedJob,
        listJobForAllNamespaces,
        listNamespacedCronJob,
        listCronJobForAllNamespaces,
      }
    }
    if (name === 'NetworkingV1Api' || name === 'ObjectNetworkingV1Api') {
      return {
        listNamespacedIngress,
        listIngressForAllNamespaces,
      }
    }
    return {}
  })
}

function inputWithNodes(opts: {
  visibility: 'enabled' | 'disabled'
  matched?: boolean
  proxmoxConnectionId?: string | null
}) {
  const rawNodes = [
    {
      metadata: { name: 'node-1', uid: 'uid-node-1' },
      spec: { providerID: 'proxmox://pve/107' },
      status: {
        nodeInfo: { systemUUID: 'aaaabbbb-1111-2222-3333-ccccddddeeee', kubeletVersion: 'v1.30.0' },
        addresses: [{ type: 'InternalIP', address: '10.0.0.10' }],
        conditions: [{ type: 'Ready', status: 'True' }],
      },
    },
    {
      metadata: { name: 'node-2', uid: 'uid-node-2' },
      spec: {},
      status: {
        nodeInfo: { kubeletVersion: 'v1.30.0' },
        addresses: [{ type: 'InternalIP', address: '10.0.0.11' }],
        conditions: [{ type: 'Ready', status: 'True' }],
      },
    },
  ]

  const makeApiClient = makeMakeApiClient({ listNode: makeListFn(rawNodes) })

  if (opts.visibility === 'disabled') {
    resolveInfraVisibilityMock.mockResolvedValue({ enabled: false, connectionFilter: null })
  } else {
    resolveInfraVisibilityMock.mockResolvedValue({ enabled: true, connectionFilter: null })
    buildVmIdentityMapMock.mockResolvedValue({
      ok: true,
      vms: opts.matched
        ? [{ vmid: 107, name: 'vm-k8s', host: 'pve1', connectionId: 'conn-1', clusterName: 'mypve', uuid: null, ips: [] }]
        : [],
      capped: false,
      configFetchFailed: 0,
    })
    correlateNodesMock.mockReturnValue(opts.matched
      ? [
          { name: 'node-1', match: { key: 'providerID', vmid: 107, vmName: 'vm-k8s', host: 'pve1', connectionId: 'conn-1', clusterName: 'mypve', confidence: 'high' } },
          { name: 'node-2', unmatchedReason: 'none' },
        ]
      : [
          { name: 'node-1', unmatchedReason: 'none' },
          { name: 'node-2', unmatchedReason: 'none' },
        ])
  }

  return {
    clusterId: 'c1',
    credentialVersion: 1,
    cred: fakeCred,
    tenantId: 't1',
    proxmoxConnectionId: opts.proxmoxConnectionId ?? null,
    __makeApiClient: makeApiClient,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('getClusterTopology', () => {
  beforeEach(() => {
    buildKubeClientMock.mockReset()
    resolveWorkloadGraphMock.mockReset().mockReturnValue(defaultWorkloadGraph)
    resolveInfraVisibilityMock.mockReset().mockResolvedValue({ enabled: false, connectionFilter: null })
    buildVmIdentityMapMock.mockReset()
    correlateNodesMock.mockReset()
    getNodeMappingMock.mockReset().mockResolvedValue([])
  })

  it('returns ok:false when client build fails', async () => {
    buildKubeClientMock.mockReturnValue({ ok: false, error: 'bad server URL' })
    const { getClusterTopology } = await import('./topology')
    const result = await getClusterTopology({ clusterId: 'c1', credentialVersion: 1, cred: fakeCred, tenantId: 't1' })
    expect(result.ok).toBe(false)
    expect(result.error).toBe('bad server URL')
  })

  it('lists all expected kinds via makeApiClient and assembles workload graph', async () => {
    const makeApiClient = makeMakeApiClient()
    buildKubeClientMock.mockReturnValue({ ok: true, makeApiClient })
    const { getClusterTopology } = await import('./topology')

    const result = await getClusterTopology({
      clusterId: 'c1', credentialVersion: 1, cred: fakeCred, tenantId: 't1', namespace: 'default',
    })

    expect(result.ok).toBe(true)
    // workload graph was assembled
    expect(resolveWorkloadGraphMock).toHaveBeenCalledOnce()
    const wgInput = resolveWorkloadGraphMock.mock.calls[0][0]
    expect(wgInput.namespaceMode).toBe('single')
    expect(wgInput.namespace).toBe('default')
    // All 10 workload kinds passed (empty arrays).
    expect(Array.isArray(wgInput.pods)).toBe(true)
    expect(Array.isArray(wgInput.configmaps)).toBe(true)
    // Nodes are NOT part of WorkloadInput (they go to correlateNodes separately).
    expect(wgInput.nodes).toBeUndefined()
  })

  it('namespace=null produces namespaceMode=all and calls all-namespaces list methods', async () => {
    const makeApiClient = makeMakeApiClient()
    buildKubeClientMock.mockReturnValue({ ok: true, makeApiClient })
    const { getClusterTopology } = await import('./topology')

    const result = await getClusterTopology({
      clusterId: 'c1', credentialVersion: 1, cred: fakeCred, tenantId: 't1', namespace: null,
    })

    expect(result.ok).toBe(true)
    expect(result.value?.namespaceMode).toBe('all')
    expect(result.value?.namespace).toBeNull()
    const wgInput = resolveWorkloadGraphMock.mock.calls[0][0]
    expect(wgInput.namespaceMode).toBe('all')
  })

  it('bridge disabled: empty infra and bridgeStatus=disabled_no_visibility', async () => {
    const makeApiClient = makeMakeApiClient()
    buildKubeClientMock.mockReturnValue({ ok: true, makeApiClient })
    resolveInfraVisibilityMock.mockResolvedValue({ enabled: false, connectionFilter: new Set() })
    const { getClusterTopology } = await import('./topology')

    const result = await getClusterTopology({
      clusterId: 'c1', credentialVersion: 1, cred: fakeCred, tenantId: 't1',
    })

    expect(result.ok).toBe(true)
    expect(result.value?.infra.bridgeStatus).toBe('disabled_no_visibility')
    expect(result.value?.infra.hosts).toHaveLength(0)
    expect(result.value?.infra.k8sNodes).toHaveLength(0)
    expect(buildVmIdentityMapMock).not.toHaveBeenCalled()
    expect(correlateNodesMock).not.toHaveBeenCalled()
  })

  it('bridge enabled: infra populated with matched hosts and bridgeStatus=enabled', async () => {
    const rawNode = {
      metadata: { name: 'node-1', uid: 'uid-node-1' },
      spec: { providerID: 'proxmox://pve/107' },
      status: {
        nodeInfo: { systemUUID: 'aaaabbbb-1111-2222-3333-ccccddddeeee', kubeletVersion: 'v1.30.0' },
        addresses: [{ type: 'InternalIP', address: '10.0.0.10' }],
        conditions: [{ type: 'Ready', status: 'True' }],
      },
    }
    const makeApiClient = makeMakeApiClient({
      listNode: makeListFn([rawNode]),
    })
    buildKubeClientMock.mockReturnValue({ ok: true, makeApiClient })
    resolveInfraVisibilityMock.mockResolvedValue({ enabled: true, connectionFilter: null })
    buildVmIdentityMapMock.mockResolvedValue({
      ok: true,
      vms: [{ vmid: 107, name: 'vm-k8s', host: 'pve1', connectionId: 'conn-1', clusterName: 'mypve', uuid: null, ips: [] }],
      capped: false,
      configFetchFailed: 0,
    })
    correlateNodesMock.mockReturnValue([
      {
        name: 'node-1',
        match: { key: 'providerID', vmid: 107, vmName: 'vm-k8s', host: 'pve1', connectionId: 'conn-1', clusterName: 'mypve', confidence: 'high' },
      },
    ])

    const { getClusterTopology } = await import('./topology')
    const result = await getClusterTopology({
      clusterId: 'c1', credentialVersion: 1, cred: fakeCred, tenantId: 't1',
    })

    expect(result.ok).toBe(true)
    expect(result.value?.infra.bridgeStatus).toBe('enabled')
    expect(result.value?.infra.hosts).toHaveLength(1)
    expect(result.value?.infra.hosts[0].hostName).toBe('pve1')
    expect(result.value?.infra.hosts[0].connectionId).toBe('conn-1')
    expect(result.value?.infra.k8sNodes).toHaveLength(1)
    const k8sNode = result.value?.infra.k8sNodes[0]
    expect(k8sNode?.name).toBe('node-1')
    expect(k8sNode?.ready).toBe(true)
    expect(k8sNode?.version).toBe('v1.30.0')
    expect(k8sNode?.internalIP).toBe('10.0.0.10')
    expect(k8sNode?.match?.key).toBe('providerID')
    expect(k8sNode?.hostId).toBe('conn-1/pve1')
    expect(result.value?.meta.correlation.bridgeStatus).toBe('enabled')
    expect(result.value?.meta.correlation.matched).toBe(1)
  })

  it('loads the persisted node mapping and passes it as the authoritative 3rd arg to correlateNodes', async () => {
    const makeApiClient = makeMakeApiClient()
    buildKubeClientMock.mockReturnValue({ ok: true, makeApiClient })
    resolveInfraVisibilityMock.mockResolvedValue({ enabled: true, connectionFilter: null })
    buildVmIdentityMapMock.mockResolvedValue({ ok: true, vms: [], capped: false, configFetchFailed: 0 })
    correlateNodesMock.mockReturnValue([])
    getNodeMappingMock.mockResolvedValue([
      { nodeName: 'node-1', connectionId: 'conn-1', vmid: 101 },
      { nodeName: 'node-2', connectionId: 'conn-1', vmid: 102 },
    ])

    const { getClusterTopology } = await import('./topology')
    await getClusterTopology({ clusterId: 'c1', credentialVersion: 1, cred: fakeCred, tenantId: 't1' })

    expect(getNodeMappingMock).toHaveBeenCalledWith('t1', 'c1')
    expect(correlateNodesMock).toHaveBeenCalledTimes(1)
    const authoritative = correlateNodesMock.mock.calls[0][2]
    expect(authoritative).toBeInstanceOf(Map)
    expect(authoritative.get('node-1')).toEqual({ connectionId: 'conn-1', vmid: 101 })
    expect(authoritative.get('node-2')).toEqual({ connectionId: 'conn-1', vmid: 102 })
  })

  it('passes an empty authoritative map when there is no persisted node mapping (e.g. imported clusters)', async () => {
    const makeApiClient = makeMakeApiClient()
    buildKubeClientMock.mockReturnValue({ ok: true, makeApiClient })
    resolveInfraVisibilityMock.mockResolvedValue({ enabled: true, connectionFilter: null })
    buildVmIdentityMapMock.mockResolvedValue({ ok: true, vms: [], capped: false, configFetchFailed: 0 })
    correlateNodesMock.mockReturnValue([])
    getNodeMappingMock.mockResolvedValue([])

    const { getClusterTopology } = await import('./topology')
    await getClusterTopology({ clusterId: 'c1', credentialVersion: 1, cred: fakeCred, tenantId: 't1' })

    const authoritative = correlateNodesMock.mock.calls[0][2]
    expect(authoritative).toBeInstanceOf(Map)
    expect(authoritative.size).toBe(0)
  })

  it('bridge enabled but vm scan fails: bridgeStatus=scan_failed, empty infra', async () => {
    const makeApiClient = makeMakeApiClient()
    buildKubeClientMock.mockReturnValue({ ok: true, makeApiClient })
    resolveInfraVisibilityMock.mockResolvedValue({ enabled: true, connectionFilter: null })
    buildVmIdentityMapMock.mockResolvedValue({ ok: false, vms: [], capped: false, configFetchFailed: 0 })

    const { getClusterTopology } = await import('./topology')
    const result = await getClusterTopology({
      clusterId: 'c1', credentialVersion: 1, cred: fakeCred, tenantId: 't1',
    })

    expect(result.ok).toBe(true)
    expect(result.value?.infra.bridgeStatus).toBe('scan_failed')
    expect(result.value?.infra.hosts).toHaveLength(0)
    expect(result.value?.infra.k8sNodes).toHaveLength(0)
  })

  it('unmarched nodes produce unmapped host box', async () => {
    const rawNode = {
      metadata: { name: 'bare-node', uid: 'uid-bare' },
      spec: {},
      status: {
        nodeInfo: { kubeletVersion: 'v1.29.0' },
        addresses: [],
        conditions: [],
      },
    }
    const makeApiClient = makeMakeApiClient({ listNode: makeListFn([rawNode]) })
    buildKubeClientMock.mockReturnValue({ ok: true, makeApiClient })
    resolveInfraVisibilityMock.mockResolvedValue({ enabled: true, connectionFilter: null })
    buildVmIdentityMapMock.mockResolvedValue({ ok: true, vms: [], capped: false, configFetchFailed: 0 })
    correlateNodesMock.mockReturnValue([{ name: 'bare-node', unmatchedReason: 'none' }])

    const { getClusterTopology } = await import('./topology')
    const result = await getClusterTopology({
      clusterId: 'c1', credentialVersion: 1, cred: fakeCred, tenantId: 't1',
    })

    expect(result.ok).toBe(true)
    expect(result.value?.infra.hosts).toHaveLength(1)
    expect(result.value?.infra.hosts[0].id).toBe('unmapped')
    const k8sNode = result.value?.infra.k8sNodes[0]
    expect(k8sNode?.hostId).toBe('unmapped')
    expect(k8sNode?.unmatchedReason).toBe('none')
    expect(result.value?.meta.correlation.unmapped).toBe(1)
  })

  it('capped kind sets truncated=true and perKind.capped=true', async () => {
    const makeApiClient = makeMakeApiClient({
      listPodForAllNamespaces: makeListFn([{ metadata: { name: 'p', namespace: 'default', uid: 'u' } }], 'tok'),
    })
    buildKubeClientMock.mockReturnValue({ ok: true, makeApiClient })
    const { getClusterTopology } = await import('./topology')

    const result = await getClusterTopology({
      clusterId: 'c1', credentialVersion: 1, cred: fakeCred, tenantId: 't1', namespace: null,
    })

    expect(result.ok).toBe(true)
    expect(result.value?.meta.truncated).toBe(true)
    expect(result.value?.meta.perKind.pods.capped).toBe(true)
    expect(result.value?.meta.perKind.services.capped).toBe(false)
  })

  it('emits bare k8s nodes when Proxmox visibility is disabled', async () => {
    const input = inputWithNodes({ visibility: 'disabled', proxmoxConnectionId: null })
    buildKubeClientMock.mockReturnValue({ ok: true, makeApiClient: input.__makeApiClient })
    const { getClusterTopology } = await import('./topology')

    const res = await getClusterTopology(input)

    expect(res.ok).toBe(true)
    expect(res.value!.infra.k8sNodes).toHaveLength(2)
    expect(res.value!.infra.k8sNodes.every(n => n.match === undefined)).toBe(true)
    expect(res.value!.infra.hosts).toHaveLength(0)
    expect(res.value!.infra.external).toBe(true)
  })

  it('marks external=false when the cluster has a proxmoxConnectionId', async () => {
    const input = inputWithNodes({ visibility: 'disabled', proxmoxConnectionId: 'conn-1' })
    buildKubeClientMock.mockReturnValue({ ok: true, makeApiClient: input.__makeApiClient })
    const { getClusterTopology } = await import('./topology')

    const res = await getClusterTopology(input)

    expect(res.value!.infra.external).toBe(false)
    expect(res.value!.infra.k8sNodes).toHaveLength(2) // still emitted
  })

  it('keeps correlated nodes + hosts when bridge enabled and matched', async () => {
    const input = inputWithNodes({ visibility: 'enabled', matched: true, proxmoxConnectionId: 'conn-1' })
    buildKubeClientMock.mockReturnValue({ ok: true, makeApiClient: input.__makeApiClient })
    const { getClusterTopology } = await import('./topology')

    const res = await getClusterTopology(input)

    expect(res.value!.infra.hosts.length).toBeGreaterThan(0)
    expect(res.value!.infra.external).toBe(false)
  })

  it('passes tenantId to resolveInfraVisibility', async () => {
    const makeApiClient = makeMakeApiClient()
    buildKubeClientMock.mockReturnValue({ ok: true, makeApiClient })
    resolveInfraVisibilityMock.mockResolvedValue({ enabled: false, connectionFilter: null })

    const { getClusterTopology } = await import('./topology')
    await getClusterTopology({
      clusterId: 'c1', credentialVersion: 1, cred: fakeCred, tenantId: 'my-tenant',
    })

    expect(resolveInfraVisibilityMock).toHaveBeenCalledWith('my-tenant')
  })

  it('passes cred fields to buildKubeClient correctly', async () => {
    buildKubeClientMock.mockReturnValue({ ok: false, error: 'test' })
    const cred: SanitizedCredential = {
      apiServerUrl: 'https://kube.test:6443',
      caDataPem: '-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----',
      tlsServerName: 'kube.test',
      insecureSkipTlsVerify: false,
      credentialType: 'client_cert',
      credential: '-----BEGIN CERTIFICATE-----...',
      contextName: 'ctx',
    }

    const { getClusterTopology } = await import('./topology')
    await getClusterTopology({ clusterId: 'c1', credentialVersion: 5, cred, tenantId: 't1' })

    expect(buildKubeClientMock).toHaveBeenCalledWith(expect.objectContaining({
      clusterId: 'c1',
      credentialVersion: 5,
      server: 'https://kube.test:6443',
      cred: { type: 'client_cert', value: '-----BEGIN CERTIFICATE-----...' },
      caData: cred.caDataPem,
      serverName: 'kube.test',
      insecure: false,
    }))
  })
})
