export type NodeStatus = 'ok' | 'warning' | 'critical' | 'offline'

export interface TopologyFilters {
  connectionId?: string
  vmStatus?: 'running' | 'stopped' | 'all'
  vmThreshold: number // collapse VMs above this number per node
  groupByVlan?: boolean
  viewMode?: 'infra' | 'network'
  groupByTag?: boolean
}

// Inventory API types (matches /api/v1/inventory response)
export interface InventoryGuest {
  vmid: string | number
  name?: string
  status: string // 'running' | 'stopped' | 'paused'
  type: string // 'qemu' | 'lxc'
  cpu?: number
  mem?: number
  maxmem?: number
  maxcpu?: number
  node: string
  tags?: string
}

export interface InventoryNode {
  node: string
  status: string
  cpu?: number
  maxcpu?: number
  mem?: number // bytes used
  maxmem?: number // bytes total
  uptime?: number
  guests: InventoryGuest[]
}

export interface InventoryCluster {
  id: string
  name: string
  type: string
  isCluster: boolean
  status: 'online' | 'degraded' | 'offline'
  nodes: InventoryNode[]
}

export interface InventoryData {
  clusters: InventoryCluster[]
}

// Custom node data types — index signature required by React Flow v12
export interface ClusterNodeData {
  [key: string]: unknown
  label: string
  host: string
  connectionId: string
  nodeCount: number
  vmCount: number
  cpuUsage: number
  ramUsage: number
  status: NodeStatus
  width: number
  height: number
}

export interface HostNodeData {
  [key: string]: unknown
  label: string
  connectionId: string
  nodeName: string
  cpuUsage: number
  ramUsage: number
  vmCount: number
  uptime: number
  status: NodeStatus
  width: number
  height: number
}

export interface VmNodeData {
  [key: string]: unknown
  label: string
  connectionId: string
  vmid: number
  vmType: string // 'qemu' | 'lxc'
  vmStatus: string // 'running' | 'stopped' | 'paused'
  cpuUsage: number
  ramUsage: number
  nodeName: string
  width: number
  height: number
}

export interface VmSummaryNodeData {
  [key: string]: unknown
  label: string
  connectionId: string
  nodeName: string
  total: number
  running: number
  stopped: number
  width: number
  height: number
}

export interface VlanGroupNodeData {
  [key: string]: unknown
  label: string
  connectionId: string
  nodeName: string
  vlanTag: number | null
  bridge: string
  vmCount: number
  width: number
  height: number
}

export interface TagGroupNodeData {
  [key: string]: unknown
  label: string
  connectionId: string
  nodeName: string
  tag: string
  vmCount: number
  width: number
  height: number
}

export interface VlanContainerVm {
  vmid: number
  name: string
  vmType: string
  vmStatus: string
  nodeName: string
}

export interface VlanContainerNodeData {
  [key: string]: unknown
  label: string
  vlanTag: number | null
  bridge: string
  vms: VlanContainerVm[]
  width: number
  height: number
}

export interface ProxCenterNodeData {
  [key: string]: unknown
  label: string
  clusterCount: number
  totalNodes: number
  totalVms: number
  width: number
  height: number
}

// Selected node info for sidebar
export type SelectedNodeInfo =
  | { type: 'cluster'; data: ClusterNodeData }
  | { type: 'host'; data: HostNodeData }
  | { type: 'vm'; data: VmNodeData }
  | { type: 'vmSummary'; data: VmSummaryNodeData }
  | { type: 'vlanGroup'; data: VlanGroupNodeData }
  | { type: 'tagGroup'; data: TagGroupNodeData }
  | { type: 'vlanContainer'; data: VlanContainerNodeData }
  | { type: 'proxcenter'; data: ProxCenterNodeData }
