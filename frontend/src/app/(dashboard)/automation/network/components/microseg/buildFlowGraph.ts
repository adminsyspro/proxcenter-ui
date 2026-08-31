import { MarkerType, type Edge, type Node } from '@xyflow/react'

import {
  flowsFromGuest,
  flowsToGuest,
  isOpenByDefault,
  type EastWestFlow,
  type EastWestGuest,
  type FlowEndpoint,
} from '@/lib/firewall/eastWest'

/**
 * Pure React Flow graph construction for the east-west view, kept out of the
 * canvas component so the lane layout and highlighting rules are testable
 * without rendering.
 *
 * Three swim-lanes, drawn as tinted container nodes behind the cards: every
 * guest appears as a source card in the left lane and a destination card in
 * the right one. With no selection the map still shows the traffic shape, as
 * thin overview edges joining every resolved guest-to-guest flow. Selecting a
 * card details its flows as connection cards in the middle lane, wired
 * source -> connection -> destination with directional animated edges.
 */

export type MsSelection = { side: 'source' | 'dest'; vmid: number } | null

export type MsVmNodeData = {
  label: string
  vmid: number
  vmType: 'qemu' | 'lxc'
  status: string
  ip?: string
  /** Which lane the card sits in; drives which handle is live. */
  side: 'source' | 'dest'
  /** The guest firewall is enabled (shield shown when the side is not open). */
  firewall: boolean
  /** Traffic passes on this side without any explicit rule (policy/firewall). */
  openByDefault: boolean
  selected: boolean
  /** Faded when a selection exists and the guest takes no part in its flows. */
  dimmed: boolean
}

/** A flow origin enriched with the carrier guest's name, for display. */
export type MsFlowOrigin = EastWestFlow['origins'][number] & { name: string }

export type MsFlowNodeData = {
  proto?: string
  dport?: string
  macro?: string
  origins: MsFlowOrigin[]
}

export type MsCardNodeData = {
  variant: 'any' | 'ref' | 'hint' | 'addRule'
  /** Raw reference text for the `ref` variant (external CIDR, unknown alias). */
  ref?: string
  side: 'source' | 'dest'
}

export type MsLaneNodeData = {
  labelKey: 'sourceVms' | 'allowedConnections' | 'destinationVms'
  icon: string
  count: number
  tone: 'primary' | 'success' | 'info'
  width: number
  height: number
}

// Card geometry: the lanes are laid out from these, and the node components
// render at exactly these sizes so the edges anchor where the layout expects.
export const MS_VM_W = 230
// One text line per guest card, so a large inventory stacks tight.
export const MS_VM_H = 34
export const MS_RULE_W = 250
export const MS_RULE_H = 66
export const MS_GAP = 10
export const MS_COL_GAP = 190
export const MS_LANE_PAD = 24
export const MS_LANE_HEADER_H = 44
const COL_SRC_X = 0
const COL_FLOW_X = COL_SRC_X + MS_VM_W + MS_COL_GAP
const COL_DST_X = COL_FLOW_X + MS_RULE_W + MS_COL_GAP

/** Search over what the cards show: name, vmid, ip. */
export function guestMatchesQuery(guest: EastWestGuest, query: string): boolean {
  if (!query) return true
  const q = query.toLowerCase()

  return guest.name.toLowerCase().includes(q) ||
    String(guest.vmid).includes(query) ||
    guest.ips.some(ip => ip.includes(query))
}

type EndpointRef = { nodeId: string; pseudo?: { variant: 'any' | 'ref'; ref?: string } }

/** The lane node an endpoint wires to, minting pseudo cards for any/ref. */
function endpointNodeId(endpoint: FlowEndpoint, side: 'source' | 'dest', flowIndex: number): EndpointRef {
  const prefix = side === 'source' ? 'src' : 'dst'
  if (endpoint.kind === 'vm') return { nodeId: `${prefix}-${endpoint.vmid}` }
  if (endpoint.kind === 'any') return { nodeId: `${prefix}-any`, pseudo: { variant: 'any' } }

  return { nodeId: `${prefix}-ref-${flowIndex}`, pseudo: { variant: 'ref', ref: endpoint.ref } }
}

export type FlowGraphInput = {
  guests: EastWestGuest[]
  flows: EastWestFlow[]
  selection: MsSelection
  query: string
  /** The VM picker's working set; null when the picker is empty (every guest). */
  vmidFilter?: Set<number> | null
  /** Edge stroke colors, resolved from the MUI theme by the canvas. */
  colors: { edge: string; edgeDim?: string }
}

/** A directional flow edge: arrowhead always, moving packet on detail edges. */
function flowEdge(id: string, source: string, target: string, colors: FlowGraphInput['colors'], dim: boolean): Edge {
  const stroke = dim ? (colors.edgeDim ?? colors.edge) : colors.edge

  return {
    id,
    source,
    target,
    type: 'flowEdge',
    style: { stroke, strokeWidth: dim ? 1 : 1.75 },
    markerEnd: { type: MarkerType.ArrowClosed, color: stroke, width: dim ? 12 : 15, height: dim ? 12 : 15 },
    data: dim ? {} : { particle: true, color: colors.edge },
  }
}

export function buildFlowGraph({ guests, flows, selection, query, vmidFilter = null, colors }: FlowGraphInput): { nodes: Node[]; edges: Edge[] } {
  const sorted = [...guests].sort((a, b) => a.name.localeCompare(b.name) || a.vmid - b.vmid)

  // The flows the selection puts on screen, before any search narrowing.
  const shownFlows = selection
    ? (selection.side === 'source' ? flowsFromGuest(flows, selection.vmid) : flowsToGuest(flows, selection.vmid))
    : []

  const involved = new Set<number>()
  for (const flow of shownFlows) {
    if (flow.source.kind === 'vm') involved.add(flow.source.vmid)
    if (flow.dest.kind === 'vm') involved.add(flow.dest.vmid)
  }

  // The picker and the search narrow the lanes, but never hide the selected
  // guest or the guests its flows reach: an edge must always have both cards.
  const visible = sorted.filter(g =>
    (guestMatchesQuery(g, query) && (vmidFilter === null || vmidFilter.has(g.vmid))) ||
    g.vmid === selection?.vmid ||
    involved.has(g.vmid),
  )
  const visibleVmids = new Set(visible.map(g => g.vmid))

  const nodes: Node[] = []
  const edges: Edge[] = []
  const nameByVmid = new Map(guests.map(g => [g.vmid, g.name]))

  const yOf = new Map<string, number>()
  for (const [index, guest] of visible.entries()) {
    const y = index * (MS_VM_H + MS_GAP)
    for (const side of ['source', 'dest'] as const) {
      const id = side === 'source' ? `src-${guest.vmid}` : `dst-${guest.vmid}`
      const selected = selection !== null && selection.side === side && selection.vmid === guest.vmid

      yOf.set(id, y)
      nodes.push({
        id,
        type: 'msVm',
        position: { x: side === 'source' ? COL_SRC_X : COL_DST_X, y },
        data: {
          label: guest.name,
          vmid: guest.vmid,
          vmType: guest.type,
          status: guest.status,
          ...(guest.ips[0] ? { ip: guest.ips[0] } : {}),
          side,
          firewall: guest.firewallEnabled,
          openByDefault: isOpenByDefault(guest, side === 'source' ? 'out' : 'in'),
          selected,
          dimmed: selection !== null && !selected && !involved.has(guest.vmid),
        } satisfies MsVmNodeData,
      })
    }
  }

  const columnHeight = visible.length * (MS_VM_H + MS_GAP)
  let contentBottom = columnHeight
  let flowCount = shownFlows.length

  if (selection) {
    // Middle lane: the selection's flows, vertically centered on its card.
    const selNodeId = selection.side === 'source' ? `src-${selection.vmid}` : `dst-${selection.vmid}`
    const selY = yOf.get(selNodeId) ?? 0
    const stackHeight = (shownFlows.length + 1) * (MS_RULE_H + MS_GAP) // +1 for the add-rule card
    let y = Math.max(0, selY + MS_VM_H / 2 - stackHeight / 2)

    // Pseudo endpoint cards (any / unresolved refs) land under the opposite lane.
    let pseudoY = columnHeight
    const pseudoSeen = new Set<string>()

    for (const [flowIndex, flow] of shownFlows.entries()) {
      const flowNodeId = `flow-${flowIndex}`

      nodes.push({
        id: flowNodeId,
        type: 'msFlow',
        position: { x: COL_FLOW_X, y },
        data: {
          ...(flow.proto ? { proto: flow.proto } : {}),
          ...(flow.dport ? { dport: flow.dport } : {}),
          ...(flow.macro ? { macro: flow.macro } : {}),
          origins: flow.origins.map(o => ({ ...o, name: nameByVmid.get(o.vmid) ?? String(o.vmid) })),
        } satisfies MsFlowNodeData,
      })
      y += MS_RULE_H + MS_GAP

      const from = endpointNodeId(flow.source, 'source', flowIndex)
      const to = endpointNodeId(flow.dest, 'dest', flowIndex)
      for (const end of [from, to]) {
        if (!end.pseudo || pseudoSeen.has(end.nodeId)) continue
        pseudoSeen.add(end.nodeId)
        nodes.push({
          id: end.nodeId,
          type: 'msCard',
          position: { x: end.nodeId.startsWith('src-') ? COL_SRC_X : COL_DST_X, y: pseudoY },
          data: {
            variant: end.pseudo.variant,
            ...(end.pseudo.ref ? { ref: end.pseudo.ref } : {}),
            side: end.nodeId.startsWith('src-') ? 'source' : 'dest',
          } satisfies MsCardNodeData,
        })
        pseudoY += MS_VM_H + MS_GAP
      }

      edges.push(flowEdge(`${flowNodeId}-0`, from.nodeId, flowNodeId, colors, false))
      edges.push(flowEdge(`${flowNodeId}-1`, flowNodeId, to.nodeId, colors, false))
    }

    nodes.push({
      id: 'ms-add-rule',
      type: 'msCard',
      position: { x: COL_FLOW_X, y },
      data: { variant: 'addRule', side: 'source' } satisfies MsCardNodeData,
    })

    contentBottom = Math.max(contentBottom, y + MS_RULE_H, pseudoY)
  } else {
    // Overview: the whole traffic shape as thin guest-to-guest edges, one per
    // resolved pair, so the map reads even before anything is selected.
    const pairSeen = new Set<string>()
    for (const flow of flows) {
      if (flow.source.kind !== 'vm' || flow.dest.kind !== 'vm') continue
      if (!visibleVmids.has(flow.source.vmid) || !visibleVmids.has(flow.dest.vmid)) continue

      const pair = `${flow.source.vmid}>${flow.dest.vmid}`
      if (pairSeen.has(pair)) continue
      pairSeen.add(pair)
      edges.push(flowEdge(`ov-${pair}`, `src-${flow.source.vmid}`, `dst-${flow.dest.vmid}`, colors, true))
    }
    flowCount = flows.length

    nodes.push({
      id: 'ms-hint',
      type: 'msCard',
      position: { x: COL_FLOW_X, y: Math.max(0, columnHeight / 2 - MS_RULE_H) },
      data: { variant: 'hint', side: 'source' } satisfies MsCardNodeData,
    })
  }

  // Swim-lanes behind everything. Purely visual: pointer events off, so cards
  // stay clickable and the pane still pans wherever a lane covers it.
  const laneTop = -(MS_LANE_HEADER_H + MS_GAP)
  const laneHeight = Math.max(contentBottom, 3 * (MS_VM_H + MS_GAP)) + MS_LANE_HEADER_H + MS_GAP + MS_LANE_PAD
  const lanes: Array<{ id: string; x: number; cardW: number; data: Omit<MsLaneNodeData, 'width' | 'height'> }> = [
    { id: 'lane-src', x: COL_SRC_X, cardW: MS_VM_W, data: { labelKey: 'sourceVms', icon: 'ri-logout-circle-r-line', count: visible.length, tone: 'primary' } },
    { id: 'lane-flow', x: COL_FLOW_X, cardW: MS_RULE_W, data: { labelKey: 'allowedConnections', icon: 'ri-shield-flash-line', count: flowCount, tone: 'success' } },
    { id: 'lane-dst', x: COL_DST_X, cardW: MS_VM_W, data: { labelKey: 'destinationVms', icon: 'ri-login-circle-line', count: visible.length, tone: 'info' } },
  ]
  nodes.unshift(...lanes.map(lane => ({
    id: lane.id,
    type: 'msLane',
    position: { x: lane.x - MS_LANE_PAD, y: laneTop },
    zIndex: -10,
    selectable: false,
    style: { pointerEvents: 'none' as const },
    data: { ...lane.data, width: lane.cardW + 2 * MS_LANE_PAD, height: laneHeight } satisfies MsLaneNodeData,
  })))

  return { nodes, edges }
}
