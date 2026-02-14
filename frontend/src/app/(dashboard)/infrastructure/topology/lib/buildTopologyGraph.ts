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

  if (!data?.clusters) return { nodes, edges }

  const clusters = filters.connectionId
    ? data.clusters.filter((c) => c.id === filters.connectionId)
    : data.clusters

  for (const conn of clusters) {
    const clusterId = `cluster-${conn.id}`
    const isOnline = conn.status === 'online' || conn.status === 'degraded'

    // Compute aggregate stats for the cluster
    let totalVms = 0
    let worstStatus: NodeStatus = 'ok'
    let totalCpu = 0
    let totalMaxCpu = 0

    for (const node of conn.nodes) {
      const nodeIsOnline = node.status === 'online'
      const nodeCpu = node.cpu || 0
      const nodeMaxCpu = node.maxcpu || 0
      const nodeMem = node.mem || 0
      const nodeMaxMem = node.maxmem || 0
      const nodeCpuUsage = nodeMaxCpu > 0 ? nodeCpu / nodeMaxCpu : 0
      const nodeRamUsage = nodeMaxMem > 0 ? nodeMem / nodeMaxMem : 0
      const nodeStatus = getResourceStatus(Math.max(nodeCpuUsage, nodeRamUsage), nodeIsOnline)

      if (nodeStatus === 'critical') worstStatus = 'critical'
      else if (nodeStatus === 'warning' && worstStatus !== 'critical') worstStatus = 'warning'

      totalCpu += nodeCpu
      totalMaxCpu += nodeMaxCpu

      const guests = node.guests || []

      totalVms += guests.length
    }

    if (!isOnline && worstStatus !== 'critical') worstStatus = 'critical'

    const clusterData: ClusterNodeData = {
      label: conn.name,
      host: conn.name,
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
      const cpuUsage = (node.maxcpu || 0) > 0 ? (node.cpu || 0) / (node.maxcpu || 1) : 0
      const ramUsage = (node.maxmem || 0) > 0 ? (node.mem || 0) / (node.maxmem || 1) : 0
      const nodeStatus = getResourceStatus(Math.max(cpuUsage, ramUsage), nodeIsOnline)

      // Filter guests based on filters
      let guests = node.guests || []

      if (filters.vmStatus && filters.vmStatus !== 'all') {
        guests = guests.filter((g) => g.status === filters.vmStatus)
      }

      const hostData: HostNodeData = {
        label: node.node,
        connectionId: conn.id,
        nodeName: node.node,
        cpuUsage,
        ramUsage,
        vmCount: guests.length,
        uptime: node.uptime || 0,
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
      if (guests.length > 0) {
        if (guests.length <= filters.vmThreshold) {
          // Individual VM nodes
          for (const guest of guests) {
            const vmid = typeof guest.vmid === 'string' ? parseInt(guest.vmid, 10) : guest.vmid
            const vmId = `vm-${conn.id}-${node.node}-${vmid}`
            const vmCpu = guest.cpu || 0
            const vmMaxCpu = guest.maxcpu || 0
            const vmMem = guest.mem || 0
            const vmMaxMem = guest.maxmem || 0
            const vmCpuUsage = vmMaxCpu > 0 ? vmCpu / vmMaxCpu : 0
            const vmRamUsage = vmMaxMem > 0 ? vmMem / vmMaxMem : 0

            const vmData: VmNodeData = {
              label: guest.name || `VM ${vmid}`,
              connectionId: conn.id,
              vmid,
              vmType: guest.type || 'qemu',
              vmStatus: guest.status,
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
          const running = guests.filter((v) => v.status === 'running').length
          const stopped = guests.filter((v) => v.status === 'stopped').length

          const summaryData: VmSummaryNodeData = {
            label: `${guests.length} VMs`,
            connectionId: conn.id,
            nodeName: node.node,
            total: guests.length,
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
