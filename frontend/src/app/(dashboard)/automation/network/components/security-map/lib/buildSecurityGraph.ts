import type { Node, Edge } from '@xyflow/react'

import type {
  SecurityZoneNodeData,
  SecurityZoneVM,
  InternetNodeData,
  ClusterFirewallNodeData,
  SecurityMapFilters,
  NetworkInfo,
  VMSegmentationSummary,
  FlowMatrixData,
} from '../types'
import { getZoneColor, getFlowStatusColor } from './securityMapColors'

const INFRA_PATTERNS = ['ceph', 'corosync', 'migration', 'backup', 'cluster', 'storage', 'replication']
const ZONE_WIDTH = 280
const INTERNET_WIDTH = 140
const INTERNET_HEIGHT = 60
const CLUSTER_FW_WIDTH = 220
const CLUSTER_FW_HEIGHT = 70

interface BuildGraphParams {
  networks: NetworkInfo[]
  vms: VMSegmentationSummary[]
  clusterOptions: any
  clusterRules: any[]
  flowMatrix: FlowMatrixData
  filters: SecurityMapFilters
}

export function buildSecurityGraph({
  networks,
  vms,
  clusterOptions,
  clusterRules,
  flowMatrix,
  filters,
}: BuildGraphParams): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = []
  const edges: Edge[] = []

  // 1. Filter networks
  const filteredNetworks = networks.filter((net) => {
    if (!filters.hideInfraNetworks) return true

    const nameLower = net.name.toLowerCase()

    return !INFRA_PATTERNS.some((p) => nameLower.includes(p))
  })

  // 2. Internet node
  const internetData: InternetNodeData = {
    label: 'Internet',
    width: INTERNET_WIDTH,
    height: INTERNET_HEIGHT,
  }

  nodes.push({
    id: 'internet',
    type: 'internet',
    position: { x: 0, y: 0 },
    data: internetData,
  })

  // 3. Cluster Firewall node
  const fwEnabled = clusterOptions?.enable === 1
  const clusterFwData: ClusterFirewallNodeData = {
    label: 'Cluster Firewall',
    enabled: fwEnabled,
    policyIn: clusterOptions?.policy_in || 'DROP',
    policyOut: clusterOptions?.policy_out || 'ACCEPT',
    ruleCount: clusterRules.length,
    width: CLUSTER_FW_WIDTH,
    height: CLUSTER_FW_HEIGHT,
  }

  nodes.push({
    id: 'cluster-fw',
    type: 'clusterFirewall',
    position: { x: 0, y: 0 },
    data: clusterFwData,
  })

  // 4. Edge: Internet → Cluster FW
  edges.push({
    id: 'e-internet-fw',
    source: 'internet',
    target: 'cluster-fw',
    type: 'smoothstep',
    style: { stroke: '#42a5f5', strokeWidth: 2 },
    animated: fwEnabled,
  })

  // 5. Zone nodes
  filteredNetworks.forEach((net, index) => {
    const zoneId = `zone-${net.name}`
    const color = getZoneColor(index)

    // Match VMs to this network
    let zoneVms = vms.filter(
      (vm) => vm.network === net.name || vm.networks?.includes(net.name)
    )

    // Filter stopped VMs if needed
    if (filters.hideStoppedVms) {
      zoneVms = zoneVms.filter((vm) => vm.status === 'running')
    }

    const mappedVms: SecurityZoneVM[] = zoneVms.map((vm) => ({
      vmid: vm.vmid,
      name: vm.name,
      status: vm.status,
      isIsolated: vm.is_isolated,
      firewallEnabled: vm.firewall_enabled,
      appliedSgs: vm.applied_sgs || [],
      node: vm.node,
    }))

    const height = 40 + 12 + Math.max(mappedVms.length, 1) * 20 + 12

    const zoneData: SecurityZoneNodeData = {
      label: net.name,
      cidr: net.cidr,
      gateway: net.gateway,
      hasGateway: net.has_gateway,
      hasBaseSg: net.has_base_sg,
      zoneIndex: index,
      vms: mappedVms,
      width: ZONE_WIDTH,
      height,
    }

    nodes.push({
      id: zoneId,
      type: 'securityZone',
      position: { x: 0, y: 0 },
      data: zoneData,
    })

    // 6. Edge: Cluster FW → Zone
    edges.push({
      id: `e-fw-${net.name}`,
      source: 'cluster-fw',
      target: zoneId,
      type: 'smoothstep',
      style: { stroke: color, strokeWidth: 1.5 },
    })
  })

  // 7. Inter-zone edges from flow matrix
  const networkNames = filteredNetworks.map((n) => n.name)

  for (let i = 0; i < flowMatrix.labels.length; i++) {
    for (let j = i + 1; j < flowMatrix.labels.length; j++) {
      const cell = flowMatrix.matrix[i]?.[j]

      if (!cell) continue
      if (cell.status !== 'allowed' && cell.status !== 'partial') continue

      const from = flowMatrix.labels[i]
      const to = flowMatrix.labels[j]

      // Only for filtered networks
      if (!networkNames.includes(from) || !networkNames.includes(to)) continue

      const color = getFlowStatusColor(cell.status)

      edges.push({
        id: `e-zone-${from}-${to}`,
        source: `zone-${from}`,
        target: `zone-${to}`,
        type: 'smoothstep',
        animated: cell.status === 'allowed',
        style: {
          stroke: color,
          strokeWidth: 1.5,
          ...(cell.status === 'partial' ? { strokeDasharray: '5 3' } : {}),
        },
        label: cell.summary !== 'None' ? cell.summary : undefined,
        labelStyle: { fontSize: 10, fill: color },
      })
    }
  }

  return { nodes, edges }
}
