'use client'

import { Box, Chip, CircularProgress, IconButton, Skeleton, Tooltip, alpha, darken, lighten, useTheme } from '@mui/material'
import { useFormatter, useTranslations } from 'next-intl'

import type { FirewallMode } from '@/lib/api/firewall'

import { STATE_AMBER, STATE_GREEN, STATE_GREY, STATE_RED } from './dashboardColors'
import type { BlockPhase } from './dashboardModel'
import { deniesInbound } from './dashboardModel'
import { NOW_REFRESH_MS, useNow } from './microseg/useNow'

const STATE_BLUE = '#3b82f6'

type Props = {
  clusterPhase: BlockPhase
  firewallMode: FirewallMode
  firewallOn: boolean
  policyIn: string
  /** The emergency stop is on: its chip replaces the cluster one, in red. */
  stopped: boolean
  /** The stop holds the cluster firewall off. */
  stopHoldsFirewall: boolean
  /** undefined while the status is read, null when it could not be. */
  zones: { enforced: number; total: number } | null | undefined
  /** null until the coverage route measured the guests. */
  guests: { protected: number; running: number } | null
  /** undefined while the status is read. */
  lastCheck: Date | null | undefined
  /** When the coverage route computed the guest figures (ISO), absent before. */
  coverageAt?: string
  /** A refresh is asked, or the server is computing. */
  coverageBusy: boolean
  onRefreshCoverage: () => void
  onOpenCluster: () => void
  onOpenMicroseg: () => void
  onOpenGuests: () => void
}

/** A rounded chip with a dot in front, tinted with its colour (the header of the Posture Dashboard). */
function PostureChip({ color, label, testId, tip, onClick }: { color: string; label: string; testId: string; tip?: string; onClick?: () => void }) {
  const theme = useTheme()
  const text = theme.palette.mode === 'dark' ? lighten(color, 0.3) : darken(color, 0.35)
  const chip = (
    <Chip
      data-testid={testId}
      label={label}
      onClick={onClick}
      icon={<Box component='span' aria-hidden sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: color, flexShrink: 0 }} />}
      sx={{ height: 30, maxWidth: '100%', fontWeight: 600, bgcolor: alpha(color, 0.14), color: text, '& .MuiChip-icon': { ml: 1.25, mr: -0.25 } }}
    />
  )
  return tip ? <Tooltip title={tip}>{chip}</Tooltip> : chip
}

/** The server serves a forced refresh from its cache this soon after new figures (COVERAGE_FORCE_MIN_MS, server side). */
export const REFRESH_FLOOR_MS = 30_000
/** How often the refresh button checks whether that floor is over. */
const FLOOR_TICK_MS = 5_000

/** Computes the guest coverage again: held while computing and 30 s after new figures; says when they were computed. */
function CoverageRefresh({ coverageAt, busy, onRefresh }: { coverageAt?: string; busy: boolean; onRefresh: () => void }) {
  const t = useTranslations('networkPage.dashboard')
  const format = useFormatter()
  const at = coverageAt ? new Date(coverageAt) : null
  const valid = !!at && !Number.isNaN(at.getTime())
  const now = useNow(FLOOR_TICK_MS, coverageAt)
  const tooSoon = valid && now - at.getTime() < REFRESH_FLOOR_MS
  let tip = t('postureRefresh')
  if (busy) tip = t('postureRefreshComputing')
  else if (valid) {
    const time = format.relativeTime(at, Math.max(now, at.getTime()))
    tip = tooSoon ? t('postureRefreshSoon', { time }) : t('postureRefreshAgo', { time })
  }
  return (
    <Tooltip title={tip}>
      <span>
        <IconButton size='small' aria-label={t('postureRefresh')} onClick={onRefresh} disabled={busy || tooSoon} data-testid='coverage-refresh'>
          {busy ? <CircularProgress size={14} /> : <i className='ri-refresh-line' style={{ fontSize: 16 }} />}
        </IconButton>
      </span>
    </Tooltip>
  )
}

const ChipSkeleton = ({ testId }: { testId: string }) => <Skeleton data-testid={testId} variant='rounded' width={170} height={30} sx={{ borderRadius: 15 }} />

/** The cluster firewall on or off with its inbound policy, or the emergency stop in red. */
function ClusterChip({ clusterPhase, firewallMode, firewallOn, policyIn, stopped, stopHoldsFirewall, onOpenCluster }: Pick<Props, 'clusterPhase' | 'firewallMode' | 'firewallOn' | 'policyIn' | 'stopped' | 'stopHoldsFirewall' | 'onOpenCluster'>) {
  const t = useTranslations('networkPage.dashboard')
  if (stopped) {
    const label = stopHoldsFirewall ? t('stopHeldTitle') : t('postureChipStopped')
    return <PostureChip testId='chip-stop' color={STATE_RED} label={label} onClick={onOpenCluster} />
  }
  if (clusterPhase === 'loading') return <ChipSkeleton testId='chip-cluster-loading' />
  if (clusterPhase === 'unavailable') return <PostureChip testId='chip-cluster' color={STATE_GREY} label={t('postureChipClusterUnknown')} />
  const values = { state: firewallOn ? t('postureOn') : t('postureOff'), policy: policyIn }
  const label = firewallMode === 'cluster' ? t('postureChipCluster', values) : t('postureChipHost', values)
  let color = STATE_RED
  if (firewallOn) color = deniesInbound(policyIn) ? STATE_GREEN : STATE_AMBER
  return <PostureChip testId='chip-cluster' color={color} label={label} onClick={onOpenCluster} />
}

/**
 * The header of the Posture Dashboard, right-aligned and wrapping: the cluster firewall and its inbound policy (the
 * emergency stop in red in its place), the zones that enforce, the running guests Proxmox filters, and the last
 * check of the engine. "-" for a figure not measured yet.
 */
export default function PostureChips(props: Props) {
  const t = useTranslations('networkPage.dashboard')
  const format = useFormatter()
  // The time as the key, not the Date: a new Date each render would restart the clock on every render.
  const now = useNow(NOW_REFRESH_MS, props.lastCheck?.getTime())
  const { zones, guests, lastCheck } = props

  let zonesChip = <ChipSkeleton testId='chip-zones-loading' />
  if (zones !== undefined) {
    const label = zones ? t('postureChipZones', zones) : t('postureChipZonesUnknown')
    let color = STATE_GREY
    if (zones && zones.total > 0) color = zones.enforced > 0 ? STATE_GREEN : STATE_AMBER
    zonesChip = <PostureChip testId='chip-zones' color={color} label={label} onClick={props.onOpenMicroseg} />
  }

  let guestsColor = STATE_GREY
  if (guests && guests.running > 0) guestsColor = guests.protected === guests.running ? STATE_GREEN : STATE_BLUE
  const guestsLabel = guests ? t('postureChipGuests', guests) : t('postureChipGuestsUnknown')

  let checkChip = <ChipSkeleton testId='chip-check-loading' />
  if (lastCheck !== undefined) {
    const label = lastCheck ? t('postureChipLastCheck', { time: format.relativeTime(lastCheck, Math.max(now, lastCheck.getTime())) }) : t('postureChipNoCheck')
    checkChip = <PostureChip testId='chip-check' color={STATE_GREY} label={label} />
  }

  return (
    <Box data-testid='posture-chips' sx={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 1, mb: 2.5 }}>
      <ClusterChip {...props} />
      {zonesChip}
      <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25 }}>
        <PostureChip testId='chip-guests' color={guestsColor} label={guestsLabel} tip={t('coverageDefinition')} onClick={props.onOpenGuests} />
        <CoverageRefresh coverageAt={props.coverageAt} busy={props.coverageBusy} onRefresh={props.onRefreshCoverage} />
      </Box>
      {checkChip}
    </Box>
  )
}
