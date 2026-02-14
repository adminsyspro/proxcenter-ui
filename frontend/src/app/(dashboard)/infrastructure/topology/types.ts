export type NodeStatus = 'ok' | 'warning' | 'critical' | 'offline'

export interface TopologyFilters {
  connectionId?: string
  vmStatus?: 'running' | 'stopped' | 'all'
  vmThreshold: number // collapse VMs above this number per node
}

// Inventory API types
export interface InventoryVm {
  vmid: number
  name: string
  status: string // 'running' | 'stopped' | 'paused'
  type: string // 'qemu' | 'lxc'
  cpu: number
  maxcpu: number
  mem: number
  maxmem: number
  node: string
}

export interface InventoryNode {
  node: string
  status: string
  cpu: number // 0-1 fraction
  maxcpu: number
  mem: number // bytes used
  maxmem: number // bytes total
  uptime: number
  vms?: InventoryVm[]
}

export interface InventoryConnection {
  id: string
  name: string
  host: string
  status: string
  nodes: InventoryNode[]
}

export interface InventoryData {
  connections: InventoryConnection[]
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

// Selected node info for sidebar
export type SelectedNodeInfo =
  | { type: 'cluster'; data: ClusterNodeData }
  | { type: 'host'; data: HostNodeData }
  | { type: 'vm'; data: VmNodeData }
  | { type: 'vmSummary'; data: VmSummaryNodeData }
