'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Box, Button, Chip, Tooltip, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import type { ListSuggestionsParams } from '@/lib/microseg/api'
import type { MicrosegFlow, SuggestionAction } from '@/lib/microseg/types'
import { useLastRevisionSnapshot } from '@/lib/microseg/useLastRevision'
import { useMicrosegSuggestions } from '@/lib/microseg/useMicrosegLists'

import AssignGuestsDialog from './AssignGuestsDialog'
import EdgePanel from './EdgePanel'
import GuestViewBar from './GuestViewBar'
import { defaultCentre } from './guestViewModel'
import { MapNamesContext, edgeAria, type EdgeT, type MapNames } from './FlowEdge'
import MapToolbar, { useFlowFilters, useMapView, type MapView } from './MapToolbar'
import { mapViewGraph } from './mapViewGraph'
import { buildMatrix, matrixEdge, type MatrixEnd } from './matrixModel'
import type { MicrosegSubTabProps } from './microsegTabTypes'
import { useZoneEdits } from './useZoneEdits'
import { useZoneGuests } from './useZoneGuests'
import ZoneCanvas from './ZoneCanvas'
import ZoneMatrix from './ZoneMatrix'
import ZoneSankey from './ZoneSankey'
import TargetPanel from './TargetPanel'
import TargetPicker from './TargetPicker'
import { targetFocus, targetRing, targetSankey, targetSuggestions, type TargetGuest } from './targetModel'
import { useMapTarget } from './useMapTarget'
import {
  EXTERNAL_ID, OUTSIDE_ID, UNZONED_ID, filterEdges, focusSets, zoneNodeId,
  type MapEdgeData, type MapInput, type MapMember, type MapNodeData, type PanelEdgeData,
} from './zoneGraph'
import { guestKey, zoneMembers, type PolicyGuest, type ZoneMember } from './zoneModel'
import ZonePanel from './ZonePanel'

/** The whole map reads the pending observed flows (unprotected and blocked) once; the API caps a page at 200. */
const PENDING_LIMIT = 200
const PENDING_OBSERVED: ListSuggestionsParams = { status: 'pending', limit: PENDING_LIMIT }

type Selection = { kind: 'zone' | 'guest' | 'edge'; id: string }
/** The edge (or the cell of the matrix) whose flow panel is open. */
type PanelEdge = { id: string; source: string; target: string; data: PanelEdgeData }

/** The node the selection lights: the circle of the selected zone, or the selected guest. */
function selectedNodeOf(selectedZone: { id: string } | null, selection: Selection | null): string | null {
  if (selectedZone) return zoneNodeId(selectedZone.id)
  return selection?.kind === 'guest' ? selection.id : null
}

const toMapMember = (m: ZoneMember): MapMember => ({
  key: guestKey(m.ref),
  name: m.guest?.name ?? `${m.ref.type}/${m.ref.vmid}`,
  vmid: m.ref.vmid,
  node: m.ref.node,
  type: m.ref.type,
  status: m.guest?.status ?? 'unknown',
  ips: m.guest?.ips ?? [],
  pending: m.pending,
})
const guestToMember = (g: PolicyGuest): MapMember => ({ key: guestKey(g), name: g.name, vmid: g.vmid, node: g.node, type: g.type, status: g.status, ips: g.ips ?? [], pending: false })

const sameFlow = (a: MicrosegFlow, b: MicrosegFlow) => a.src_zone_id === b.src_zone_id && a.src_cidr === b.src_cidr
  && a.dst_zone_id === b.dst_zone_id && a.dst_cidr === b.dst_cidr && a.proto === b.proto && a.dport === b.dport

/**
 * The Overview sub-tab: the draft as a map, in one of five renderings chosen in the toolbar (kept in the browser).
 * Groups, like the security groups view of NSX: a circle per zone holding its guests, the running guests in no zone
 * in a dashed circle, the allowed flows circle to circle, the observed ones (unprotected, blocked) guest to guest.
 * Compact zones: a box per zone, every flow zone to zone. Matrix: sources by destinations. Guest view: one zone and
 * its guests in the centre, what talks to it on the left, what it talks to on the right. Sankey: the traffic as
 * ribbons from the sources to the destinations, wider with more hits. Hover or select something
 * to light it and its flows; click a zone for its panel, an edge (or a cell) for its flows. Nothing polls beyond the
 * shared hooks (one inventory read, one suggestions read).
 */
export default function ZoneMap({ connectionId, policy, reloadPolicy, goToSubTab, startRun, onOpenPlan, targetVm }: MicrosegSubTabProps) {
  const t = useTranslations('microsegPilot.overview')
  const tObs = useTranslations('microsegPilot.observation')
  const { guests, status: guestsStatus, reload: reloadGuests } = useZoneGuests(connectionId)
  const suggestions = useMicrosegSuggestions(connectionId, PENDING_OBSERVED)
  const { revision } = useLastRevisionSnapshot(connectionId, policy.pending_changes ? policy.last_revision?.id : null)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  const [keyFocus, setKeyFocus] = useState<string | null>(null)
  const [assigning, setAssigning] = useState(false)
  const [resolved, setResolved] = useState<SuggestionAction | null>(null)
  const [filters, setFilters] = useFlowFilters()
  const [refreshing, setRefreshing] = useState(false)
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null)
  const edits = useZoneEdits({ connectionId, policy, reloadPolicy, startRun, onOpenPlan })
  const [view, setView] = useMapView()
  const [centre, setCentre] = useState<string | null>(null)

  const { zones, flows, pending_members: pendingMembers } = policy
  const tagPrefix = policy.policy.tag_prefix
  const membersByZone = useMemo(
    () => new Map(zones.map(z => [z.id, zoneMembers(z, tagPrefix, guests, pendingMembers, zones)])),
    [zones, tagPrefix, guests, pendingMembers],
  )
  const membersKnown = guestsStatus === 'ready'
  const zonesById = useMemo(() => new Map(zones.map(z => [z.id, z])), [zones])
  const mapTarget = useMapTarget(guests, membersByZone, targetVm)
  const { target } = mapTarget

  // The flows of the draft that the last applied revision does not have (null: not known yet, nothing marked).
  const unapplied = useMemo<ReadonlySet<string> | null>(() => {
    if (!policy.pending_changes) return null
    if (!policy.last_revision) return new Set(flows.map(f => f.id))
    const snapshot = revision?.snapshot
    if (!snapshot) return null
    const before = new Map(snapshot.flows.map(f => [f.id, f]))
    return new Set(flows.filter(f => !before.has(f.id) || !sameFlow(before.get(f.id)!, f)).map(f => f.id))
  }, [policy.pending_changes, policy.last_revision, revision, flows])

  const input = useMemo<MapInput>(() => {
    const members = membersKnown ? new Map([...membersByZone].map(([id, list]) => [id, list.map(toMapMember)])) : null
    const zoned = new Set([...membersByZone.values()].flatMap(list => list.map(m => guestKey(m.ref))))
    const unzoned = membersKnown ? guests.filter(g => g.status === 'running' && !zoned.has(guestKey(g))).map(guestToMember) : null
    return { zones, flows, suggestions: suggestions.data ?? [], members, unzoned, unapplied }
  }, [zones, flows, suggestions.data, membersByZone, membersKnown, guests, unapplied])
  // The zone of the guest view: the one picked, else (or once it is deleted) the one with the most observed traffic.
  const centreId = useMemo(
    () => (centre && zonesById.has(centre) ? centre : defaultCentre(zones, input.suggestions)),
    [centre, zonesById, zones, input.suggestions],
  )
  // Once the guest view has found its zone (the observed flows are read), it keeps it: a refresh does not move it.
  const centreKnown = view === 'guests' && !centre && !!suggestions.data && !!centreId
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
  const matrix = useMemo(() => (view === 'matrix' || view === 'sankey' ? buildMatrix(input) : null), [view, input])
  // The Sankey diagram lays the pairs out itself, for the size of the map box.
  const sankey = view === 'sankey' ? matrix : null
  const graph = useMemo(() => mapViewGraph(view, input, centreId), [view, input, centreId])
  const sankeyTarget = useMemo(
    () => (target && matrix && sankey ? targetSankey(matrix, filters, target) : null),
    [target, matrix, sankey, filters],
  )

  // "Refreshed at": the first answer, then the end of every refresh (a refresh that changes nothing still moves it).
  const loaded = !!suggestions.data || membersKnown
  useEffect(() => {
    if (!loaded || refreshedAt) return
    const timer = setTimeout(() => setRefreshedAt(new Date()), 0)
    return () => clearTimeout(timer)
  }, [loaded, refreshedAt])

  // A zone deleted from the draft (or an edge gone after a reload) simply closes its panel.
  const selectedZone = selection?.kind === 'zone' ? zones.find(z => z.id === selection.id) ?? null : null
  // The flow panel: the selected cell of the matrix, or the selected edge of the canvas.
  const graphEdge = graph.edges.find(e => selection?.kind === 'edge' && e.id === selection.id)
  const cellEdge = matrix && selection?.kind === 'edge' ? matrixEdge(matrix, selection.id, filters, unapplied) : null
  const selectedEdge: PanelEdge | null = cellEdge ?? (graphEdge ? { id: graphEdge.id, source: graphEdge.source, target: graphEdge.target, data: graphEdge.data as unknown as MapEdgeData } : null)
  const selectedNode = selectedNodeOf(selectedZone, selection)
  const selectedFocus = selectedNode ?? (selection?.kind === 'edge' ? selection.id : null)
  const focusId = hover ?? keyFocus ?? selectedFocus
  // A target locks the focus on its guest: the pointer, the keyboard and the selection do not move it.
  const lock = useMemo(() => targetFocus(graph, target), [graph, target])
  const lit = useMemo(() => lock ?? focusSets(graph, focusId), [lock, graph, focusId])

  const tNode = useTranslations('microsegPilot.overview.node')
  const tEdge = useTranslations('microsegPilot.overview.edge')
  const nameOf = useCallback((nodeId: string) => {
    if (nodeId === EXTERNAL_ID) return tNode('external')
    if (nodeId === OUTSIDE_ID) return tNode('outside')
    if (nodeId.startsWith('zone:')) return zonesById.get(nodeId.slice(5))?.name ?? nodeId
    if (nodeId.startsWith('ip:')) return nodeId.slice(3)
    const node = graph.nodes.find(n => n.id === nodeId)
    const d = node?.data as unknown as MapNodeData | undefined
    if (!d) return nodeId
    const groupName = (groupId: string) => (groupId === UNZONED_ID ? tNode('unzoned', { count: (graph.nodes.find(n => n.id === UNZONED_ID)?.data as { count?: number } | undefined)?.count ?? 0 }) : zonesById.get(groupId)?.name ?? groupId)
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
    if (lock && n.id === lock.node) return { ...n, selected: n.id === selectedNode, className: 'microseg-target', data: { ...n.data, target: targetColor } }
    const selected = n.id === selectedNode
    const dimmed = !!lit && !lit.nodes.has(n.id)
    // A target keeps its zone and the zones of its pairs; the others are a faint outline.
    const faint = !!lock?.faintNodes.has(n.id)
    if (!selected && !dimmed) return n
    let className: string | undefined
    if (dimmed) className = faint ? 'microseg-faint' : 'microseg-dim'
    return { ...n, selected, className }
  }), [graph.nodes, selectedNode, lit, lock, targetColor])

  // The edges take no focus, but a screen reader names them: "web to db: tcp/443".
  const edges = useMemo(() => filterEdges(graph.edges, filters).map(e => {
    const d = e.data as unknown as MapEdgeData
    const dimmed = !!lit && !lit.edges.has(e.id)
    let className: string | undefined
    if (lock?.faintEdges.has(e.id)) className = 'microseg-faint'
    else if (dimmed) className = 'microseg-dim'
    return {
      ...e,
      className,
      ariaLabel: edgeAria(tEdge as EdgeT, names, e.source, e.target, d),
      data: dimmed ? { ...e.data, dimmed } : e.data,
    }
  }), [graph.edges, filters, lit, lock, tEdge, names])

  // In the guest view another zone is not opened but put in the centre; the zone in the centre opens its panel.
  const selectZone = useCallback((zoneId: string) => {
    setResolved(null)
    if (view === 'guests' && zoneId !== centreId) {
      setCentre(zoneId)
      setSelection(null)
      setHover(null)
      return
    }
    setSelection({ kind: 'zone', id: zoneId })
  }, [view, centreId])
  // A zone panel stays open across renderings; an edge, a cell or a guest belongs to the rendering it was picked in.
  const changeView = useCallback((next: MapView) => {
    setView(next)
    setSelection(s => (s?.kind === 'zone' ? s : null))
    setHover(null)
    setKeyFocus(null)
  }, [setView])
  const changeCentre = useCallback((zoneId: string) => {
    setCentre(zoneId)
    setSelection(s => (s?.kind === 'zone' ? s : null))
  }, [])
  const endName = useCallback((e: Pick<MatrixEnd, 'kind' | 'zone'>) => e.zone?.name ?? tNode(e.kind === 'outside' ? 'outside' : 'external'), [tNode])
  const selectGuest = useCallback((nodeId: string) => setSelection({ kind: 'guest', id: nodeId }), [])
  const selectEdge = useCallback((edgeId: string) => { setSelection({ kind: 'edge', id: edgeId }); setResolved(null) }, [])
  const clear = useCallback(() => setSelection(null), [])
  // A guest picked (or cleared): its panel replaces the open one; a zone or an edge picked afterwards keeps the lock.
  const { pick, showPanel, hidePanel } = mapTarget
  const changeTarget = useCallback((next: TargetGuest | null) => {
    pick(next)
    setSelection(null)
    setResolved(null)
  }, [pick])
  const showTarget = useCallback(() => { showPanel(); setSelection(null) }, [showPanel])
  const openTargetZone = useCallback((zoneId: string) => { setResolved(null); setSelection({ kind: 'zone', id: zoneId }) }, [])
  const refresh = useCallback(async () => {
    setRefreshing(true)
    await Promise.all([reloadPolicy().catch(() => undefined), suggestions.reload().catch(() => undefined), reloadGuests().catch(() => undefined)])
    setRefreshedAt(new Date())
    setRefreshing(false)
  }, [reloadPolicy, suggestions, reloadGuests])

  if (zones.length === 0) {
    return (
      <Box sx={{ px: 3, pb: 3 }}>
        <Typography color='text.secondary' sx={{ mb: 1.5 }}>{t('empty')}</Typography>
        <Button variant='contained' size='small' startIcon={<i className='ri-add-line' />} onClick={() => goToSubTab('policy')}>{t('createZone')}</Button>
      </Box>
    )
  }

  const targetPanel = !!target && mapTarget.panelOpen && !selectedZone && !selectedEdge
  const panelOpen = !!selectedZone || !!selectedEdge || targetPanel
  return (
    <Box sx={{ px: 3, pb: 3, flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1, flexWrap: 'wrap' }}>
        <Box sx={{ flex: '1 1 auto', minWidth: 0 }}>
          <MapToolbar
            view={view}
            onView={changeView}
            lead={<TargetPicker candidates={mapTarget.candidates} zonesById={zonesById} target={target} onTarget={changeTarget} onShowPanel={showTarget} observedCount={targetFlowCount} />}
            filters={filters}
            onFilters={setFilters}
            refreshedAt={refreshedAt}
            refreshing={refreshing}
            onRefresh={refresh}
          />
        </Box>
        {policy.pending_changes && (
          <Tooltip title={t('unappliedHint')}>
            <Chip size='small' color='warning' variant='outlined' icon={<i className='ri-edit-circle-line' />} label={t('unapplied')} />
          </Tooltip>
        )}
      </Box>
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
      {view === 'guests' && (
        <GuestViewBar zones={zones} suggestions={input.suggestions} centre={centreId} onCentre={changeCentre} />
      )}
      <MapNamesContext.Provider value={names}>
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'stretch', flexWrap: { xs: 'wrap', lg: 'nowrap' }, flex: 1, minHeight: 560 }}>
          <Box
            role='region'
            aria-label={t('mapLabel')}
            sx={{ flex: '1 1 0', minWidth: 0, width: '100%', minHeight: 560, border: 1, borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}
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
              />
            )}
            {!matrix && (
              <ZoneCanvas
                nodes={nodes}
                edges={edges}
                onSelectZone={selectZone}
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
              connectionId={connectionId}
              version={policy.version}
              suggestions={input.suggestions}
              reloadPolicy={reloadPolicy}
              reloadSuggestions={suggestions.reload}
              onResolved={setResolved}
              onOpenDrifts={zoneId => goToSubTab('drifts', { zoneId })}
              partialLimit={(suggestions.data?.length ?? 0) >= PENDING_LIMIT ? PENDING_LIMIT : null}
            />
          )}
          {targetPanel && target && (
            <TargetPanel
              key={target.key}
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
          {selectedEdge && (
            <EdgePanel
              key={selectedEdge.id}
              edgeId={selectedEdge.id}
              source={selectedEdge.source}
              target={selectedEdge.target}
              data={selectedEdge.data}
              from={nameOf(selectedEdge.source)}
              to={nameOf(selectedEdge.target)}
              zonesById={zonesById}
              unapplied={unapplied}
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
      </MapNamesContext.Provider>
      {assigning && selectedZone && (
        <AssignGuestsDialog
          open
          connectionId={connectionId}
          zone={selectedZone}
          policy={policy}
          reloadPolicy={reloadPolicy}
          onClose={() => setAssigning(false)}
        />
      )}
    </Box>
  )
}
