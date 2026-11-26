'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Box, Button, Chip, Tooltip, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import type { ListSuggestionsParams } from '@/lib/microseg/api'
import type { MicrosegFlow, SuggestionAction } from '@/lib/microseg/types'
import { useLastRevisionSnapshot } from '@/lib/microseg/useLastRevision'
import { useMergedClusters } from '@/lib/microseg/useMerged'
import { useMicrosegSuggestions } from '@/lib/microseg/useMicrosegLists'
import { useCachedMicrosegStatus } from '@/lib/microseg/useMicrosegStatus'

import AssignGuestsDialog from './AssignGuestsDialog'
import { shownClusterName } from './ClusterRunRow'
import { useConnectionNodes } from './ConnectionGlyph'
import { GroupGuestsUnread } from './GroupGuestsUnread'
import { mapGuests, mapPveNodes, type ClusterNodeList, type ClusterOf } from './mapClusters'
import EdgePanel from './EdgePanel'
import GuestPanel from './GuestPanel'
import GuestViewBar from './GuestViewBar'
import { defaultCentre } from './guestViewModel'
import { EdgeVolumeContext, MapNamesContext, edgeAria, type EdgeT, type MapNames } from './FlowEdge'
import MapToolbar, { useExternalAddresses, useFlowFilters, useMapView, type MapView } from './MapToolbar'
import { SlotActions } from './microsegAccess'
import { useNamedNetworks } from './namedNetworksContext'
import SeenPeriodPicker from './SeenPeriodPicker'
import ServiceFilter from './ServiceFilter'
import { useStoredChoice } from './useStoredChoice'
import { mapViewGraph, type ShownView } from './mapViewGraph'
import { applyInsideFilters } from './nodeViewModel'
import { pairEndOf } from './pairModel'
import { buildMatrix, matrixEdge, type MatrixEnd } from './matrixModel'
import type { MicrosegSubTabProps } from './microsegTabTypes'
import { useGroupGuests, withUnreachable } from './useGroupGuests'
import { useZoneEdits } from './useZoneEdits'
import ZoneCanvas from './ZoneCanvas'
import ZoneConstellation from './ZoneConstellation'
import ZoneMatrix from './ZoneMatrix'
import ZoneSankey from './ZoneSankey'
import TargetPanel from './TargetPanel'
import TargetPicker from './TargetPicker'
import { filterCentre, filterInput, filterMarks, itemsInView, trimMatrix, type FilterItem } from './mapFilterModel'
import { targetFocus, targetRing, targetSankey, targetSuggestions, type TargetGuest } from './targetModel'
import { useMapTarget } from './useMapTarget'
import { useGuestVolume, useZoneVolume } from './useZoneVolume'
import { rangeOfPeriod } from './useEdgeVolumeHistory'
import { MapRangeContext, TrafficClustersContext } from './SelectionTraffic'
import { edgeVolumes } from './edgeVolume'
import {
  EXTERNAL_ID, OUTSIDE_ID, SEEN_PERIODS, STALE_AFTER_MS, UNZONED_ID, edgeServices, filterEdgeAge, filterEdgeServices, filterEdges, focusSets, isPveGroup, lastSeenOf, pveNodeName,
  zoneNodeId,
  type MapCluster, type MapEdgeData, type MapInput, type MapMember, type MapNodeData, type PanelEdgeData,
} from './zoneGraph'
import { zoneMembers } from './zoneModel'
import ZonePanel from './ZonePanel'

/** The whole map reads the pending observed flows (unprotected and blocked) once; the API caps a page at 200. */
const PENDING_LIMIT = 200
const PENDING_OBSERVED: ListSuggestionsParams = { status: 'pending', limit: PENDING_LIMIT }

type Selection = { kind: 'zone' | 'guest' | 'edge'; id: string }
/** The edge (or the cell of the matrix) whose flow panel is open, and the groups (zones, boundaries) of its two ends. */
type PanelEdge = { id: string; source: string; target: string; data: PanelEdgeData; groups: [string, string] }

/** The open flow panel's edge: the selected cell (its ends are groups already), else the selected edge of the canvas. */
function panelEdgeOf(cell: Omit<PanelEdge, 'groups'> | null, edge: Pick<PanelEdge, 'id' | 'source' | 'target'> & { data?: unknown } | undefined): PanelEdge | null {
  if (cell) return { ...cell, groups: [cell.source, cell.target] }
  if (!edge) return null
  const data = edge.data as MapEdgeData
  return { id: edge.id, source: edge.source, target: edge.target, data, groups: [data.fromGroup, data.toGroup] }
}

/** The node the selection lights: the circle of the selected zone, or the selected guest. */
function selectedNodeOf(selectedZone: { id: string } | null, selection: Selection | null): string | null {
  if (selectedZone) return zoneNodeId(selectedZone.id)
  return selection?.kind === 'guest' ? selection.id : null
}

const clusterNames = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

const sameFlow = (a: MicrosegFlow, b: MicrosegFlow) => a.src_zone_id === b.src_zone_id && a.src_cidr === b.src_cidr
  && a.dst_zone_id === b.dst_zone_id && a.dst_cidr === b.dst_cidr && a.proto === b.proto && a.dport === b.dport

/**
 * The Overview sub-tab: the draft as a map, in one of six renderings chosen in the toolbar (kept in the browser).
 * Groups, like the security groups view of NSX: a circle per zone holding its guests, the running guests in no zone
 * in a dashed circle, the allowed flows circle to circle, the observed ones (unprotected, blocked) guest to guest.
 * Compact zones: a box per zone, every flow zone to zone. Matrix: sources by destinations. Guest view: one zone and
 * its guests in the centre, what talks to it on the left, what it talks to on the right. Sankey: the traffic as
 * ribbons from the sources to the destinations, wider with more hits. Nodes: a circle per Proxmox node holding its
 * guests in the colour of their zone, the observed flows and the exceptions from node to node (a click on a guest
 * targets it, an edge opens no panel). Hover or select something
 * to light it and its flows; click a zone for its panel, an edge (or a cell) for its flows. A double click on a zone
 * (or the button of its panel) enters it: the canvas shows the zone alone, its guests spread out with what they
 * exchange with each other and with the rest, until "Back to the map" or another rendering is picked. Nothing polls
 * beyond the shared hooks (one inventory read per cluster, one suggestions read).
 *
 * A policy shared by several clusters draws the guests of every cluster the user sees (the inventory reads the other
 * screens of the tab already make, same keys): each guest keyed by its cluster, type and VMID, its cluster said in its
 * tooltip and on its line of the zone panel, the node view grouped per cluster. A cluster whose guests cannot be read is
 * said in one line, the others are drawn; one outside the user's scope is never read and is counted in general words.
 */
export default function ZoneMap({ connectionId, policy, reloadPolicy, goToSubTab, startRun, onOpenPlan, targetVm, pveNodes: nodeNames, pveNodeStatus, clusterIds, clusterName }: MicrosegSubTabProps) {
  const t = useTranslations('microsegPilot.overview')
  const tObs = useTranslations('microsegPilot.observation')
  const other = useTranslations('microsegPilot.plan.cluster')('other')
  // The clusters sharing the policy (the connection alone until the group is known), and those the map reads: the
  // ones the user sees, the tab's first (its read keeps the slot it had before the group was known).
  const groupIds = useMemo(() => clusterIds ?? [connectionId], [clusterIds, connectionId])
  const shared = groupIds.length > 1
  const readIds = useMemo(
    () => (shared ? [connectionId, ...groupIds.filter(id => id !== connectionId && shownClusterName(id, connectionId, clusterName) !== null)] : groupIds),
    [shared, groupIds, connectionId, clusterName],
  )
  const hiddenClusters = groupIds.length - readIds.length
  const { guests, status: guestsStatus, errors: readErrors } = useGroupGuests(readIds)
  // The statuses the banner reads, from its cache (no request of their own): a cluster it says unreachable that lists
  // no guest is one whose guests are missing.
  const { byCluster: statuses } = useMergedClusters(shared ? readIds : [], useCachedMicrosegStatus)
  const guestErrors = useMemo(() => (shared ? withUnreachable(readErrors, guests, statuses) : readErrors), [shared, readErrors, guests, statuses])
  // The name of a cluster on the map: general words for one outside the user's scope, never its ID.
  const memberCluster = useMemo(() => (shared ? (id: string) => shownClusterName(id, connectionId, clusterName, other) : undefined), [shared, connectionId, clusterName, other])
  const clusterOf = useMemo<ClusterOf>(() => (memberCluster ? (id: string): MapCluster => ({ id, name: memberCluster(id) }) : null), [memberCluster])
  // The node lists the page read for its connections (no request of their own): the other clusters' nodes and states.
  const connectionNodes = useConnectionNodes()
  const suggestions = useMicrosegSuggestions(connectionId, PENDING_OBSERVED)
  const { revision } = useLastRevisionSnapshot(connectionId, policy.pending_changes ? policy.last_revision?.id : null)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  const [keyFocus, setKeyFocus] = useState<string | null>(null)
  // The selected zone or guest whose other flows were asked back ("Show all flows"): forgotten with the selection.
  const [allFlowsFor, setAllFlowsFor] = useState<string | null>(null)
  const [assigning, setAssigning] = useState(false)
  const [resolved, setResolved] = useState<SuggestionAction | null>(null)
  const [filters, setFilters] = useFlowFilters()
  const [addresses, setAddresses] = useExternalAddresses()
  // How far back the observed flows drawn go; the clock moves every minute, so a flow fades or leaves on its own.
  const [seenPeriod, setSeenPeriod] = useStoredChoice('microseg.map.seen', SEEN_PERIODS, 'all')
  // What sFlow measured between the zones over that period, summed over the clusters of the policy (Open vSwitch only).
  const volume = useZoneVolume(connectionId, readIds, seenPeriod)
  // The labels of the edges between zones keep room for their volume gauge once sFlow is known to measure the map.
  const measured = !!volume?.covered
  // The same volume by pair of guests, for the edges drawn from a guest to a guest: read once sFlow measures the map.
  const guestVolume = useGuestVolume(connectionId, readIds, seenPeriod, measured)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])
  // The services not drawn on the canvas (the matrix and the Sankey diagram draw every one).
  const [hiddenServices, setHiddenServices] = useState<ReadonlySet<string>>(() => new Set())
  const edits = useZoneEdits({ connectionId, policy, reloadPolicy, startRun, onOpenPlan, clusterName })
  const [view, setView] = useMapView()
  const [centre, setCentre] = useState<string | null>(null)
  // The zone that was entered (a double click on it): the canvas shows its inside until the way back, without
  // changing the rendering kept in the browser. A zone deleted meanwhile brings the map back.
  const [inside, setInside] = useState<string | null>(null)

  const { zones, flows, exceptions, pending_members: pendingMembers } = policy
  const tagPrefix = policy.policy.tag_prefix
  const membersByZone = useMemo(
    () => new Map(zones.map(z => [z.id, zoneMembers(z, tagPrefix, guests, pendingMembers, zones)])),
    [zones, tagPrefix, guests, pendingMembers],
  )
  const membersKnown = guestsStatus === 'ready'
  const zonesById = useMemo(() => new Map(zones.map(z => [z.id, z])), [zones])
  const zoneName = useCallback((zoneId: string) => zonesById.get(zoneId)?.name, [zonesById])
  const insideZone = inside ? zonesById.get(inside) ?? null : null
  const shown: ShownView = insideZone ? 'inside' : view

  // The flows of the draft that the last applied revision does not have (null: not known yet, nothing marked).
  const unapplied = useMemo<ReadonlySet<string> | null>(() => {
    if (!policy.pending_changes) return null
    if (!policy.last_revision) return new Set(flows.map(f => f.id))
    const snapshot = revision?.snapshot
    if (!snapshot) return null
    const before = new Map(snapshot.flows.map(f => [f.id, f]))
    return new Set(flows.filter(f => !before.has(f.id) || !sameFlow(before.get(f.id)!, f)).map(f => f.id))
  }, [policy.pending_changes, policy.last_revision, revision, flows])

  // The clusters of a shared policy, the tab's first, then by name: the node view groups their nodes in this order.
  const clusters = useMemo(() => (clusterOf
    ? readIds.map(clusterOf).sort((a, b) => Number(b.id === connectionId) - Number(a.id === connectionId) || clusterNames.compare(a.name, b.name) || a.id.localeCompare(b.id))
    : null), [clusterOf, readIds, connectionId])
  // What the map is filtered on (guests, zones, Proxmox nodes, clusters); one guest alone is its target.
  const filterScope = useMemo(() => ({ zones, clusters }), [zones, clusters])
  const mapTarget = useMapTarget(guests, membersByZone, targetVm, shared, filterScope)
  const { target, filter: mapFilter } = mapTarget
  const networks = useNamedNetworks()
  const input = useMemo<MapInput>(() => {
    const drawn = membersKnown ? mapGuests(membersByZone, guests, clusterOf) : null
    // The nodes of the node view: those the page knows and those of the guests, each with every guest it holds; on a
    // shared policy per cluster read (the tab's nodes from the page, the others' from the page's node lists).
    const own: ClusterNodeList = { id: connectionId, nodes: nodeNames, status: pveNodeStatus }
    const lists: ClusterNodeList[] = clusters
      ? clusters.filter(c => !(c.id in guestErrors)).map(c => {
        const read = connectionNodes[c.id]
        if (c.id === connectionId && nodeNames) return own
        return { id: c.id, nodes: read?.map(n => n.node), status: Object.fromEntries((read ?? []).flatMap(n => (n.status ? [[n.node, n.status]] : []))) }
      })
      : [own]
    const pveNodes = membersKnown ? mapPveNodes(guests, lists, !!clusters) : null
    return {
      zones, flows, suggestions: suggestions.data ?? [], members: drawn?.members ?? null, unzoned: drawn?.unzoned ?? null, unapplied, exceptions, pveNodes, networks,
      ...(clusters ? { clusters } : {}),
      gauges: measured,
    }
  }, [zones, flows, suggestions.data, membersByZone, membersKnown, guests, unapplied, exceptions, nodeNames, pveNodeStatus, clusterOf, clusters, connectionId, guestErrors, connectionNodes, networks, measured])
  // The zone of the guest view: the one picked, else (or once it is deleted) the one with the most observed traffic.
  const centreId = useMemo(
    () => (centre && zonesById.has(centre) ? centre : defaultCentre(zones, input.suggestions)),
    [centre, zonesById, zones, input.suggestions],
  )
  // Once the guest view has found its zone (the observed flows are read), it keeps it: a refresh does not move it.
  const centreKnown = shown === 'guests' && !centre && !!suggestions.data && !!centreId
  useEffect(() => {
    if (!centreKnown) return
    const timer = setTimeout(() => setCentre(centreId), 0)
    return () => clearTimeout(timer)
  }, [centreKnown, centreId])
  // Each guest targeted puts its zone in the centre of the guest view (the admin can still move it afterwards; the
  // next guest targeted, even in the same zone, brings it back).
  const targetKey = target?.key ?? null
  const targetZone = target?.zoneId ?? null
  useEffect(() => {
    if (!targetKey || !targetZone) return
    const timer = setTimeout(() => setCentre(targetZone), 0)
    return () => clearTimeout(timer)
  }, [targetKey, targetZone])
  // The matrix holds the pairs of the matrix and of the Sankey diagram (their flow panel).
  // A filter reduces the map to what it keeps, before any rendering lays it out; one guest alone is the target:
  // the map stays whole, focused on it. The panels keep reading the whole policy.
  const filtering = !!mapFilter && !mapFilter.single
  const shownInput = useMemo(() => (mapFilter && filtering ? filterInput(input, mapFilter) : input), [input, mapFilter, filtering])
  const matrix = useMemo(() => {
    if (shown !== 'matrix' && shown !== 'sankey') return null
    const built = buildMatrix(shownInput)
    return filtering ? trimMatrix(built) : built
  }, [shown, shownInput, filtering])
  // The Sankey diagram lays the pairs out itself, for the size of the map box.
  const sankey = shown === 'sankey' ? matrix : null
  // The guest view of a filtered map is centred on a zone the filter keeps.
  const keptCentre = !filtering || shownInput.zones.some(z => z.id === centreId) ? centreId : shownInput.zones[0]?.id ?? null
  const drawnCentre = insideZone ? insideZone.id : keptCentre
  const drawn = useMemo(() => mapViewGraph(shown, shownInput, drawnCentre, addresses), [shown, shownInput, drawnCentre, addresses])
  // The circle of a Proxmox node counts the flows inside it for the kinds the checkboxes show.
  const graph = useMemo(() => (shown === 'nodes' ? applyInsideFilters(drawn, filters) : drawn), [shown, drawn, filters])
  const sankeyTarget = useMemo(
    () => (target && matrix && sankey ? targetSankey(matrix, filters, target) : null),
    [target, matrix, sankey, filters],
  )

  // Inside an entered zone, the list of the filter offers what the map draws around it (the map of the zone before any
  // filter: a pick never hides what can still be added); on the whole map, everything.
  const filterOptions = useMemo(
    () => (insideZone ? itemsInView(mapTarget.items, mapViewGraph('inside', input, insideZone.id, addresses), insideZone.id) : mapTarget.items),
    [insideZone, mapTarget.items, input, addresses],
  )

  // A zone deleted from the draft (or an edge gone after a reload) simply closes its panel.
  const selectedZone = selection?.kind === 'zone' ? zones.find(z => z.id === selection.id) ?? null : null
  // The flow panel: the selected cell of the matrix, or the selected edge of the canvas.
  const graphEdge = graph.edges.find(e => selection?.kind === 'edge' && e.id === selection.id)
  const cellEdge = matrix && selection?.kind === 'edge' ? matrixEdge(matrix, selection.id, filters, unapplied) : null
  // An edge of the node view links two Proxmox nodes, not two zones: it is lit, it opens no flow panel.
  const selectedEdge = shown === 'nodes' ? null : panelEdgeOf(cellEdge, graphEdge)
  const selectedNode = selectedNodeOf(selectedZone, selection)
  const selectedFocus = selectedNode ?? (selection?.kind === 'edge' ? selection.id : null)
  const focusId = hover ?? keyFocus ?? selectedFocus
  // A target locks the focus on its guest: the pointer, the keyboard and the selection do not move it.
  const lock = useMemo(() => targetFocus(graph, target), [graph, target])
  // With what they exchange with on the map too, what was picked is ringed: it tells the picks from their peers.
  const marks = useMemo(() => {
    if (!mapFilter || !filtering || mapFilter.between) return null
    const ringOf = (zoneId: string | null) => (zoneId ? zonesById.get(zoneId)?.color ?? '' : '')
    return filterMarks(graph, mapFilter, ringOf)
  }, [mapFilter, filtering, graph, zonesById])
  const lit = useMemo(() => lock ?? focusSets(graph, focusId), [lock, graph, focusId])
  // A selected zone or guest isolates its flows: the others are not drawn, so that a dense map reads zone by zone.
  const isolating = !lock && !!selectedNode && allFlowsFor !== selectedNode
  const isolated = useMemo(() => (isolating ? focusSets(graph, selectedNode) : null), [isolating, graph, selectedNode])

  const tNode = useTranslations('microsegPilot.overview.node')
  const tEdge = useTranslations('microsegPilot.overview.edge')
  const nameOf = useCallback((nodeId: string) => {
    // A Proxmox node of a shared policy says its cluster: two clusters may each have a "pve1".
    const pveName = (id: string) => {
      const d = graph.nodes.find(n => n.id === id)?.data as unknown as MapNodeData | undefined
      return d?.kind === 'pveNode' && d.cluster ? `${d.node} (${d.cluster.name})` : pveNodeName(id)
    }
    if (nodeId === EXTERNAL_ID) return tNode('external')
    if (nodeId === OUTSIDE_ID) return tNode('outside')
    if (nodeId.startsWith('zone:')) return zonesById.get(nodeId.slice(5))?.name ?? nodeId
    if (nodeId.startsWith('ip:')) return nodeId.slice(3)
    if (isPveGroup(nodeId)) return pveName(nodeId)
    const node = graph.nodes.find(n => n.id === nodeId)
    const d = node?.data as unknown as MapNodeData | undefined
    if (!d) return nodeId
    const zoneGroupName = (groupId: string) => (groupId === UNZONED_ID ? tNode('unzoned', { count: (graph.nodes.find(n => n.id === UNZONED_ID)?.data as { count?: number } | undefined)?.count ?? 0 }) : zonesById.get(groupId)?.name ?? groupId)
    const groupName = (groupId: string) => (isPveGroup(groupId) ? pveName(groupId) : zoneGroupName(groupId))
    if (d.kind === 'guest') return `${d.member.name} (${groupName(d.groupId)})`
    if (d.kind === 'more') return `+${d.count} (${groupName(d.groupId)})`
    if (d.kind === 'unzoned') return tNode('unzoned', { count: d.count })
    return nodeId
  }, [graph.nodes, zonesById, tNode])
  const names = useMemo<MapNames>(() => ({
    zone: id => zonesById.get(id)?.name ?? id,
    end: nameOf,
    short: (nodeId: string) => {
      const d = graph.nodes.find(n => n.id === nodeId)?.data as unknown as MapNodeData | undefined
      if (d?.kind === 'guest') return d.member.name
      if (d?.kind === 'more') return `+${d.count}`
      return nameOf(nodeId)
    },
  }), [zonesById, nameOf, graph.nodes])

  const targetColor = targetRing(target, zonesById)
  const targetFlowCount = useMemo(() => (target ? targetSuggestions(input.suggestions, target).length : 0), [target, input.suggestions])
  const nodes = useMemo(() => graph.nodes.map(n => {
    // The frame of a cluster on the node view is context: never lit, dimmed or faint.
    if ((n.data as unknown as MapNodeData).kind === 'pveCluster') return n
    if (lock && n.id === lock.node) return { ...n, selected: n.id === selectedNode, className: 'microseg-target', data: { ...n.data, target: targetColor } }
    // A pick among its peers is ringed: a guest in the colour of its zone, a zone in its own.
    if (marks?.has(n.id)) return { ...n, selected: n.id === selectedNode, className: 'microseg-target', data: { ...n.data, target: marks.get(n.id) } }
    const selected = n.id === selectedNode
    const dimmed = (!!lit && !lit.nodes.has(n.id)) || (!!isolated && !isolated.nodes.has(n.id))
    // A target keeps its zone and the zones of its pairs; the others are a faint outline.
    const faint = !!lock?.faintNodes.has(n.id)
    if (!selected && !dimmed) return n
    let className: string | undefined
    if (dimmed) className = faint ? 'microseg-faint' : 'microseg-dim'
    return { ...n, selected, className }
  }), [graph.nodes, selectedNode, lit, isolated, lock, targetColor, marks])

  const services = useMemo(() => edgeServices(graph.edges), [graph.edges])
  const shownServices = useMemo(() => {
    const shown = services.filter(s => !hiddenServices.has(s.token)).map(s => s.token)
    return shown.length === services.length ? null : new Set(shown)
  }, [services, hiddenServices])
  // The edges take no focus, but a screen reader names them: "web to db: tcp/443".
  const filteredEdges = useMemo(
    () => filterEdgeAge(filterEdgeServices(filterEdges(graph.edges, filters), shownServices), seenPeriod, now).filter(e => !isolated || isolated.edges.has(e.id)),
    [graph.edges, filters, shownServices, seenPeriod, now, isolated],
  )
  // Where the volume read starts: a flow last refused before it shows none of that volume.
  const volumeSince = useMemo(() => { const at = volume ? Date.parse(volume.from) : NaN; return Number.isFinite(at) ? at : undefined }, [volume])
  const sankeyVolume = useMemo(() => (volume?.covered ? { rows: volume.buckets, zoneName, since: volumeSince } : null), [volume, zoneName, volumeSince])
  // The sFlow volume of the edges between zones over the period of the map: the totals already read, no request per edge.
  // The guest a node of the map stands for: its VMID in its cluster (the last part of its id is the guest's key).
  const guestRefs = useMemo(() => {
    const refs = new Map<string, { conn: string; vmid: number }>()
    const add = (m: MapMember) => refs.set(m.key, { conn: m.cluster?.id ?? connectionId, vmid: m.vmid })
    for (const list of input.members?.values() ?? []) list.forEach(add)
    input.unzoned?.forEach(add)
    return refs
  }, [input.members, input.unzoned, connectionId])
  const guestVolumes = useMemo(
    () => ({ rows: guestVolume, of: (nodeId: string) => (nodeId.startsWith('guest:') ? guestRefs.get(nodeId.slice(nodeId.lastIndexOf(':') + 1)) : undefined) }),
    [guestVolume, guestRefs],
  )
  const volumes = useMemo(
    () => (volume?.covered ? edgeVolumes(filteredEdges, volume.buckets, zoneName, guestVolumes, volumeSince) : null),
    [volume, filteredEdges, zoneName, guestVolumes, volumeSince],
  )
  // What the tooltip of an edge reads its volume chart with, once sFlow is known to measure the map.
  const volumeSource = useMemo(() => (measured ? { clusterIds: readIds.length ? readIds : [connectionId], period: seenPeriod, zoneName } : null), [measured, readIds, connectionId, seenPeriod, zoneName])
  const edges = useMemo(() => filteredEdges.map(e => {
    const d = e.data as unknown as MapEdgeData
    const dimmed = !!lit && !lit.edges.has(e.id)
    let className: string | undefined
    const seenAt = lastSeenOf(d)
    if (lock?.faintEdges.has(e.id)) className = 'microseg-faint'
    else if (dimmed) className = 'microseg-dim'
    else if (seenAt !== null && now - seenAt > STALE_AFTER_MS) className = 'microseg-stale'
    const measured = volumes?.get(e.id)
    return {
      ...e,
      className,
      ariaLabel: edgeAria(tEdge as EdgeT, names, e.source, e.target, d),
      data: { ...e.data, ...(dimmed ? { dimmed } : {}), volume: measured?.figure ?? null, volumeLevel: measured?.level ?? 0, volumeShared: measured?.shared ?? false, volumeUntold: measured?.untold ?? false, volumeRules: measured?.rules, volumePair: measured?.pair ?? null, volumeGuest: measured?.guest },
    }
  }), [filteredEdges, volumes, now, lit, lock, tEdge, names])

  // In the guest view another zone is not opened but put in the centre; the zone in the centre opens its panel.
  const selectZone = useCallback((zoneId: string) => {
    setResolved(null)
    if (shown === 'guests' && zoneId !== centreId) {
      setCentre(zoneId)
      setSelection(null)
      setHover(null)
      return
    }
    setSelection({ kind: 'zone', id: zoneId })
  }, [shown, centreId])
  // A zone is entered (double click, or the button of its panel): its panel is open, the canvas shows its inside.
  const enterZone = useCallback((zoneId: string) => {
    setResolved(null)
    setInside(zoneId)
    setSelection({ kind: 'zone', id: zoneId })
    setHover(null)
    setKeyFocus(null)
  }, [])
  // Back to the map the zone was entered from: its panel stays open.
  const leaveZone = useCallback(() => {
    setInside(null)
    setSelection(s => (s?.kind === 'zone' ? s : null))
    setHover(null)
    setKeyFocus(null)
  }, [])
  // A zone panel stays open across renderings; an edge, a cell or a guest belongs to the rendering it was picked in.
  const changeView = useCallback((next: MapView) => {
    setView(next)
    setInside(null)
    setSelection(s => (s?.kind === 'zone' ? s : null))
    setHover(null)
    setKeyFocus(null)
  }, [setView])
  const changeCentre = useCallback((zoneId: string) => {
    setCentre(zoneId)
    setSelection(s => (s?.kind === 'zone' ? s : null))
  }, [])
  const endName = useCallback((e: Pick<MatrixEnd, 'kind' | 'zone'>) => e.zone?.name ?? tNode(e.kind === 'outside' ? 'outside' : 'external'), [tNode])
  const selectEdge = useCallback((edgeId: string) => { setSelection({ kind: 'edge', id: edgeId }); setResolved(null) }, [])
  const clear = useCallback(() => setSelection(null), [])
  // A guest picked (or cleared): its panel replaces the open one; a zone or an edge picked afterwards keeps the lock.
  const { pick, showPanel, hidePanel } = mapTarget
  const changeTarget = useCallback((next: TargetGuest | null) => {
    pick(next)
    // A target is followed on the map itself, not inside a zone.
    if (next) setInside(null)
    setSelection(null)
    setResolved(null)
  }, [pick])
  // The picks of the filter changed: like a target, a filter is followed on the map itself, and it replaces the open panel.
  const { pickItems } = mapTarget
  const changeFilter = useCallback((next: FilterItem[]) => {
    pickItems(next)
    if (next.length > 0) setInside(null)
    // Like a target, a filter puts its zone in the centre of the guest view (the admin can still move it afterwards).
    const zone = filterCentre(next)
    if (zone) setCentre(zone)
    setSelection(null)
    setResolved(null)
  }, [pickItems])
  // The status of a Proxmox node, for its glyph in the filter: what the page read of the nodes of each cluster.
  const nodeStatusOf = useCallback((cluster: string, node: string) => {
    if (cluster === connectionId && pveNodeStatus?.[node]) return pveNodeStatus[node]
    return connectionNodes[cluster]?.find(n => n.node === node)?.status
  }, [connectionId, pveNodeStatus, connectionNodes])
  const showTarget = useCallback(() => { showPanel(); setSelection(null) }, [showPanel])
  // A guest of the node view has no edge of its own to isolate: a click targets it (its panel opens, the map locks on it).
  const { candidates } = mapTarget
  const selectGuest = useCallback((nodeId: string) => {
    if (shown !== 'nodes') {
      setSelection({ kind: 'guest', id: nodeId })
      return
    }
    const d = graph.nodes.find(n => n.id === nodeId)?.data as unknown as MapNodeData | undefined
    const guest = d?.kind === 'guest' ? candidates.find(c => c.key === d.member.key) : undefined
    if (guest) changeTarget(guest)
  }, [shown, graph.nodes, candidates, changeTarget])
  const openTargetZone = useCallback((zoneId: string) => { setResolved(null); setSelection({ kind: 'zone', id: zoneId }) }, [])

  if (zones.length === 0) {
    return (
      <Box sx={{ px: 3, pb: 3 }}>
        <Typography color='text.secondary' sx={{ mb: 1.5 }}>{t('empty')}</Typography>
        <Button variant='contained' size='small' startIcon={<i className='ri-add-line' />} onClick={() => goToSubTab('policy')}>{t('createZone')}</Button>
      </Box>
    )
  }

  // Some cluster's guests could not be read: the members of a zone panel are not all counted.
  const membersNote = shared && guestsStatus === 'ready' && Object.keys(guestErrors).length > 0
    ? <GroupGuestsUnread errors={guestErrors} clusterName={clusterName} counted />
    : null
  // The node view draws guests only: it says so when their list could not be read, or when there is none to draw.
  let nodesNote: 'unavailable' | 'none' | null = null
  if (shown === 'nodes' && guestsStatus === 'error') nodesNote = 'unavailable'
  else if (shown === 'nodes' && membersKnown && graph.nodes.length === 0 && !filtering) nodesNote = 'none'
  // A filter that keeps nothing of this rendering says so, instead of an empty box.
  const filterEmpty = filtering && (matrix ? matrix.cells.size === 0 && shownInput.zones.length === 0 : graph.nodes.length === 0)
  const targetPanel = !!target && mapTarget.panelOpen && !selectedZone && !selectedEdge
  // A guest clicked on the views around a zone opens its panel (its firewall log); on the node view a click targets it.
  const guestNode = selection?.kind === 'guest' && shown !== 'nodes' ? graph.nodes.find(n => n.id === selection.id)?.data as unknown as MapNodeData | undefined : undefined
  const selectedGuest = guestNode?.kind === 'guest' && !selectedZone && !selectedEdge && !targetPanel ? guestNode.member : null
  const panelOpen = !!selectedZone || !!selectedEdge || targetPanel || !!selectedGuest
  // Inside a zone every flow drawn is one of its own: the zone selected isolates nothing, so the map does not offer it.
  const insideCentreSelected = !!insideZone && selectedNode === zoneNodeId(insideZone.id)
  return (
    <Box sx={{ px: 3, pb: 3, flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1, flexWrap: 'wrap' }}>
        <Box sx={{ flex: '1 1 auto', minWidth: 0 }}>
          <MapToolbar
            view={insideZone ? null : view}
            onView={changeView}
            lead={<TargetPicker items={filterOptions} picked={mapTarget.picked} onPicked={changeFilter} zonesById={zonesById} target={target} onShowPanel={showTarget} observedCount={targetFlowCount} peers={mapTarget.withPeers} onPeers={mapTarget.setWithPeers} clusterName={memberCluster} nodeStatus={nodeStatusOf} />}
            filters={filters}
            onFilters={setFilters}
            addresses={shown === 'guests' || shown === 'inside' ? addresses : undefined}
            onAddresses={setAddresses}
          />
        </Box>
        {/* What the map keeps of the flows, on the row of the sub-tabs next to Check now (in place outside the tab). */}
        {shown !== 'matrix' && shown !== 'sankey' && (
          <SlotActions order={1}>
            <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
              <ServiceFilter services={services} hidden={hiddenServices} onHidden={setHiddenServices} />
              <SeenPeriodPicker period={seenPeriod} onPeriod={setSeenPeriod} />
            </Box>
          </SlotActions>
        )}
        {policy.pending_changes && (
          <Tooltip title={t('unappliedHint')}>
            <Chip size='small' color='warning' variant='outlined' icon={<i className='ri-edit-circle-line' />} label={t('unapplied')} />
          </Tooltip>
        )}
      </Box>
      {shared && guestsStatus !== 'loading' && Object.keys(guestErrors).length > 0 && (
        <Box sx={{ mb: 1, minWidth: 0 }}><GroupGuestsUnread errors={guestErrors} clusterName={clusterName} /></Box>
      )}
      {hiddenClusters > 0 && (
        <Typography noWrap variant='body2' color='text.secondary' data-testid='map-hidden-clusters' sx={{ mb: 1, minWidth: 0 }}>
          {t('hiddenClusters', { count: hiddenClusters })}
        </Typography>
      )}
      {suggestions.error && !suggestions.data && (
        <Alert severity='warning' sx={{ mb: 1 }}>{t('suggestionsError')}</Alert>
      )}
      {(suggestions.data?.length ?? 0) >= PENDING_LIMIT && (
        <Alert severity='info' sx={{ mb: 1 }}>{t('partial', { count: PENDING_LIMIT })}</Alert>
      )}
      {resolved && (
        <Alert severity='success' onClose={() => setResolved(null)} sx={{ mb: 1 }}>
          {tObs(resolved === 'dismiss' ? 'resolvedDismiss' : 'resolvedAccept', { count: 1 })}
        </Alert>
      )}
      {shown === 'guests' && (
        <GuestViewBar zones={shownInput.zones} suggestions={input.suggestions} centre={keptCentre} onCentre={changeCentre} />
      )}
      <MapNamesContext.Provider value={names}>
      <EdgeVolumeContext.Provider value={volumeSource}>
      <MapRangeContext.Provider value={rangeOfPeriod(seenPeriod)}>
      <TrafficClustersContext.Provider value={readIds}>
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'stretch', flexWrap: { xs: 'wrap', lg: 'nowrap' }, flex: 1, minHeight: 560 }}>
          <Box
            role='region'
            aria-label={t('mapLabel')}
            sx={{ position: 'relative', flex: '1 1 0', minWidth: 0, width: '100%', minHeight: 560, border: 1, borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}
          >
            {sankey && (
              <ZoneSankey
                model={sankey}
                filters={filters}
                selectedCell={selectedEdge?.id ?? null}
                selectedZone={selectedZone ? selectedNode : null}
                onSelectCell={selectEdge}
                onSelectZone={selectZone}
                names={{ end: endName }}
                target={sankeyTarget}
                volume={sankeyVolume}
              />
            )}
            {matrix && !sankey && (
              <ZoneMatrix
                model={matrix}
                filters={filters}
                unapplied={unapplied}
                selectedCell={selectedEdge?.id ?? null}
                selectedZone={selectedZone ? selectedNode : null}
                narrow={panelOpen}
                onSelectCell={selectEdge}
                onSelectZone={selectZone}
                names={{ end: endName }}
                target={target}
                volume={sankeyVolume}
              />
            )}
            {/* Top left of the map: the way out of an entered zone, then what the selection isolates. */}
            <Box sx={{ position: 'absolute', top: 8, left: 8, zIndex: 6, display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', maxWidth: 'calc(100% - 16px)', pointerEvents: 'none', '& > *': { pointerEvents: 'auto' } }}>
              {insideZone && (
                <Button data-testid='zone-inside-back' variant='outlined' size='small' startIcon={<i className='ri-arrow-left-line' />} onClick={leaveZone} sx={{ flexShrink: 0, bgcolor: 'background.paper', boxShadow: 1 }}>
                  {t('inside.back')}
                </Button>
              )}
              {!matrix && !lock && selectedNode && !insideCentreSelected && (
                <Box
                  data-testid='map-isolation'
                  sx={{ display: 'flex', alignItems: 'center', gap: 0.5, pl: 1.5, pr: 0.5, py: 0.25, bgcolor: 'background.paper', border: 1, borderColor: 'divider', borderRadius: 5, boxShadow: 1 }}
                >
                  <Typography variant='caption' sx={{ fontWeight: 600 }}>{isolating ? t('isolate.only', { name: names.end(selectedNode) }) : t('isolate.all')}</Typography>
                  <Button size='small' onClick={() => setAllFlowsFor(isolating ? selectedNode : null)} sx={{ minHeight: 0, py: 0.25, textTransform: 'none' }}>
                    {isolating ? t('isolate.showAll') : t('isolate.showOnly')}
                  </Button>
                </Box>
              )}
            </Box>
            {filterEmpty && (
              <Typography data-testid='map-filter-empty' color='text.secondary' sx={{ position: 'absolute', inset: 0, zIndex: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2, textAlign: 'center', pointerEvents: 'none' }}>
                {t('target.empty')}
              </Typography>
            )}
            {nodesNote && (
              <Typography color='text.secondary' sx={{ position: 'absolute', inset: 0, zIndex: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2, textAlign: 'center', pointerEvents: 'none' }}>
                {t(`pve.${nodesNote}`)}
              </Typography>
            )}
            {!matrix && view === 'constellation' && (
              <ZoneConstellation
                nodes={nodes}
                edges={edges}
                onSelectZone={selectZone}
                onEnterZone={enterZone}
                onSelectGuest={selectGuest}
                onSelectEdge={selectEdge}
                onHover={setHover}
                onFocusNode={setKeyFocus}
                onClear={clear}
              />
            )}
            {!matrix && view !== 'constellation' && (
              <ZoneCanvas
                nodes={nodes}
                edges={edges}
                onSelectZone={selectZone}
                onEnterZone={enterZone}
                onSelectGuest={selectGuest}
                onSelectEdge={selectEdge}
                onHover={setHover}
                onFocusNode={setKeyFocus}
                onClear={clear}
                panelOpen={panelOpen}
                fitTo={lock?.fit ?? null}
              />
            )}
          </Box>
          {selectedZone && (
            <ZonePanel
              key={selectedZone.id}
              zone={selectedZone}
              members={membersByZone.get(selectedZone.id) ?? []}
              membersKnown={membersKnown}
              flows={flows}
              zonesById={zonesById}
              edits={edits}
              onClose={clear}
              onAssign={() => setAssigning(true)}
              onInside={insideZone?.id === selectedZone.id ? undefined : () => enterZone(selectedZone.id)}
              connectionId={connectionId}
              clusterName={memberCluster}
              membersNote={membersNote}
              version={policy.version}
              suggestions={input.suggestions}
              reloadPolicy={reloadPolicy}
              reloadSuggestions={suggestions.reload}
              onResolved={setResolved}
              onOpenDrifts={zoneId => goToSubTab('drifts', { zoneId })}
              partialLimit={(suggestions.data?.length ?? 0) >= PENDING_LIMIT ? PENDING_LIMIT : null}
              peers={mapTarget.peers}
            />
          )}
          {targetPanel && target && (
            <TargetPanel
              key={target.id}
              target={target}
              zonesById={zonesById}
              suggestions={input.suggestions}
              flows={flows}
              peers={mapTarget.peers}
              connectionId={connectionId}
              version={policy.version}
              reloadPolicy={reloadPolicy}
              reloadSuggestions={suggestions.reload}
              onResolved={setResolved}
              onOpenZone={openTargetZone}
              onClose={hidePanel}
              partialLimit={(suggestions.data?.length ?? 0) >= PENDING_LIMIT ? PENDING_LIMIT : null}
            />
          )}
          {selectedGuest && <GuestPanel key={selectedGuest.key} guest={selectedGuest} connectionId={connectionId} onClose={clear} />}
          {selectedEdge && (
            <EdgePanel
              key={selectedEdge.id}
              source={selectedEdge.source}
              target={selectedEdge.target}
              data={selectedEdge.data}
              from={nameOf(selectedEdge.source)}
              to={nameOf(selectedEdge.target)}
              src={pairEndOf(selectedEdge.groups[0], zonesById, nameOf(selectedEdge.groups[0]))}
              dst={pairEndOf(selectedEdge.groups[1], zonesById, nameOf(selectedEdge.groups[1]))}
              zonesById={zonesById}
              flows={flows}
              suggestions={input.suggestions}
              unapplied={unapplied}
              edits={edits}
              partialLimit={(suggestions.data?.length ?? 0) >= PENDING_LIMIT ? PENDING_LIMIT : null}
              peers={mapTarget.peers}
              members={membersByZone.get(selectedEdge.groups[1].replace(/^zone:/, '')) ?? []}
              membersKnown={membersKnown}
              connectionId={connectionId}
              version={policy.version}
              reloadPolicy={reloadPolicy}
              reloadSuggestions={suggestions.reload}
              onResolved={setResolved}
              onClose={clear}
              onEdit={() => goToSubTab('policy')}
            />
          )}
        </Box>
      </TrafficClustersContext.Provider>
      </MapRangeContext.Provider>
      </EdgeVolumeContext.Provider>
      </MapNamesContext.Provider>
      {assigning && selectedZone && (
        <AssignGuestsDialog
          open
          connectionId={connectionId}
          clusterIds={readIds}
          clusterName={clusterName}
          zone={selectedZone}
          policy={policy}
          reloadPolicy={reloadPolicy}
          onClose={() => setAssigning(false)}
        />
      )}
    </Box>
  )
}
