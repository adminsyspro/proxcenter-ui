import { describe, it, expect, vi } from 'vitest'
import { renderWithProviders, screen, fireEvent } from '@/__tests__/setup/renderWithProviders'
import { AppGrid } from './AppGrid'
import type { K8sTopologyData } from '@/lib/k8s/topologyTypes'

const data = {
  namespaceMode: 'all',
  namespace: null,
  groups: [{ key: 'ns1/web', label: 'web', namespace: 'ns1', count: 1 }],
  resources: [{ id: 'd1', uid: 'd1', kind: 'deployment', name: 'web', groupKey: 'ns1/web', healthy: true }],
  edges: [],
  infra: { bridgeStatus: 'enabled', external: false, hosts: [], k8sNodes: [] },
  meta: { truncated: false, perKind: {}, correlation: {} },
} as unknown as K8sTopologyData

describe('AppGrid', () => {
  it('renders a tile per app and fires onOpen on click', () => {
    const onOpen = vi.fn()
    renderWithProviders(<AppGrid data={data} onOpen={onOpen} />)
    fireEvent.click(screen.getByText('web'))
    expect(onOpen).toHaveBeenCalledWith('ns1/web')
  })

  it('renders the empty state when there are no applications', () => {
    const emptyData = { ...data, groups: [], resources: [] } as unknown as K8sTopologyData
    const onOpen = vi.fn()
    renderWithProviders(<AppGrid data={emptyData} onOpen={onOpen} />)
    expect(screen.getByText('No applications')).toBeInTheDocument()
  })
})
