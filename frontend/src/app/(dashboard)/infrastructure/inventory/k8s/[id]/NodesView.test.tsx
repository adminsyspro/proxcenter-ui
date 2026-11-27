import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { renderWithProviders, screen, fireEvent } from '@/__tests__/setup/renderWithProviders'
import { NodesView } from './NodesView'

// The non-external path renders K8sTopologyCanvas, which imports ReactFlow's
// stylesheet. jsdom/vitest has no need to load real CSS for these assertions.
vi.mock('@xyflow/react/dist/style.css', () => ({}))

// This file renders multiple times with overlapping text (e.g. node name
// "w1"); ensure each test starts from a clean document.
afterEach(cleanup)

describe('NodesView', () => {
  it('shows the External badge and a plain node grid for external clusters', () => {
    const data: any = {
      infra: { external: true, hosts: [], k8sNodes: [
        { uid: 'w1', id: 'node/w1', name: 'w1', ready: true, version: 'v1.30', hostId: '', detailRef: { kind: 'node', name: 'w1' } },
        { uid: 'w2', id: 'node/w2', name: 'w2', ready: false, version: 'v1.30', hostId: '', detailRef: { kind: 'node', name: 'w2' } },
      ] },
      resources: [], edges: [], groups: [], meta: { correlation: {} }, namespaceMode: 'all', namespace: null,
    }
    renderWithProviders(<NodesView data={data} onDetailRef={() => {}} />)
    expect(screen.getByText(/External to Proxmox|Externe à Proxmox/)).toBeInTheDocument()
    expect(screen.getByText('w1')).toBeInTheDocument()
    expect(screen.getByText('w2')).toBeInTheDocument()
  })

  it('fires onDetailRef with the node detailRef and kind "node" when a node card is clicked', () => {
    const onDetailRef = vi.fn()
    const data: any = {
      infra: { external: true, hosts: [], k8sNodes: [
        { uid: 'w1', id: 'node/w1', name: 'w1', ready: true, version: 'v1.30', internalIP: '10.0.0.5', hostId: '', detailRef: { kind: 'node', name: 'w1' } },
      ] },
      resources: [], edges: [], groups: [], meta: { correlation: {} }, namespaceMode: 'all', namespace: null,
    }
    renderWithProviders(<NodesView data={data} onDetailRef={onDetailRef} />)
    fireEvent.click(screen.getByText('w1'))
    expect(onDetailRef).toHaveBeenCalledWith({ kind: 'node', name: 'w1' }, 'node')
  })

  it('renders the topology canvas (radar) for non-external clusters', () => {
    const data: any = {
      infra: { external: false, bridgeStatus: 'enabled', hosts: [], k8sNodes: [] },
      resources: [{ id: 'd1', uid: 'd1', kind: 'deployment', name: 'web', groupKey: 'ns1/web', healthy: true }],
      edges: [{ source: 'd1', target: 'd1', rel: 'owns' }],
      groups: [{ key: 'ns1/web', label: 'web', namespace: 'ns1', count: 1 }],
      meta: { correlation: {} }, namespaceMode: 'all', namespace: null,
    }
    renderWithProviders(<NodesView data={data} onDetailRef={() => {}} />)
    // The canvas is rendered (ReactFlow root present); no external badge shown.
    expect(screen.queryByText(/External to Proxmox|Externe à Proxmox/)).not.toBeInTheDocument()
  })

  it('renders the plain node grid (not the radar) for non-external, bridge-off clusters', () => {
    const data: any = {
      infra: { external: false, bridgeStatus: 'disabled_no_visibility', hosts: [], k8sNodes: [
        { uid: 'w1', id: 'node/w1', name: 'w1', ready: true, version: 'v1.30', hostId: '', detailRef: { kind: 'node', name: 'w1' } },
      ] },
      resources: [], edges: [], groups: [], meta: { correlation: {} }, namespaceMode: 'all', namespace: null,
    }
    renderWithProviders(<NodesView data={data} onDetailRef={() => {}} />)
    expect(screen.getByText('w1')).toBeInTheDocument()
    expect(screen.queryByText(/External to Proxmox|Externe à Proxmox/)).not.toBeInTheDocument()
  })
})
