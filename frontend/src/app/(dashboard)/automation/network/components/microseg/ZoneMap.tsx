'use client'

import { useMemo, useState } from 'react'
import { Alert, Box, Button, Chip, Tooltip, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import type { ListSuggestionsParams } from '@/lib/microseg/api'
import { useMicrosegSuggestions } from '@/lib/microseg/useMicrosegLists'

import AssignGuestsDialog from './AssignGuestsDialog'
import type { MicrosegSubTabProps } from './microsegTabTypes'
import { useZoneGuests } from './useZoneGuests'
import ZoneCanvas from './ZoneCanvas'
import { buildZoneGraph, EDGE_COLORS, EXTERNAL_ID, OUTSIDE_ID, zoneNodeId, type MapEdgeData } from './zoneGraph'
import { zoneMembers } from './zoneModel'
import ZonePanel from './ZonePanel'

/** The whole map reads the pending would-block suggestions once (the API caps a page at 200). */
const PENDING_LIMIT = 200
const PENDING_WOULD_BLOCK: ListSuggestionsParams = { kind: 'would_block', status: 'pending', limit: PENDING_LIMIT }

function Legend() {
  const t = useTranslations('microsegPilot.overview.legend')
  const items = [
    { key: 'flow', color: 'currentColor', dashed: false },
    { key: 'pending', color: EDGE_COLORS.pending, dashed: true },
    { key: 'outside', color: EDGE_COLORS.outside, dashed: true },
  ] as const
  return (
    <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
      {items.map(item => (
        <Box key={item.key} sx={{ display: 'flex', alignItems: 'center', gap: 0.75, color: 'text.secondary' }}>
          <Box component='span' sx={{ width: 22, borderTop: `2px ${item.dashed ? 'dashed' : 'solid'} ${item.color}` }} />
          <Typography variant='caption' color='text.secondary'>{t(item.key)}</Typography>
        </Box>
      ))}
    </Box>
  )
}

/**
 * The Overview sub-tab: the draft as a map. A node per zone (and External /
 * Outside when a flow or a suggestion reaches beyond the zones), an edge per
 * pair with flows, a dashed red one per pair with pending would-block
 * suggestions. A click on a zone opens its panel. Nothing polls beyond the
 * shared hooks (one inventory read, one suggestions read).
 */
export default function ZoneMap({ connectionId, policy, reloadPolicy, goToSubTab }: MicrosegSubTabProps) {
  const t = useTranslations('microsegPilot.overview')
  const { guests, status: guestsStatus } = useZoneGuests(connectionId)
  const suggestions = useMicrosegSuggestions(connectionId, PENDING_WOULD_BLOCK)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [assigning, setAssigning] = useState(false)

  const { zones, flows, pending_members: pendingMembers } = policy
  const tagPrefix = policy.policy.tag_prefix
  const membersByZone = useMemo(
    () => new Map(zones.map(z => [z.id, zoneMembers(z, tagPrefix, guests, pendingMembers, zones)])),
    [zones, tagPrefix, guests, pendingMembers],
  )
  const membersKnown = guestsStatus === 'ready'
  const graph = useMemo(() => {
    const counts = membersKnown ? new Map([...membersByZone].map(([id, list]) => [id, list.length])) : null
    return buildZoneGraph(zones, flows, suggestions.data ?? [], counts)
  }, [zones, flows, suggestions.data, membersByZone, membersKnown])

  // A zone deleted from the draft while its panel is open simply closes it.
  const selected = zones.find(z => z.id === selectedId) ?? null
  const nodes = useMemo(
    () => (selected ? graph.nodes.map(n => (n.id === zoneNodeId(selected.id) ? { ...n, selected: true } : n)) : graph.nodes),
    [graph.nodes, selected],
  )
  const zonesById = useMemo(() => new Map(zones.map(z => [z.id, z])), [zones])

  // The edges take no focus, but a screen reader names them: "web to db: tcp/443".
  const tNode = useTranslations('microsegPilot.overview.node')
  const edges = useMemo(() => {
    const nameOf = (nodeId: string) => (nodeId === EXTERNAL_ID ? tNode('external') : nodeId === OUTSIDE_ID ? tNode('outside') : (zonesById.get(nodeId.replace(/^zone:/, ''))?.name ?? nodeId))
    return graph.edges.map(e => ({ ...e, ariaLabel: t('edge.aria', { from: nameOf(e.source), to: nameOf(e.target), services: (e.data as unknown as MapEdgeData).services.join(', ') }) }))
  }, [graph.edges, zonesById, t, tNode])

  if (zones.length === 0) {
    return (
      <Box sx={{ px: 3, pb: 3 }}>
        <Typography color='text.secondary' sx={{ mb: 1.5 }}>{t('empty')}</Typography>
        <Button variant='contained' size='small' startIcon={<i className='ri-add-line' />} onClick={() => goToSubTab('policy')}>{t('createZone')}</Button>
      </Box>
    )
  }

  return (
    <Box sx={{ px: 3, pb: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1, flexWrap: 'wrap', minHeight: 28 }}>
        <Legend />
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
      <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start', flexWrap: { xs: 'wrap', lg: 'nowrap' } }}>
        <Box
          role='region'
          aria-label={t('mapLabel')}
          sx={{ flex: '1 1 0', minWidth: 0, width: '100%', height: 560, border: 1, borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}
        >
          <ZoneCanvas nodes={nodes} edges={edges} onSelectZone={setSelectedId} onClear={() => setSelectedId(null)} panelOpen={!!selected} />
        </Box>
        {selected && (
          <ZonePanel
            key={selected.id}
            zone={selected}
            members={membersByZone.get(selected.id) ?? []}
            membersKnown={membersKnown}
            flows={flows}
            zonesById={zonesById}
            onClose={() => setSelectedId(null)}
            onEdit={() => goToSubTab('policy')}
            onAssign={() => setAssigning(true)}
          />
        )}
      </Box>
      {assigning && selected && (
        <AssignGuestsDialog
          open
          connectionId={connectionId}
          zone={selected}
          policy={policy}
          reloadPolicy={reloadPolicy}
          onClose={() => setAssigning(false)}
        />
      )}
    </Box>
  )
}
