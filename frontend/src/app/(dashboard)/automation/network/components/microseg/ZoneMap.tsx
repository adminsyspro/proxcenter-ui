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
import { MapNamesContext, edgeAria, type EdgeT, type MapNames } from './FlowEdge'
import MapToolbar, { useFlowFilters } from './MapToolbar'
import type { MicrosegSubTabProps } from './microsegTabTypes'
import { useZoneEdits } from './useZoneEdits'
import { useZoneGuests } from './useZoneGuests'
import ZoneCanvas from './ZoneCanvas'
import {
  EXTERNAL_ID, OUTSIDE_ID, UNZONED_ID, buildZoneGraph, filterEdges, focusSets, zoneNodeId,
  type MapEdgeData, type MapMember, type MapNodeData,
} from './zoneGraph'
import { guestKey, zoneMembers, type PolicyGuest, type ZoneMember } from './zoneModel'
import ZonePanel from './ZonePanel'

/** The whole map reads the pending observed flows (unprotected and blocked) once; the API caps a page at 200. */
const PENDING_LIMIT = 200
const PENDING_OBSERVED: ListSuggestionsParams = { status: 'pending', limit: PENDING_LIMIT }

type Selection = { kind: 'zone' | 'guest' | 'edge'; id: string }

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
 * The Overview sub-tab: the draft as a map, like the security groups view of NSX. A circle per zone holding its
 * guests, the running guests in no zone in a dashed circle, the allowed flows circle to circle, the observed ones
 * (unprotected, blocked) guest to guest. Hover or select something to light it and its flows; click a circle for
 * its panel, an edge for its flows. Nothing polls beyond the shared hooks (one inventory read, one suggestions read).
 */
export default function ZoneMap({ connectionId, policy, reloadPolicy, goToSubTab, startRun, onOpenPlan }: MicrosegSubTabProps) {
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

  const { zones, flows, pending_members: pendingMembers } = policy
  const tagPrefix = policy.policy.tag_prefix
  const membersByZone = useMemo(
    () => new Map(zones.map(z => [z.id, zoneMembers(z, tagPrefix, guests, pendingMembers, zones)])),
    [zones, tagPrefix, guests, pendingMembers],
  )
  const membersKnown = guestsStatus === 'ready'
  const zonesById = useMemo(() => new Map(zones.map(z => [z.id, z])), [zones])

  // The flows of the draft that the last applied revision does not have (null: not known yet, nothing marked).
  const unapplied = useMemo<ReadonlySet<string> | null>(() => {
    if (!policy.pending_changes) return null
    if (!policy.last_revision) return new Set(flows.map(f => f.id))
    const snapshot = revision?.snapshot
    if (!snapshot) return null
    const before = new Map(snapshot.flows.map(f => [f.id, f]))
    return new Set(flows.filter(f => !before.has(f.id) || !sameFlow(before.get(f.id)!, f)).map(f => f.id))
  }, [policy.pending_changes, policy.last_revision, revision, flows])

  const graph = useMemo(() => {
    const members = membersKnown ? new Map([...membersByZone].map(([id, list]) => [id, list.map(toMapMember)])) : null
    const zoned = new Set([...membersByZone.values()].flatMap(list => list.map(m => guestKey(m.ref))))
    const unzoned = membersKnown ? guests.filter(g => g.status === 'running' && !zoned.has(guestKey(g))).map(guestToMember) : null
    return buildZoneGraph({ zones, flows, suggestions: suggestions.data ?? [], members, unzoned, unapplied })
  }, [zones, flows, suggestions.data, membersByZone, membersKnown, guests, unapplied])

  // "Refreshed at": the first answer, then the end of every refresh (a refresh that changes nothing still moves it).
  const loaded = !!suggestions.data || membersKnown
  useEffect(() => {
    if (!loaded || refreshedAt) return
    const timer = setTimeout(() => setRefreshedAt(new Date()), 0)
    return () => clearTimeout(timer)
  }, [loaded, refreshedAt])

  // A zone deleted from the draft (or an edge gone after a reload) simply closes its panel.
  const selectedZone = selection?.kind === 'zone' ? zones.find(z => z.id === selection.id) ?? null : null
  const selectedEdge = selection?.kind === 'edge' ? graph.edges.find(e => e.id === selection.id) ?? null : null
  const selectedNode = selectedNodeOf(selectedZone, selection)
  const selectedFocus = selectedNode ?? (selection?.kind === 'edge' ? selection.id : null)
  const focusId = hover ?? keyFocus ?? selectedFocus
  const lit = useMemo(() => focusSets(graph, focusId), [graph, focusId])

  const tNode = useTranslations('microsegPilot.overview.node')
  const tEdge = useTranslations('microsegPilot.overview.edge')
  const nameOf = useCallback((nodeId: string) => {
    if (nodeId === EXTERNAL_ID) return tNode('external')
    if (nodeId === OUTSIDE_ID) return tNode('outside')
    const node = graph.nodes.find(n => n.id === nodeId)
    const d = node?.data as unknown as MapNodeData | undefined
    if (!d) return nodeId
    const groupName = (groupId: string) => (groupId === UNZONED_ID ? tNode('unzoned', { count: (graph.nodes.find(n => n.id === UNZONED_ID)?.data as { count?: number } | undefined)?.count ?? 0 }) : zonesById.get(groupId)?.name ?? groupId)
    if (d.kind === 'zone') return d.zone.name
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

  const nodes = useMemo(() => graph.nodes.map(n => {
    const selected = n.id === selectedNode
    const dimmed = !!lit && !lit.nodes.has(n.id)
    return selected || dimmed ? { ...n, selected, className: dimmed ? 'microseg-dim' : undefined } : n
  }), [graph.nodes, selectedNode, lit])

  // The edges take no focus, but a screen reader names them: "web to db: tcp/443".
  const edges = useMemo(() => filterEdges(graph.edges, filters).map(e => {
    const d = e.data as unknown as MapEdgeData
    const dimmed = !!lit && !lit.edges.has(e.id)
    return {
      ...e,
      className: dimmed ? 'microseg-dim' : undefined,
      ariaLabel: edgeAria(tEdge as EdgeT, names, e.source, e.target, d),
      data: dimmed ? { ...e.data, dimmed } : e.data,
    }
  }), [graph.edges, filters, lit, tEdge, names])

  const selectZone = useCallback((zoneId: string) => { setSelection({ kind: 'zone', id: zoneId }); setResolved(null) }, [])
  const selectGuest = useCallback((nodeId: string) => setSelection({ kind: 'guest', id: nodeId }), [])
  const selectEdge = useCallback((edgeId: string) => { setSelection({ kind: 'edge', id: edgeId }); setResolved(null) }, [])
  const clear = useCallback(() => setSelection(null), [])
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

  const panelOpen = !!selectedZone || !!selectedEdge
  return (
    <Box sx={{ px: 3, pb: 3, flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1, flexWrap: 'wrap' }}>
        <Box sx={{ flex: '1 1 auto', minWidth: 0 }}>
          <MapToolbar filters={filters} onFilters={setFilters} refreshedAt={refreshedAt} refreshing={refreshing} onRefresh={refresh} />
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
      <MapNamesContext.Provider value={names}>
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'stretch', flexWrap: { xs: 'wrap', lg: 'nowrap' }, flex: 1, minHeight: 560 }}>
          <Box
            role='region'
            aria-label={t('mapLabel')}
            sx={{ flex: '1 1 0', minWidth: 0, width: '100%', minHeight: 560, border: 1, borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}
          >
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
            />
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
            />
          )}
          {selectedEdge && (
            <EdgePanel
              key={selectedEdge.id}
              edgeId={selectedEdge.id}
              source={selectedEdge.source}
              target={selectedEdge.target}
              data={selectedEdge.data as unknown as MapEdgeData}
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
