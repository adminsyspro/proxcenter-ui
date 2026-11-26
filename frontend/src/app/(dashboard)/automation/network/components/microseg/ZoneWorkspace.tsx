'use client'

import type { ReactNode } from 'react'
import { Box, IconButton, Tooltip, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import { useMicrosegSuggestions } from '@/lib/microseg/useMicrosegLists'

import { useZoneWork } from './ZonePanel'
import { ZoneGlyph, type ZoneRowProps } from './ZoneRow'
import type { ZoneEdits } from './useZoneEdits'
import TruncatedText from './TruncatedText'

/** What the details of a zone card need beyond the card: the writes of the draft, its version, the names of the peers. */
export type ZoneWorkContext = {
  connectionId: string
  edits: ZoneEdits
  version: number
  reloadPolicy: () => Promise<unknown>
  /** The guest name of each address the inventory knows, to name the destination of an outbound row. */
  peers?: ReadonlyMap<string, string>
  /** Names a cluster; given only when the policy is shared (each member line shows its cluster chip). */
  clusterName?: (id: string) => string
  /** One line above the members when some cluster's guests could not be read: the list is not complete. */
  membersNote?: ReactNode
}

/** The pending observed flows of the zone read for its details, as many as the map reads in all. */
export const WORKSPACE_SUGGESTIONS_LIMIT = 200

type Props = Pick<ZoneRowProps, 'zone' | 'members' | 'membersKnown' | 'flows' | 'zonesById' | 'onAssign' | 'onToggle'> & {
  work: ZoneWorkContext
  /** The id the card's Details button controls. */
  id: string
}

/** A card of the details: framed on the theme's paper, its sections inside. */
const BLOCK_SX = { minWidth: 0, border: 1, borderColor: 'divider', borderRadius: 1, bgcolor: 'background.paper', px: 1.5, pt: 0.5 } as const

/**
 * The details of a zone card on the Policy sub-tab: the content of the zone panel of the map, laid out wide. On the
 * left the zone itself: its observed traffic over time (the chart taller than in the map panel), its members and its
 * exceptions; on the right what is to be dealt with: its top sources, the pending observed flows to accept or dismiss,
 * and the flows in and out, all editable in place. The pending flows of the zone are read for it (the orchestrator
 * database, every minute while shown, no Proxmox call).
 */
export default function ZoneWorkspace({ zone, members, membersKnown, flows, zonesById, onAssign, onToggle, work, id }: Props) {
  const t = useTranslations('microsegPilot.policy.zone')
  const { data, reload } = useMicrosegSuggestions(work.connectionId, { status: 'pending', zone: zone.id, limit: WORKSPACE_SUGGESTIONS_LIMIT })
  const { tallChart, topSection, suggestionsSection, memberSections, flowSections, dialogs } = useZoneWork({
    zone, members, membersKnown, flows, zonesById,
    edits: work.edits,
    onAssign: () => onAssign(zone),
    connectionId: work.connectionId,
    version: work.version,
    suggestions: data ?? [],
    reloadPolicy: work.reloadPolicy,
    reloadSuggestions: reload,
    onResolved: () => undefined,
    partialLimit: (data?.length ?? 0) >= WORKSPACE_SUGGESTIONS_LIMIT ? WORKSPACE_SUGGESTIONS_LIMIT : null,
    peers: work.peers,
    memberErrors: false,
    clusterName: work.clusterName,
    membersNote: work.membersNote,
  })
  return (
    <Box
      component='section'
      id={id}
      aria-label={t('detailsOf', { zone: zone.name })}
      data-testid={`zone-workspace-${zone.id}`}
      sx={{ gridColumn: '1 / -1', border: 1, borderColor: 'primary.main', borderRadius: 1, bgcolor: 'background.paper', minWidth: 0 }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, pt: 1.5, pb: 1, minWidth: 0 }}>
        <ZoneGlyph zone={zone} label={t(`state.${zone.state}`)} />
        <Typography fontWeight={600} noWrap sx={{ flexShrink: 0 }}>{zone.name}</Typography>
        <TruncatedText text={zone.label} variant='body2' color='text.secondary' sx={{ flex: '1 1 0', minWidth: 0 }} />
        <Tooltip title={t('hideDetailsOf', { zone: zone.name })}>
          <IconButton size='small' aria-label={t('hideDetailsOf', { zone: zone.name })} onClick={onToggle}><i className='ri-arrow-up-s-line' /></IconButton>
        </Tooltip>
      </Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'minmax(0, 2fr) minmax(0, 3fr)' }, gap: 2, px: 2, pb: 2, minWidth: 0 }}>
        {/* Two rows of two cards, the two of a row as tall as the taller: their frames and headers line up. */}
        <Box data-block='traffic' sx={BLOCK_SX}>{tallChart}</Box>
        <Box data-block='review' sx={BLOCK_SX}>{topSection}{suggestionsSection}</Box>
        <Box data-block='members' sx={BLOCK_SX}>{memberSections}</Box>
        <Box data-block='flows' sx={BLOCK_SX}>{flowSections}</Box>
      </Box>
      {dialogs}
    </Box>
  )
}

