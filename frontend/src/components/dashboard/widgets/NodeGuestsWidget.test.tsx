import { describe, it, expect, afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { renderWithProviders, screen, fireEvent, within } from '@/__tests__/setup/renderWithProviders'

import NodeGuestsWidget from './NodeGuestsWidget'

/**
 * #856: a cluster > node > guest tree where every guest shows its name, CPU
 * and RAM at once. The Guest Map only ever shows one metric per tile and the
 * name on hover, which is the gap this widget fills. The tree starts fully
 * collapsed; what the user opens is saved in the widget settings.
 */

// This project does not enable Vitest globals, so RTL's auto-cleanup is off.
afterEach(cleanup)

type Row = Record<string, unknown>

const node = (over: Row = {}): Row => ({
  connId: 'c1', node: 'pve-1', name: 'pve-1', connection: 'cluster-1', connectionId: 'c1',
  status: 'online', cpuPct: 12.5, memPct: 40,
  _cpuCores: 8, _cpuUsage: 0.125, _memUsed: 4, _memMax: 10,
  ...over,
})

const guest = (over: Row = {}): Row => ({
  id: 'c1-pve-1-100', vmid: 100, name: 'web-01', node: 'pve-1', connId: 'c1', connName: 'cluster-1',
  type: 'qemu', status: 'running', cpu: 0.25, mem: 2048, maxmem: 4096, template: false,
  ...over,
})

// One cluster, two nodes with guests, one idle node without any. Every
// percentage is distinct so a bare getByText pins the right cell. The cluster
// load is derived from the nodes: CPU weighted by cores, (1 + 0.12 + 0.04) / 16
// = 7 %, RAM as a plain sum, 7 / 30 = 23 %.
const data = {
  clusters: [{ id: 'c1', name: 'cluster-1', isCluster: true, nodes: 3, onlineNodes: 3 }],
  nodes: [
    node(),
    node({ node: 'pve-2', name: 'pve-2', cpuPct: 3, memPct: 20, _cpuCores: 4, _cpuUsage: 0.03, _memUsed: 2, _memMax: 10 }),
    node({ node: 'pve-3', name: 'pve-3', cpuPct: 1, memPct: 10, _cpuCores: 4, _cpuUsage: 0.01, _memUsed: 1, _memMax: 10 }),
  ],
  vmList: [
    guest(),
    guest({ id: 'c1-pve-1-101', vmid: 101, name: 'db-01', status: 'stopped', cpu: 0, mem: 0 }),
  ],
  lxcList: [
    guest({ id: 'c1-pve-2-200', vmid: 200, name: 'proxy-01', node: 'pve-2', type: 'lxc', cpu: 0.05, mem: 512, maxmem: 8192 }),
  ],
}

const ALL_KEYS = ['c1', 'c1:pve-1', 'c1:pve-2', 'c1:pve-3']
const ALL_OPEN = { expanded: ALL_KEYS }
const CLUSTER_OPEN = { expanded: ['c1'] }

const render = (d: unknown, settings: Row = {}, onUpdateSettings = vi.fn()) => {
  renderWithProviders(
    <NodeGuestsWidget data={d} loading={false} config={{ settings }} onUpdateSettings={onUpdateSettings} />,
  )

  return onUpdateSettings
}

const header = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}\\b`) })
const queryHeader = (name: string) => screen.queryByRole('button', { name: new RegExp(`^${name}\\b`) })

describe('NodeGuestsWidget', () => {
  it('starts fully collapsed, with only the cluster rows on screen', () => {
    render(data)

    expect(header('cluster-1')).toHaveAttribute('aria-expanded', 'false')
    expect(queryHeader('pve-1')).not.toBeInTheDocument()
    expect(screen.queryByText('web-01')).not.toBeInTheDocument()
    // The cluster row still sums up what it hides.
    expect(within(header('cluster-1')).getByText('2/3')).toBeInTheDocument()
  })

  it('tops the tree with a cluster row carrying the aggregated load', () => {
    render(data)

    const cluster = header('cluster-1')

    expect(within(cluster).getByText('3 nodes')).toBeInTheDocument()
    expect(within(cluster).getByText('2/3')).toBeInTheDocument()
    // Weighted by cores, not a plain mean of the node percentages (5.5 %).
    expect(within(cluster).getByText('7%')).toBeInTheDocument()
    expect(within(cluster).getByText('23%')).toBeInTheDocument()
  })

  it('lists every guest under its node with name, CPU and RAM side by side', () => {
    render(data, ALL_OPEN)

    // Node rows carry the node's own load.
    expect(header('pve-1')).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('13%')).toBeInTheDocument()
    expect(screen.getByText('40%')).toBeInTheDocument()

    // Guest rows print the name and both metrics, no hover needed.
    expect(screen.getByText('web-01')).toBeInTheDocument()
    expect(screen.getByText('25%')).toBeInTheDocument()
    expect(screen.getByText('50%')).toBeInTheDocument()
    expect(screen.getByText('proxy-01')).toBeInTheDocument()
    expect(screen.getByText('5%')).toBeInTheDocument()
    expect(screen.getByText('6%')).toBeInTheDocument()
  })

  it('keeps a node without any guest in the list', () => {
    render(data, CLUSTER_OPEN)
    expect(header('pve-3')).toBeInTheDocument()
    expect(within(header('pve-3')).getByText('0/0')).toBeInTheDocument()
  })

  it('shows the running over total count of each node', () => {
    render(data, CLUSTER_OPEN)
    expect(within(header('pve-1')).getByText('1/2')).toBeInTheDocument()
    expect(within(header('pve-2')).getByText('1/1')).toBeInTheDocument()
  })

  it('keeps a stopped guest in the same row format, bars at zero and no status text', () => {
    render(data, ALL_OPEN)
    expect(screen.getByText('db-01')).toBeInTheDocument()
    expect(screen.queryByText('stopped')).not.toBeInTheDocument()
    // CPU and RAM of the stopped guest, the only zero figures in the data set.
    expect(screen.getAllByText('0%')).toHaveLength(2)
  })

  it('never shows a connection the user has no visible node or guest on', () => {
    // The API lists every connection of the tenant in `clusters`, before the
    // RBAC filter; only nodes and guests are filtered. A cluster row must
    // come from those, never from the bare connection list.
    render({ ...data, clusters: [...data.clusters, { id: 'c2', name: 'hidden-cluster', isCluster: true, nodes: 0, onlineNodes: 0 }] })

    expect(header('cluster-1')).toBeInTheDocument()
    expect(queryHeader('hidden-cluster')).not.toBeInTheDocument()
    // One visible connection: no connection filter to offer.
    expect(screen.queryByRole('button', { name: 'Filter' })).not.toBeInTheDocument()
  })

  it('offers the connection filter for the visible connections only', () => {
    const second = {
      clusters: [...data.clusters, { id: 'c2', name: 'cluster-2', isCluster: true, nodes: 1, onlineNodes: 1 }, { id: 'c3', name: 'hidden-cluster', isCluster: true, nodes: 0, onlineNodes: 0 }],
      nodes: [...data.nodes, node({ connId: 'c2', connectionId: 'c2', connection: 'cluster-2', node: 'pve-b', name: 'pve-b', cpuPct: 2, memPct: 30 })],
    }

    render({ ...data, ...second })

    fireEvent.click(screen.getByRole('button', { name: 'Filter' }))
    expect(screen.getByRole('menuitem', { name: /cluster-1/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /cluster-2/ })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /hidden-cluster/ })).not.toBeInTheDocument()
  })

  it('names a cluster after the PVE cluster name when the API provides it', () => {
    // The node rows carry the ProxCenter connection name; the cluster row
    // prefers the real PVE cluster name from `clusters` when there is one.
    render({ ...data, clusters: [{ id: 'c1', name: 'PVE-PROD', isCluster: true, nodes: 3, onlineNodes: 3 }] })
    expect(header('PVE-PROD')).toBeInTheDocument()
    expect(queryHeader('cluster-1')).not.toBeInTheDocument()
  })

  it('never lists templates', () => {
    render({ ...data, vmList: [...data.vmList, guest({ id: 'c1-pve-1-900', vmid: 900, name: 'tpl-debian', template: true })] }, ALL_OPEN)
    expect(screen.queryByText('tpl-debian')).not.toBeInTheDocument()
    // The template does not count either.
    expect(within(header('pve-1')).getByText('1/2')).toBeInTheDocument()
  })

  it('keeps a node folded unless the settings list it as expanded', () => {
    render(data, { expanded: ['c1', 'c1:pve-2'] })

    expect(header('pve-1')).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('web-01')).not.toBeInTheDocument()
    // The header keeps its count and load, so a folded node is still informative.
    expect(within(header('pve-1')).getByText('1/2')).toBeInTheDocument()
    expect(screen.getByText('13%')).toBeInTheDocument()
    // The node that is listed is open.
    expect(screen.getByText('proxy-01')).toBeInTheDocument()
  })

  it('ignores an expanded node whose cluster is folded', () => {
    render(data, { expanded: ['c1:pve-1'] })
    expect(queryHeader('pve-1')).not.toBeInTheDocument()
    expect(screen.queryByText('web-01')).not.toBeInTheDocument()
  })

  it('persists opening a cluster through the widget settings', () => {
    const onUpdate = render(data)
    fireEvent.click(header('cluster-1'))
    expect(onUpdate).toHaveBeenCalledWith({ expanded: ['c1'] })
  })

  it('persists opening a node through the widget settings', () => {
    const onUpdate = render(data, CLUSTER_OPEN)
    fireEvent.click(header('pve-1'))
    expect(onUpdate).toHaveBeenCalledWith({ expanded: ['c1', 'c1:pve-1'] })
  })

  it('persists folding a node through the widget settings', () => {
    const onUpdate = render(data, ALL_OPEN)
    fireEvent.click(header('pve-1'))
    expect(onUpdate).toHaveBeenCalledWith({ expanded: ['c1', 'c1:pve-2', 'c1:pve-3'] })
  })

  it('expands every level at once', () => {
    const onUpdate = render(data)
    fireEvent.click(screen.getByRole('button', { name: 'Expand all' }))
    expect(onUpdate).toHaveBeenCalledWith({ expanded: ALL_KEYS })
  })

  it('collapses every level at once', () => {
    const onUpdate = render(data, ALL_OPEN)
    fireEvent.click(screen.getByRole('button', { name: 'Collapse all' }))
    expect(onUpdate).toHaveBeenCalledWith({ expanded: [] })
  })

  it('keeps its controls when the connection filter hides everything', () => {
    // A saved filter on a connection that no longer exists: nothing matches,
    // yet the way out must stay on screen (same lesson as #611).
    const onUpdate = render(data, { selectedConnections: ['gone'] })

    expect(screen.getByText('No results')).toBeInTheDocument()
    expect(queryHeader('cluster-1')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Reset'))
    expect(onUpdate).toHaveBeenCalledWith({ selectedConnections: [] })
  })

  it('falls back to the plain no-data card when there is genuinely nothing', () => {
    render({ clusters: [], nodes: [], vmList: [], lxcList: [] })
    expect(screen.getByText('No data')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Collapse all' })).not.toBeInTheDocument()
  })
})
