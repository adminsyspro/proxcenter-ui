import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { renderWithProviders, screen, fireEvent } from '@/__tests__/setup/renderWithProviders'
import { K8sTopologyView } from './K8sTopologyView'
import type { K8sTopologyData } from '@/lib/k8s/topologyTypes'

// The app-graph branch mounts K8sTopologyCanvas, which imports ReactFlow's
// stylesheet. jsdom/vitest has no need to load real CSS for these assertions.
vi.mock('@xyflow/react/dist/style.css', () => ({}))

afterEach(cleanup)

const SMALL_DTO: K8sTopologyData = {
  namespaceMode: 'all',
  namespace: null,
  groups: [{ key: 'ns1/web', label: 'web', namespace: 'ns1', count: 1 }],
  resources: [
    { id: 'd1', uid: 'd1', kind: 'deployment', name: 'web', groupKey: 'ns1/web', healthy: true, nodePlacement: ['n1'] },
  ],
  edges: [],
  infra: {
    bridgeStatus: 'enabled',
    external: true,
    hosts: [],
    k8sNodes: [
      { uid: 'n1', id: 'node/n1', name: 'n1', ready: true, version: 'v1.30', hostId: '', detailRef: { kind: 'node', name: 'n1' } },
    ],
  },
  meta: {
    truncated: false,
    perKind: {},
    correlation: {
      bridgeStatus: 'enabled',
      attempted: 1,
      matched: 0,
      byKey: {},
      unmapped: 1,
      ambiguous: 0,
      skippedOutOfScope: 0,
      vmScanCapped: false,
      configFetchFailed: 0,
    },
  },
}

function stubFetchOnce(body: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })))
}

describe('K8sTopologyView', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('navigates grid -> app graph -> back', async () => {
    stubFetchOnce(SMALL_DTO)
    renderWithProviders(<K8sTopologyView clusterId="c1" namespace="all" refreshTick={0} />)

    expect(await screen.findByText('web')).toBeInTheDocument()

    fireEvent.click(screen.getByText('web'))

    expect(await screen.findByText('Back to apps')).toBeInTheDocument()
  })

  it('switching to the Nodes tab shows the node', async () => {
    stubFetchOnce(SMALL_DTO)
    renderWithProviders(<K8sTopologyView clusterId="c1" namespace="all" refreshTick={0} />)

    expect(await screen.findByText('web')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Nodes' }))

    expect(await screen.findByText('n1')).toBeInTheDocument()
  })
})
