'use client'

import { useEffect, useMemo, useState } from 'react'
import { Box, ButtonBase, Link, Typography } from '@mui/material'
import { useFormatter, useTranslations } from 'next-intl'

import type { MicrosegCluster, MicrosegDriftList, MicrosegStatus } from '@/lib/microseg/types'
import { useMergedClusters } from '@/lib/microseg/useMerged'
import { SUGGESTIONS_REFRESH_MS, useClusterDrifts } from '@/lib/microseg/useMicrosegLists'
import { useMicrosegStatus } from '@/lib/microseg/useMicrosegStatus'

import { CLUSTER_STATE_MARK, clusterState } from './clustersOfPolicyModel'
import { shownClusterName } from './microseg/ClusterRunRow'
import ConnectionGlyph, { useConnectionKind } from './microseg/ConnectionGlyph'
import { driftKey } from './microseg/driftLabels'
import { useIgnoredClusterDrifts } from './microseg/driftIgnore'
import { formatWhen } from './microseg/summaryModel'

type Props = {
  /** The connection the Dashboard is on. */
  connectionId: string
  /** Its name, when the connection list does not hold it yet. */
  connectionName?: string
  /** The links of the policy (two or more). */
  links: readonly MicrosegCluster[]
  /** The connections the user sees, by ID. */
  connections: readonly { id: string; name: string }[]
  /** The cluster the Dashboard is filtered on; null for the whole policy. */
  selected: string | null
  /** The clusters whose figures could not be read. */
  missing: ReadonlySet<string>
  /** Filters the Dashboard on one cluster, or on the whole policy (null). */
  onSelect: (cluster: string | null) => void
  /** Opens the Micro-segmentation tab on its Drifts sub-tab. */
  onOpenDrifts: () => void
}

const STATE_KEY = { stop: 'clustersStateStop', applied: 'clustersStateApplied', unknown: 'clustersStateUnknown' } as const
const NO_IDS: string[] = []
const names = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
const ONE_LINE = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 } as const
/** Two tight lines, 56 px at most. */
const TILE_SX = {
  // The tiles share the whole width of the dashboard equally; past their minimum width the line scrolls.
  flex: '1 1 0', minWidth: 220, height: 52, display: 'flex', alignItems: 'stretch', borderRadius: 1, border: 1,
  borderColor: 'divider', bgcolor: 'background.paper', overflow: 'hidden', transition: 'opacity 120ms',
} as const

type Line = { id: string; name: string; link: MicrosegCluster; readable: boolean }

type TileProps = {
  line: Line
  status: MicrosegStatus | undefined
  statusFailed: boolean
  drifts: MicrosegDriftList | undefined
  ignored: (id: string, key: string) => boolean
  missing: boolean
  selected: boolean
  dimmed: boolean
  onSelect: () => void
  onOpenDrifts: () => void
}

/** The state of one cluster as its tile says it: one icon, one text. */
function useStateText(state: ReturnType<typeof clusterState>): string {
  const t = useTranslations('networkPage.dashboard')
  const tm = useTranslations('microsegPilot')
  const format = useFormatter()
  if (state.key === 'unreachable') return t('clustersStateUnreachable', { time: formatWhen(format, state.since ?? '') })
  if (state.key === 'firewallOff') return tm('drifts.chip.cluster_firewall_off')
  if (state.key === 'pending') return tm('settings.clusters.pending')
  return t(STATE_KEY[state.key])
}

/**
 * The text of a tile's second line: the long form while it fits, else the short form (never a word cut in two), and
 * the whole text for the hover only when something of it is not shown. The room is the line's own (it takes the whole
 * width of the tile, past the icon); `long` is measured once it overflows and kept, so a wider tile brings it back.
 */
function useFittingText(long: string, short: string) {
  // A state, not a ref: the effect reads the element once it is there.
  const [el, setEl] = useState<HTMLSpanElement | null>(null)
  const [fit, setFit] = useState({ long, useShort: false, longWidth: 0, cut: false })
  // A new text starts from the long form again.
  if (fit.long !== long) setFit({ long, useShort: false, longWidth: 0, cut: false })

  // The line is observed: the observer answers once when it starts (so after each change of the text or of the form
  // shown) and at each change of the room, and the state is written from its callback only.
  const { useShort, longWidth } = fit
  useEffect(() => {
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(() => {
      const overflows = el.scrollWidth > el.clientWidth
      setFit(prev => {
        if (prev.long !== long) return prev
        if (!useShort && overflows && short !== long) return { ...prev, useShort: true, longWidth: el.scrollWidth, cut: overflows }
        if (useShort && el.clientWidth >= longWidth) return { ...prev, useShort: false, cut: overflows }
        return prev.cut === overflows ? prev : { ...prev, cut: overflows }
      })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [el, long, short, useShort, longWidth])

  return { attach: setEl, shown: fit.useShort ? short : long, hover: fit.useShort || fit.cut ? long : undefined }
}

function ClusterTile({ line, status, statusFailed, drifts, ignored, missing, selected, dimmed, onSelect, onOpenDrifts }: Readonly<TileProps>) {
  const t = useTranslations('networkPage.dashboard')
  const kind = useConnectionKind(line.id)
  const unread = !line.readable || statusFailed
  // While the first read is on its way: no state yet, never a spinner.
  const loading = line.readable && !statusFailed && !status
  const state = clusterState({ status: unread ? undefined : status, active: line.link.active, stopDisabled: line.link.stop_cluster_disabled })
  const mark = CLUSTER_STATE_MARK[state.key]
  const stateText = useStateText(state)
  const coverage = unread ? null : status?.coverage
  const driftCount = !unread && drifts?.computed ? drifts.drifts.filter(d => !ignored(line.id, driftKey(d))).length : null

  const state1 = loading ? '' : stateText
  const lead = missing ? [t('clustersFiguresMissing')] : []
  const longText = line.readable
    ? [state1, ...lead, coverage ? t('clustersMembers', { members: coverage.members, protected: coverage.protected }) : ''].filter(Boolean).join(' · ')
    : t('clustersOutOfScope')
  const shortText = line.readable
    ? [state1, ...lead, coverage ? t('clustersMembersShort', { members: coverage.members, protected: coverage.protected }) : ''].filter(Boolean).join(' · ')
    : longText
  const { attach, shown, hover } = useFittingText(longText, shortText)

  // The two lines sit above the tile's button (which fills the tile) and let the pointer through to it, except the
  // drift count: a link of its own, never inside the button.
  const row = { position: 'relative', display: 'flex', alignItems: 'center', minWidth: 0, pointerEvents: 'none' } as const

  return (
    <Box
      data-testid='cluster-tile'
      data-cluster={line.name}
      data-selected={selected ? 'true' : 'false'}
      data-missing={missing ? 'true' : 'false'}
      sx={{
        ...TILE_SX, position: 'relative', flexDirection: 'column', justifyContent: 'center', gap: 0.25, px: 1.25,
        opacity: dimmed ? 0.55 : 1, ...(selected ? { borderColor: 'primary.main', bgcolor: 'action.selected' } : {}),
      }}
    >
      {line.readable && (
        <ButtonBase onClick={onSelect} aria-pressed={selected} aria-label={line.name} title={hover} sx={{ position: 'absolute', inset: 0 }} data-testid='cluster-tile-button' />
      )}
      <Box data-testid='cluster-tile-head' sx={{ ...row, gap: 1 }}>
        <ConnectionGlyph kind={line.readable ? kind : undefined} />
        <Typography variant='body2' sx={{ fontWeight: 600, flex: '1 1 auto', ...ONE_LINE }} data-testid='cluster-tile-name'>{line.name}</Typography>
        {driftCount !== null && (
          <Link component='button' type='button' variant='caption' underline='hover' onClick={onOpenDrifts} data-testid='cluster-tile-drifts' sx={{ whiteSpace: 'nowrap', fontWeight: 600, flexShrink: 0, pointerEvents: 'auto' }}>
            {t('clustersDrifts', { count: driftCount })}
          </Link>
        )}
      </Box>
      <Box data-testid='cluster-tile-state' sx={{ ...row, gap: 0.75 }}>
        {line.readable && !loading && <Box component='i' aria-hidden className={mark.icon} sx={{ color: mark.color, fontSize: 14, flexShrink: 0 }} />}
        <Typography ref={attach} variant='caption' color='text.secondary' sx={{ ...ONE_LINE, flex: '1 1 auto' }} data-testid='cluster-tile-detail'>
          {shown}
        </Typography>
      </Box>
    </Box>
  )
}

/**
 * The clusters of a policy shared by several PVE connections, one tile each on one line (it scrolls, never wraps),
 * after a tile "All clusters": the cluster, its state, its guests in a zone and how many are protected, its drifts (a
 * click opens the Drifts sub-tab). A click on a tile filters the Dashboard on that cluster, a second click or "All
 * clusters" shows the whole policy again. Each cluster the user sees is read here (status and drifts, the
 * orchestrator's memory, no Proxmox call) at the Dashboard's usual pace; one outside their scope is named in general
 * words, never read, cannot be picked, and a line says its traffic is not in the figures.
 */
export default function ClusterStrip({ connectionId, connectionName, links, connections, selected, missing, onSelect, onOpenDrifts }: Readonly<Props>) {
  const t = useTranslations('networkPage.dashboard')
  const tm = useTranslations('microsegPilot')
  const seen = useMemo(() => new Set(connections.map(c => c.id)), [connections])
  const lookup = useMemo(() => {
    const byId = new Map(connections.map(c => [c.id, c.name]))
    return (id: string) => byId.get(id) ?? (id === connectionId && connectionName ? connectionName : id)
  }, [connections, connectionId, connectionName])
  const other = tm('plan.cluster.other')
  const lines = useMemo<Line[]>(() => links
    .map(link => ({
      id: link.connection_id,
      link,
      name: shownClusterName(link.connection_id, connectionId, lookup, other),
      readable: seen.has(link.connection_id) || link.connection_id === connectionId,
    }))
    .sort((a, b) => names.compare(a.name, b.name) || a.id.localeCompare(b.id)), [links, connectionId, lookup, other, seen])
  const readIds = useMemo(() => lines.filter(l => l.readable).map(l => l.id), [lines])
  const hidden = lines.length - readIds.length
  const statuses = useMergedClusters(readIds, useMicrosegStatus, SUGGESTIONS_REFRESH_MS)
  const drifts = useMergedClusters(readIds, useClusterDrifts)
  const { isIgnored } = useIgnoredClusterDrifts(readIds.length > 0 ? readIds : NO_IDS)

  return (
    <Box data-testid='cluster-strip' sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, minWidth: 0 }}>
      <Box role='group' aria-label={tm('settings.clusters.row')} sx={{ display: 'flex', flexWrap: 'nowrap', gap: 1, overflowX: 'auto', pb: 0.25 }}>
        <Box data-testid='cluster-tile-all' data-selected={selected === null ? 'true' : 'false'} sx={{ ...TILE_SX, minWidth: 150, opacity: selected === null ? 1 : 0.55, ...(selected === null ? { borderColor: 'primary.main', bgcolor: 'action.selected' } : {}) }}>
          <ButtonBase onClick={() => onSelect(null)} aria-pressed={selected === null} sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'flex-start', gap: 0.25, px: 1.25, flex: '1 1 auto', minWidth: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
              <Box component='i' aria-hidden className='ri-stack-line' sx={{ fontSize: 16, color: 'text.secondary', flexShrink: 0 }} />
              <Typography variant='body2' sx={{ fontWeight: 600, ...ONE_LINE }}>{t('clustersAll')}</Typography>
            </Box>
            <Typography variant='caption' color='text.secondary' sx={ONE_LINE}>{t('clustersCount', { count: lines.length })}</Typography>
          </ButtonBase>
        </Box>
        {lines.map(line => (
          <ClusterTile
            key={line.id}
            line={line}
            status={statuses.byCluster[line.id]}
            statusFailed={line.id in statuses.errors}
            drifts={drifts.byCluster[line.id]}
            ignored={isIgnored}
            missing={missing.has(line.id)}
            selected={selected === line.id}
            dimmed={selected !== null && selected !== line.id}
            onSelect={() => onSelect(selected === line.id ? null : line.id)}
            onOpenDrifts={onOpenDrifts}
          />
        ))}
      </Box>
      {hidden > 0 && (
        <Typography variant='caption' color='text.secondary' data-testid='cluster-strip-hidden' sx={ONE_LINE}>
          {t('clustersHiddenTraffic', { count: hidden })}
        </Typography>
      )}
    </Box>
  )
}
