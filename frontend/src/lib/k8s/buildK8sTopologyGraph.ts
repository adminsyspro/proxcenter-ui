import type { Node, Edge } from '@xyflow/react'
import type { K8sTopologyData } from './topologyTypes'
import { packBoxes } from './packBoxes'
import { layoutGraph } from '@/app/(dashboard)/infrastructure/topology/lib/layoutGraph'

// Fixed card dimensions per kind
const LEAF_WIDTH = 220
const LEAF_HEIGHT = 80
const K8S_NODE_WIDTH = 200
const K8S_NODE_HEIGHT = 90
const GROUP_HEADER = 40
const GROUP_PADDING = 16
export const INFRA_GAP = 80
// Minimum group box size when empty
const MIN_GROUP_WIDTH = 260
const MIN_GROUP_HEIGHT = GROUP_HEADER + GROUP_PADDING * 2 + LEAF_HEIGHT

export function buildK8sTopologyGraph(data: K8sTopologyData): { nodes: Node[]; edges: Edge[] } {
  const allNodes: Node[] = []
  const allEdges: Edge[] = []

  // Index resources by id for fast lookup
  const resourceById = new Map(data.resources.map((r) => [r.id, r]))
  // Index k8sNodes by name for placement edge matching
  const k8sNodeByName = new Map(data.infra.k8sNodes.map((n) => [n.name, n]))

  // ---- Workload region ----
  // Build one appGroup parent per group + its children
  const groupBoxSizes: Array<{ id: string; width: number; height: number }> = []
  const groupNodeMap = new Map<string, Node>() // groupKey -> parent node (position TBD)

  for (const group of data.groups) {
    const groupId = `appGroup-${group.key}`
    const children = data.resources.filter((r) => r.groupKey === group.key)

    // Build child leaf nodes (position 0,0 initially; dagre will set them)
    const childNodes: Node[] = children.map((res) => ({
      id: res.id,
      type: res.kind,
      position: { x: 0, y: 0 },
      parentId: groupId,
      extent: 'parent' as const,
      style: { width: LEAF_WIDTH, height: LEAF_HEIGHT },
      data: {
        width: LEAF_WIDTH,
        height: LEAF_HEIGHT,
        kind: res.kind,
        name: res.name,
        subline: res.subline,
        healthy: res.healthy,
        reason: res.reason,
        detailRef: res.detailRef ?? { kind: res.kind, namespace: res.namespace, name: res.name, uid: res.uid },
        incomplete: res.incomplete,
        synthetic: res.synthetic,
        podCount: res.podCount,
        healthyCount: res.healthyCount,
        completed: res.completed,
        failed: res.failed,
        active: res.active,
        nodePlacement: res.nodePlacement,
        namespace: res.namespace,
        uid: res.uid,
      },
    }))

    // Intra-group edges (both endpoints must be in this group)
    const childIdSet = new Set(children.map((r) => r.id))
    const intraEdges: Edge[] = data.edges
      .filter((e) => childIdSet.has(e.source) && childIdSet.has(e.target))
      .map((e) => ({
        id: `e-${e.source}-${e.target}`,
        source: e.source,
        target: e.target,
        type: 'smoothstep' as const,
        data: { rel: e.rel, crossGroup: e.crossGroup ?? false },
      }))

    // Run dagre over the group's children to get parent-local positions
    let laidOutChildren = childNodes
    let groupWidth = MIN_GROUP_WIDTH
    let groupHeight = MIN_GROUP_HEIGHT

    if (childNodes.length > 0) {
      const laid = layoutGraph(childNodes, intraEdges, { rankdir: 'LR' })
      laidOutChildren = laid.nodes

      // Compute bounding box of laid-out children
      let maxX = 0
      let maxY = 0
      for (const n of laidOutChildren) {
        const w = (n.data as any).width ?? LEAF_WIDTH
        const h = (n.data as any).height ?? LEAF_HEIGHT
        maxX = Math.max(maxX, n.position.x + w)
        maxY = Math.max(maxY, n.position.y + h)
      }
      // Offset children down by header + padding, right by padding
      laidOutChildren = laidOutChildren.map((n) => ({
        ...n,
        position: {
          x: n.position.x + GROUP_PADDING,
          y: n.position.y + GROUP_HEADER + GROUP_PADDING,
        },
      }))
      groupWidth = Math.max(MIN_GROUP_WIDTH, maxX + GROUP_PADDING * 2)
      groupHeight = Math.max(MIN_GROUP_HEIGHT, maxY + GROUP_HEADER + GROUP_PADDING * 2)
    }

    groupBoxSizes.push({ id: groupId, width: groupWidth, height: groupHeight })

    const parentNode: Node = {
      id: groupId,
      type: 'appGroup',
      position: { x: 0, y: 0 }, // set by packBoxes below
      style: { width: groupWidth, height: groupHeight },
      data: {
        width: groupWidth,
        height: groupHeight,
        label: group.label,
        groupKey: group.key,
        shared: group.shared,
        count: group.count,
      },
    }

    groupNodeMap.set(group.key, parentNode)
    allNodes.push(parentNode)
    allNodes.push(...laidOutChildren)
  }

  // Pack group boxes (workload region)
  const packedGroups = packBoxes(groupBoxSizes, { maxRowWidth: 1600 })
  let workloadMaxY = 0
  for (const p of packedGroups) {
    const gNode = allNodes.find((n) => n.id === p.id)
    if (gNode) {
      gNode.position = { x: p.x, y: p.y }
      const h = (gNode.data as any).height ?? MIN_GROUP_HEIGHT
      workloadMaxY = Math.max(workloadMaxY, p.y + h)
    }
  }

  // ---- Infra region (only when bridge enabled) ----
  if (data.infra.bridgeStatus === 'enabled') {
    const infraOffsetY = workloadMaxY + INFRA_GAP
    const hostBoxSizes: Array<{ id: string; width: number; height: number }> = []

    // Build the authoritative host list: declared hosts + synthesized fallback for
    // any k8sNode referencing a hostId not present in data.infra.hosts.
    const declaredHostIds = new Set(data.infra.hosts.map((h) => h.id))
    const syntheticHostIds = new Set<string>()
    for (const kn of data.infra.k8sNodes) {
      if (!declaredHostIds.has(kn.hostId)) {
        syntheticHostIds.add(kn.hostId)
      }
    }
    // Synthesize a fallback host entry for each unmapped hostId (typically 'unmapped')
    const syntheticHosts = Array.from(syntheticHostIds).map((sid) => ({
      id: sid,
      hostName: sid === 'unmapped' ? 'Unmapped' : sid,
      clusterName: undefined as string | undefined,
      connectionId: undefined as string | undefined,
    }))
    const allHosts = [...data.infra.hosts, ...syntheticHosts]

    for (const host of allHosts) {
      const hostId = `proxmoxHost-${host.id}`
      const hostK8sNodes = data.infra.k8sNodes.filter((n) => n.hostId === host.id)

      // Row layout inside the host box
      const childNodes: Node[] = hostK8sNodes.map((kn, idx) => ({
        id: kn.id,
        type: 'k8sNode',
        position: {
          x: GROUP_PADDING + idx * (K8S_NODE_WIDTH + GROUP_PADDING),
          y: GROUP_HEADER + GROUP_PADDING,
        },
        parentId: hostId,
        extent: 'parent' as const,
        style: { width: K8S_NODE_WIDTH, height: K8S_NODE_HEIGHT },
        data: {
          width: K8S_NODE_WIDTH,
          height: K8S_NODE_HEIGHT,
          name: kn.name,
          ready: kn.ready,
          version: kn.version,
          internalIP: kn.internalIP,
          detailRef: kn.detailRef,
          match: kn.match,
          unmatchedReason: kn.unmatchedReason,
          uid: kn.uid,
          hostId: kn.hostId,
          hostName: host.hostName,
          clusterName: host.clusterName,
        },
      }))

      const cols = Math.max(1, hostK8sNodes.length)
      const hostWidth = Math.max(MIN_GROUP_WIDTH, cols * (K8S_NODE_WIDTH + GROUP_PADDING) + GROUP_PADDING)
      const hostHeight = GROUP_HEADER + GROUP_PADDING * 2 + K8S_NODE_HEIGHT

      hostBoxSizes.push({ id: hostId, width: hostWidth, height: hostHeight })

      const hostNode: Node = {
        id: hostId,
        type: 'proxmoxHost',
        position: { x: 0, y: infraOffsetY }, // x set by packBoxes below
        style: { width: hostWidth, height: hostHeight },
        data: {
          width: hostWidth,
          height: hostHeight,
          hostName: host.hostName,
          clusterName: host.clusterName,
          connectionId: host.connectionId,
          hostId: host.id,
        },
      }

      allNodes.push(hostNode)
      allNodes.push(...childNodes)
    }

    // Pack host boxes and apply positions
    const packedHosts = packBoxes(hostBoxSizes, { maxRowWidth: 1600 })
    for (const p of packedHosts) {
      const hNode = allNodes.find((n) => n.id === p.id)
      if (hNode) {
        hNode.position = { x: p.x, y: infraOffsetY + p.y }
      }
    }
  }

  // ---- Workload edges ----
  for (const e of data.edges) {
    // Only emit if both endpoints are resources (guard against unknown ids)
    if (!resourceById.has(e.source) || !resourceById.has(e.target)) continue
    allEdges.push({
      id: `e-${e.source}-${e.target}`,
      source: e.source,
      target: e.target,
      type: 'smoothstep',
      animated: true,
      data: { rel: e.rel, crossGroup: e.crossGroup ?? false },
    } as any)
  }

  // ---- Placement edges (podGroup -> k8sNode, hidden by default) ----
  if (data.infra.bridgeStatus === 'enabled') {
    for (const res of data.resources) {
      if (res.kind !== 'podGroup' || !res.nodePlacement || res.nodePlacement.length === 0) continue
      for (const nodeName of res.nodePlacement) {
        const kn = k8sNodeByName.get(nodeName)
        if (!kn) continue
        allEdges.push({
          id: `placement-${res.id}-${kn.id}`,
          source: res.id,
          target: kn.id,
          type: 'smoothstep',
          animated: true,
          hidden: true,
          data: { kind: 'placement' },
        } as any)
      }
    }
  }

  return { nodes: allNodes, edges: allEdges }
}
