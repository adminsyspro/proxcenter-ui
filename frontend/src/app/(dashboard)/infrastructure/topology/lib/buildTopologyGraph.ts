import type { Node, Edge } from '@xyflow/react'

import type {
  InventoryData,
  InventoryGuest,
  TopologyFilters,
  ClusterNodeData,
  HostNodeData,
  VmNodeData,
  VmSummaryNodeData,
  VlanGroupNodeData,
  VlanContainerNodeData,
  VlanContainerVm,
  TagGroupNodeData,
  ProxCenterNodeData,
  NodeStatus,
} from '../types'
import type { NetworkMap } from '../hooks/useTopologyNetworks'
import { getResourceStatus, getStatusColor, getVmStatusColor } from './topologyColors'

function buildVmNode(
  conn: { id: string },
  nodeName: string,
  guest: InventoryGuest,
  idSuffix?: string
): { node: Node; data: VmNodeData } {
  const vmid = typeof guest.vmid === 'string' ? parseInt(guest.vmid, 10) : guest.vmid
  const vmCpu = guest.cpu || 0
  const vmMaxCpu = guest.maxcpu || 0
  const vmMem = guest.mem || 0
  const vmMaxMem = guest.maxmem || 0

  const vmData: VmNodeData = {
    label: guest.name || `VM ${vmid}`,
    connectionId: conn.id,
    vmid,
    vmType: guest.type || 'qemu',
    vmStatus: guest.status,
    cpuUsage: vmMaxCpu > 0 ? vmCpu / vmMaxCpu : 0,
    ramUsage: vmMaxMem > 0 ? vmMem / vmMaxMem : 0,
    nodeName,
    width: 160,
    height: 50,
  }

  const id = idSuffix
    ? `vm-net-${idSuffix}-${conn.id}-${nodeName}-${vmid}`
    : `vm-${conn.id}-${nodeName}-${vmid}`

  return {
    node: {
      id,
      type: 'vm',
      position: { x: 0, y: 0 },
      data: vmData,
    },
    data: vmData,
  }
}

function buildVmEdge(sourceId: string, vmId: string, status: string): Edge {
  return {
    id: `e-${sourceId}-${vmId}`,
    source: sourceId,
    target: vmId,
    type: 'smoothstep',
    animated: status === 'running',
    style: {
      stroke: status === 'running' ? getVmStatusColor(status) : '#9e9e9e',
      strokeWidth: 1,
    },
  }
}

/* ------------------------------------------------------------------ */
/* Network (VLAN-only) view                                           */
/* ------------------------------------------------------------------ */

function buildNetworkView(
  data: InventoryData,
  filters: TopologyFilters,
  networkMap?: NetworkMap
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = []
  const edges: Edge[] = []

  if (!data?.clusters) return { nodes, edges }

  const clusters = filters.connectionId
    ? data.clusters.filter((c) => c.id === filters.connectionId)
    : data.clusters

  let grandTotalVms = 0
  let grandTotalNodes = 0

  // Per-cluster: collect VMs into VLAN buckets
  const clusterVlanMap = new Map<
    string,
    Map<string, { vlanTag: number | null; bridge: string; vms: VlanContainerVm[] }>
  >()

  for (const conn of clusters) {
    grandTotalNodes += conn.nodes.length
    const buckets = new Map<string, { vlanTag: number | null; bridge: string; vms: VlanContainerVm[] }>()

    for (const node of conn.nodes) {
      let guests = node.guests || []

      if (filters.vmStatus && filters.vmStatus !== 'all') {
        guests = guests.filter((g) => g.status === filters.vmStatus)
      }

      grandTotalVms += guests.length

      for (const guest of guests) {
        const vmid = typeof guest.vmid === 'string' ? parseInt(guest.vmid, 10) : guest.vmid
        const type = guest.type || 'qemu'
        const netKey = `${conn.id}:${type}:${node.node}:${typeof guest.vmid === 'string' ? guest.vmid : String(guest.vmid)}`
        const nics = networkMap?.get(netKey) || []

        const vmEntry: VlanContainerVm = {
          vmid,
          name: guest.name || `VM ${vmid}`,
          vmType: type,
          vmStatus: guest.status,
          nodeName: node.node,
        }

        if (nics.length === 0) {
          const groupKey = 'no-vlan'

          if (!buckets.has(groupKey)) {
            buckets.set(groupKey, { vlanTag: null, bridge: 'unknown', vms: [] })
          }

          buckets.get(groupKey)!.vms.push(vmEntry)
        } else {
          for (const nic of nics) {
            const vlanTag = nic.vlanTag ?? null
            const bridge = nic.bridge ?? 'unknown'
            const groupKey = vlanTag != null ? `vlan-${vlanTag}` : 'no-vlan'

            if (!buckets.has(groupKey)) {
              buckets.set(groupKey, { vlanTag, bridge, vms: [] })
            }

            buckets.get(groupKey)!.vms.push(vmEntry)
          }
        }
      }
    }

    clusterVlanMap.set(conn.id, buckets)
  }

  // ProxCenter root
  const proxcenterData: ProxCenterNodeData = {
    label: 'ProxCenter',
    clusterCount: clusters.length,
    totalNodes: grandTotalNodes,
    totalVms: grandTotalVms,
    width: 300,
    height: 90,
  }

  nodes.push({
    id: 'proxcenter',
    type: 'proxcenter',
    position: { x: 0, y: 0 },
    data: proxcenterData,
  })

  // Cluster nodes + VLAN containers per cluster
  for (const conn of clusters) {
    const clusterId = `cluster-${conn.id}`
    const isOnline = conn.status === 'online' || conn.status === 'degraded'

    let cpuSum = 0
    let ramSum = 0
    let nodeCountOnline = 0
    let totalVms = 0
    let worstStatus: NodeStatus = 'ok'

    for (const node of conn.nodes) {
      const nodeIsOnline = node.status === 'online'
      const nodeCpuUsage = node.cpu || 0
      const nodeMem = node.mem || 0
      const nodeMaxMem = node.maxmem || 0
      const nodeRamUsage = nodeMaxMem > 0 ? nodeMem / nodeMaxMem : 0
      const nodeStatus = getResourceStatus(Math.max(nodeCpuUsage, nodeRamUsage), nodeIsOnline)

      if (nodeStatus === 'critical') worstStatus = 'critical'
      else if (nodeStatus === 'warning' && worstStatus !== 'critical') worstStatus = 'warning'

      if (nodeIsOnline) {
        cpuSum += nodeCpuUsage
        ramSum += nodeRamUsage
        nodeCountOnline++
      }

      totalVms += (node.guests || []).length
    }

    if (!isOnline && worstStatus !== 'critical') worstStatus = 'critical'

    const clusterData: ClusterNodeData = {
      label: conn.name,
      host: conn.name,
      connectionId: conn.id,
      nodeCount: conn.nodes.length,
      vmCount: totalVms,
      cpuUsage: nodeCountOnline > 0 ? cpuSum / nodeCountOnline : 0,
      ramUsage: nodeCountOnline > 0 ? ramSum / nodeCountOnline : 0,
      status: isOnline ? worstStatus : 'offline',
      width: 220,
      height: 115,
    }

    nodes.push({
      id: clusterId,
      type: 'cluster',
      position: { x: 0, y: 0 },
      data: clusterData,
    })

    edges.push({
      id: `e-proxcenter-${clusterId}`,
      source: 'proxcenter',
      target: clusterId,
      type: 'smoothstep',
      animated: true,
      style: { stroke: '#F29221', strokeWidth: 2 },
    })

    // VLAN container nodes for this cluster
    const buckets = clusterVlanMap.get(conn.id)

    if (buckets) {
      for (const [groupKey, bucket] of buckets) {
        const containerId = `vlanc-${conn.id}-${groupKey}`
        const VM_ROW_HEIGHT = 18
        const HEADER_HEIGHT = 32
        const PADDING = 8
        const containerHeight = HEADER_HEIGHT + PADDING + bucket.vms.length * VM_ROW_HEIGHT + PADDING

        const containerData: VlanContainerNodeData = {
          label: bucket.vlanTag != null ? `VLAN ${bucket.vlanTag}` : 'No VLAN',
          vlanTag: bucket.vlanTag,
          bridge: bucket.bridge,
          vms: bucket.vms,
          width: 240,
          height: Math.max(containerHeight, 70),
        }

        nodes.push({
          id: containerId,
          type: 'vlanContainer',
          position: { x: 0, y: 0 },
          data: containerData,
        })

        edges.push({
          id: `e-${clusterId}-${containerId}`,
          source: clusterId,
          target: containerId,
          type: 'smoothstep',
          animated: true,
          style: { stroke: '#1976d2', strokeWidth: 1.5 },
        })
      }
    }
  }

  return { nodes, edges }
}

/* ------------------------------------------------------------------ */
/* Infrastructure view (default)                                      */
/* ------------------------------------------------------------------ */

function buildInfraView(
  data: InventoryData,
  filters: TopologyFilters,
  networkMap?: NetworkMap
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = []
  const edges: Edge[] = []

  if (!data?.clusters) return { nodes, edges }

  const clusters = filters.connectionId
    ? data.clusters.filter((c) => c.id === filters.connectionId)
    : data.clusters

  // Aggregate totals for ProxCenter root node
  let grandTotalNodes = 0
  let grandTotalVms = 0

  for (const conn of clusters) {
    const clusterId = `cluster-${conn.id}`
    const isOnline = conn.status === 'online' || conn.status === 'degraded'

    // Compute aggregate stats for the cluster
    let totalVms = 0
    let worstStatus: NodeStatus = 'ok'
    let cpuSum = 0
    let ramSum = 0
    let nodeCountOnline = 0

    for (const node of conn.nodes) {
      const nodeIsOnline = node.status === 'online'

      // PVE returns node.cpu as a 0-1 ratio already (not raw cycles)
      const nodeCpuUsage = node.cpu || 0
      const nodeMem = node.mem || 0
      const nodeMaxMem = node.maxmem || 0
      const nodeRamUsage = nodeMaxMem > 0 ? nodeMem / nodeMaxMem : 0
      const nodeStatus = getResourceStatus(Math.max(nodeCpuUsage, nodeRamUsage), nodeIsOnline)

      if (nodeStatus === 'critical') worstStatus = 'critical'
      else if (nodeStatus === 'warning' && worstStatus !== 'critical') worstStatus = 'warning'

      if (nodeIsOnline) {
        cpuSum += nodeCpuUsage
        ramSum += nodeRamUsage
        nodeCountOnline++
      }

      const guests = node.guests || []

      totalVms += guests.length
    }

    if (!isOnline && worstStatus !== 'critical') worstStatus = 'critical'

    grandTotalNodes += conn.nodes.length
    grandTotalVms += totalVms

    const clusterData: ClusterNodeData = {
      label: conn.name,
      host: conn.name,
      connectionId: conn.id,
      nodeCount: conn.nodes.length,
      vmCount: totalVms,
      cpuUsage: nodeCountOnline > 0 ? cpuSum / nodeCountOnline : 0,
      ramUsage: nodeCountOnline > 0 ? ramSum / nodeCountOnline : 0,
      status: isOnline ? worstStatus : 'offline',
      width: 220,
      height: 115,
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

      // PVE returns node.cpu as a 0-1 ratio already
      const cpuUsage = node.cpu || 0
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
        animated: nodeIsOnline,
        style: { stroke: getStatusColor(hostData.status), strokeWidth: 1.5 },
      })

      // VMs: individual or summary
      if (guests.length > 0) {
        if (guests.length <= filters.vmThreshold) {
          // Check if VLAN grouping is enabled and data is available
          if (filters.groupByVlan && networkMap && networkMap.size > 0) {
            // Group VMs by VLAN tag
            const vlanGroups = new Map<string, { vlanTag: number | null; bridge: string; guests: InventoryGuest[] }>()

            for (const guest of guests) {
              const vmid = typeof guest.vmid === 'string' ? guest.vmid : String(guest.vmid)
              const type = guest.type || 'qemu'
              const key = `${conn.id}:${type}:${node.node}:${vmid}`
              const netInfo = networkMap.get(key)

              // Use first NIC's VLAN info
              const firstNic = netInfo?.[0]
              const vlanTag = firstNic?.vlanTag ?? null
              const bridge = firstNic?.bridge ?? 'unknown'
              const groupKey = vlanTag != null ? `vlan-${vlanTag}` : 'no-vlan'

              if (!vlanGroups.has(groupKey)) {
                vlanGroups.set(groupKey, { vlanTag, bridge, guests: [] })
              }

              vlanGroups.get(groupKey)!.guests.push(guest)
            }

            // Create VLAN group nodes and edges
            for (const [groupKey, group] of vlanGroups) {
              const vlanNodeId = `vlan-${conn.id}-${node.node}-${groupKey}`

              const vlanData: VlanGroupNodeData = {
                label: group.vlanTag != null ? `VLAN ${group.vlanTag}` : 'No VLAN',
                connectionId: conn.id,
                nodeName: node.node,
                vlanTag: group.vlanTag,
                bridge: group.bridge,
                vmCount: group.guests.length,
                width: 170,
                height: 50,
              }

              nodes.push({
                id: vlanNodeId,
                type: 'vlanGroup',
                position: { x: 0, y: 0 },
                data: vlanData,
              })

              edges.push({
                id: `e-${hostId}-${vlanNodeId}`,
                source: hostId,
                target: vlanNodeId,
                type: 'smoothstep',
                animated: true,
                style: { stroke: '#1976d2', strokeWidth: 1.5 },
              })

              // Individual VM nodes under the VLAN group
              for (const guest of group.guests) {
                const { node: vmNode } = buildVmNode(conn, node.node, guest)

                nodes.push(vmNode)
                edges.push(buildVmEdge(vlanNodeId, vmNode.id, guest.status))
              }
            }
          } else if (filters.groupByTag) {
            // Group VMs by first Proxmox tag
            const tagGroups = new Map<string, InventoryGuest[]>()

            for (const guest of guests) {
              const tags = guest.tags?.split(';').filter(Boolean) || []
              const firstTag = tags[0] || '__none__'

              if (!tagGroups.has(firstTag)) {
                tagGroups.set(firstTag, [])
              }

              tagGroups.get(firstTag)!.push(guest)
            }

            for (const [tag, tagGuests] of tagGroups) {
              const tagNodeId = `tag-${conn.id}-${node.node}-${tag}`

              const tagData: TagGroupNodeData = {
                label: tag === '__none__' ? 'No Tag' : tag,
                connectionId: conn.id,
                nodeName: node.node,
                tag,
                vmCount: tagGuests.length,
                width: 170,
                height: 45,
              }

              nodes.push({
                id: tagNodeId,
                type: 'tagGroup',
                position: { x: 0, y: 0 },
                data: tagData,
              })

              edges.push({
                id: `e-${hostId}-${tagNodeId}`,
                source: hostId,
                target: tagNodeId,
                type: 'smoothstep',
                animated: true,
                style: { stroke: '#7b1fa2', strokeWidth: 1.5 },
              })

              for (const guest of tagGuests) {
                const { node: vmNode } = buildVmNode(conn, node.node, guest)

                nodes.push(vmNode)
                edges.push(buildVmEdge(tagNodeId, vmNode.id, guest.status))
              }
            }
          } else {
            // Individual VM nodes (no grouping)
            for (const guest of guests) {
              const { node: vmNode } = buildVmNode(conn, node.node, guest)

              nodes.push(vmNode)
              edges.push(buildVmEdge(hostId, vmNode.id, guest.status))
            }
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

          const runningRatio = guests.length > 0 ? running / guests.length : 0
          const summaryEdgeColor = runningRatio > 0.5 ? '#4caf50' : runningRatio > 0 ? '#ff9800' : '#9e9e9e'

          edges.push({
            id: `e-${hostId}-${summaryId}`,
            source: hostId,
            target: summaryId,
            type: 'smoothstep',
            animated: running > 0,
            style: { stroke: summaryEdgeColor, strokeWidth: 1 },
          })
        }
      }
    }
  }

  // ProxCenter root node — always at top, connecting to all clusters/standalone nodes
  const proxcenterData: ProxCenterNodeData = {
    label: 'ProxCenter',
    clusterCount: clusters.length,
    totalNodes: grandTotalNodes,
    totalVms: grandTotalVms,
    width: 300,
    height: 90,
  }

  nodes.push({
    id: 'proxcenter',
    type: 'proxcenter',
    position: { x: 0, y: 0 },
    data: proxcenterData,
  })

  for (const conn of clusters) {
    const clusterId = `cluster-${conn.id}`

    edges.push({
      id: `e-proxcenter-${clusterId}`,
      source: 'proxcenter',
      target: clusterId,
      type: 'smoothstep',
      animated: true,
      style: { stroke: '#F29221', strokeWidth: 2 },
    })
  }

  return { nodes, edges }
}

/* ------------------------------------------------------------------ */
/* Main entry — dispatches based on viewMode                          */
/* ------------------------------------------------------------------ */

export function buildTopologyGraph(
  data: InventoryData,
  filters: TopologyFilters,
  networkMap?: NetworkMap
): { nodes: Node[]; edges: Edge[] } {
  if (filters.viewMode === 'network') {
    return buildNetworkView(data, filters, networkMap)
  }

  return buildInfraView(data, filters, networkMap)
}
