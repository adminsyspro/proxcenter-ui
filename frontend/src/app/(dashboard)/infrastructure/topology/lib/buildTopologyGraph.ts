import type { Node, Edge } from '@xyflow/react'

import type {
  InventoryData,
  TopologyFilters,
  ClusterNodeData,
  HostNodeData,
  VmNodeData,
  VmSummaryNodeData,
  NodeStatus,
} from '../types'
import { getResourceStatus } from './topologyColors'

export function buildTopologyGraph(
  data: InventoryData,
  filters: TopologyFilters
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = []
  const edges: Edge[] = []

  if (!data?.connections) return { nodes, edges }

  const connections = filters.connectionId
    ? data.connections.filter((c) => c.id === filters.connectionId)
    : data.connections

  for (const conn of connections) {
    const clusterId = `cluster-${conn.id}`
    const isOnline = conn.status === 'online' || conn.status === 'connected'

    // Compute aggregate stats for the cluster
    let totalVms = 0
    let worstStatus: NodeStatus = 'ok'
    let totalCpu = 0
    let totalMaxCpu = 0

    for (const node of conn.nodes) {
      const nodeIsOnline = node.status === 'online'
      const nodeCpuUsage = node.maxcpu > 0 ? node.cpu / node.maxcpu : 0
      const nodeRamUsage = node.maxmem > 0 ? node.mem / node.maxmem : 0
      const nodeStatus = getResourceStatus(Math.max(nodeCpuUsage, nodeRamUsage), nodeIsOnline)

      if (nodeStatus === 'critical') worstStatus = 'critical'
      else if (nodeStatus === 'warning' && worstStatus !== 'critical') worstStatus = 'warning'

      totalCpu += node.cpu
      totalMaxCpu += node.maxcpu

      const vms = node.vms || []

      totalVms += vms.length
    }

    if (!isOnline && worstStatus !== 'critical') worstStatus = 'critical'

    const clusterData: ClusterNodeData = {
      label: conn.name,
      host: conn.host,
      connectionId: conn.id,
      nodeCount: conn.nodes.length,
      vmCount: totalVms,
      cpuUsage: totalMaxCpu > 0 ? totalCpu / totalMaxCpu : 0,
      status: isOnline ? worstStatus : 'offline',
      width: 220,
      height: 100,
    }

    nodes.push({
      id: clusterId,
      type: 'cluster',
      position: { x: 0, y: 0 },
      data: clusterData,
    })

    // Process each host node
    for (const node of conn.nodes) {
      const hostId = `host-${conn.id}-${node.node}`
      const nodeIsOnline = node.status === 'online'
      const cpuUsage = node.maxcpu > 0 ? node.cpu / node.maxcpu : 0
      const ramUsage = node.maxmem > 0 ? node.mem / node.maxmem : 0
      const nodeStatus = getResourceStatus(Math.max(cpuUsage, ramUsage), nodeIsOnline)

      // Filter VMs based on filters
      let vms = node.vms || []

      if (filters.vmStatus && filters.vmStatus !== 'all') {
        vms = vms.filter((vm) => vm.status === filters.vmStatus)
      }

      const hostData: HostNodeData = {
        label: node.node,
        connectionId: conn.id,
        nodeName: node.node,
        cpuUsage,
        ramUsage,
        vmCount: vms.length,
        uptime: node.uptime,
        status: nodeIsOnline ? nodeStatus : 'offline',
        width: 190,
        height: 90,
      }

      nodes.push({
        id: hostId,
        type: 'host',
        position: { x: 0, y: 0 },
        data: hostData,
      })

      edges.push({
        id: `e-${clusterId}-${hostId}`,
        source: clusterId,
        target: hostId,
        type: 'smoothstep',
        animated: false,
        style: { stroke: '#666', strokeWidth: 1.5 },
      })

      // VMs: individual or summary
      if (vms.length > 0) {
        if (vms.length <= filters.vmThreshold) {
          // Individual VM nodes
          for (const vm of vms) {
            const vmId = `vm-${conn.id}-${node.node}-${vm.vmid}`
            const vmCpuUsage = vm.maxcpu > 0 ? vm.cpu / vm.maxcpu : 0
            const vmRamUsage = vm.maxmem > 0 ? vm.mem / vm.maxmem : 0

            const vmData: VmNodeData = {
              label: vm.name || `VM ${vm.vmid}`,
              connectionId: conn.id,
              vmid: vm.vmid,
              vmType: vm.type,
              vmStatus: vm.status,
              cpuUsage: vmCpuUsage,
              ramUsage: vmRamUsage,
              nodeName: node.node,
              width: 160,
              height: 50,
            }

            nodes.push({
              id: vmId,
              type: 'vm',
              position: { x: 0, y: 0 },
              data: vmData,
            })

            edges.push({
              id: `e-${hostId}-${vmId}`,
              source: hostId,
              target: vmId,
              type: 'smoothstep',
              animated: false,
              style: { stroke: '#999', strokeWidth: 1 },
            })
          }
        } else {
          // Summary node
          const summaryId = `vmsummary-${conn.id}-${node.node}`
          const running = vms.filter((v) => v.status === 'running').length
          const stopped = vms.filter((v) => v.status === 'stopped').length

          const summaryData: VmSummaryNodeData = {
            label: `${vms.length} VMs`,
            connectionId: conn.id,
            nodeName: node.node,
            total: vms.length,
            running,
            stopped,
            width: 180,
            height: 60,
          }

          nodes.push({
            id: summaryId,
            type: 'vmSummary',
            position: { x: 0, y: 0 },
            data: summaryData,
          })

          edges.push({
            id: `e-${hostId}-${summaryId}`,
            source: hostId,
            target: summaryId,
            type: 'smoothstep',
            animated: false,
            style: { stroke: '#999', strokeWidth: 1 },
          })
        }
      }
    }
  }

  return { nodes, edges }
}
