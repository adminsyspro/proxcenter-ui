'use client'

import { useEffect, useMemo, useState } from 'react'
import { Alert, Box, Button, Chip, Paper, Tooltip, Typography } from '@mui/material'
import { useFormatter, useTranslations } from 'next-intl'

import { microsegErrorKeyOf } from '@/lib/microseg/api'
import type { MicrosegDriftList, MicrosegPolicy } from '@/lib/microseg/types'
import { useMergedClusters } from '@/lib/microseg/useMerged'
import { useClusterDrifts } from '@/lib/microseg/useMicrosegLists'
import { useMicrosegStatus } from '@/lib/microseg/useMicrosegStatus'

import ClusterChip from './ClusterChip'
import { shownClusterName } from './ClusterRunRow'
import ClusterUnreadLines, { isUnreachable } from './ClusterUnreadLines'
import IPFilterBannerLines, { useIPFilterBanner } from './IPFilterBanner'
import LogNodeLines from './LogNodeLines'
import MicrosegConfirmDialog, { type ConfirmInfoLine } from './MicrosegConfirmDialog'
import MicrosegErrorAlert from './MicrosegErrorAlert'
import PendingChangesBar from './PendingChangesBar'
import { isTrafficRefusal, socleRefusalCluster, socleRefusalLines } from './preflightModel'
import { clusterFirewallOff, firewallOffByHand, formatWhen, stillPaused, stopFollowState } from './summaryModel'
import type { ControlAction, MicrosegControls, StopFollowUp } from './useMicrosegControls'
import { NOW_REFRESH_MS, useNow } from './useNow'
import { WriteTip, useMicrosegClusterWrite, useMicrosegWrite } from './microsegAccess'

type Props = {
  connectionId: string
  policy: MicrosegPolicy
  controls: MicrosegControls
  onOpenPlan?: () => void
  /** Opens the Drifts sub-tab (the guests outside every zone on the network of an enforced zone). */
  onOpenDrifts?: () => void
  /** The clusters sharing the policy once the group is known: each one's status is read for its own firewall state. */
  clusterIds?: string[]
}

const NO_CLUSTERS: string[] = []

/** How often each cluster's status is read while one of them has not followed a stop or a lift yet (orchestrator memory, no Proxmox call). */
const FOLLOW_STATUS_MS = 5_000
/** No cluster is said pending before this: the lab measured 5 to 6 s for every cluster to follow, two reads at 5 s. */
const FOLLOW_GRACE_MS = 10_000
/** The fast reads stop after this even with a cluster still pending (the engine retries it every minute): the usual pace then. */
const FOLLOW_FAST_FOR_MS = 180_000
const names = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** True when a cluster's drifts say the lift keeps its firewall off on purpose. */
const liftHeld = (drifts: MicrosegDriftList | undefined, id: string) => !!drifts?.drifts.some(d => d.kind === 'stop_lift_held' && d.object === id)

/**
 * The clusters of a shared policy that have not followed the last stop or lift yet, one line each: its mark, its chip
 * and why (pending, retried by the engine every minute, or kept off until its node access rules are checked).
 */
function StopFollowLines({ lines, on, nameOf }: { lines: { id: string; state: 'pending' | 'held' }[]; on: boolean; nameOf: (id: string) => string }) {
  const t = useTranslations('microsegPilot.stop')
  if (lines.length === 0) return null
  const pendingText = t(on ? 'followStop' : 'followResume')
  return (
    <Box role='list' data-testid='stop-follow' sx={{ minWidth: 0 }}>
      {lines.map(({ id, state }) => {
        const text = state === 'held' ? t('followHeld') : pendingText
        return (
          <Box key={id} role='listitem' sx={{ display: 'flex', alignItems: 'center', gap: 1, minHeight: 32, minWidth: 0 }}>
            <Box component='i' aria-hidden className={state === 'held' ? 'ri-shield-cross-line' : 'ri-time-line'} sx={{ color: 'warning.main', fontSize: 18, flexShrink: 0 }} />
            <ClusterChip connectionId={id} name={nameOf(id)} compact />
            <Tooltip title={text}>
              <Typography variant='body2' color='text.secondary' noWrap sx={{ minWidth: 0 }}>{text}</Typography>
            </Tooltip>
          </Box>
        )
      })}
    </Box>
  )
}

type StatusLinesProps = { lines: string[]; icon: string; color: 'warning.main' | 'error.main'; testId: string }

/** One line per cluster with a text of its own (its name is in the text), from the statuses already read. */
function ClusterStatusLines({ lines, icon, color, testId }: StatusLinesProps) {
  if (lines.length === 0) return null
  return (
    <Box role='list' data-testid={testId} sx={{ minWidth: 0 }}>
      {lines.map(text => (
        <Box key={text} role='listitem' sx={{ display: 'flex', alignItems: 'center', gap: 1, minHeight: 32, minWidth: 0 }}>
          <Box component='i' aria-hidden className={icon} sx={{ color, fontSize: 18, flexShrink: 0 }} />
          <Tooltip title={text}>
            <Typography variant='body2' color='text.secondary' noWrap sx={{ minWidth: 0 }}>{text}</Typography>
          </Tooltip>
        </Box>
      ))}
    </Box>
  )
}

/**
 * Above the sub-tabs, only when something needs the reader: the emergency stop in force, the writes held by the
 * cap, the pause, a stale status, the outcome of an action, the IP filter left off or leaving guests unfiltered, and
 * the pending changes (UA4, UA11). With none of them
 * nothing is drawn, not even an empty strip (UA27). The Emergency stop button is in the sub-tabs row; the engine
 * state and the coverage are on the page's Dashboard tab. The confirmation dialog is always mounted here.
 */
export default function MicrosegBanner({ connectionId, policy, controls, onOpenPlan, onOpenDrifts, clusterIds }: Props) {
  const t = useTranslations()
  // A shared policy: the status of every cluster (one read each, the tab's one shared with the controls); one cluster
  // reads only the controls' status, as it always did.
  const shared = !!clusterIds && clusterIds.length > 1
  // A cluster outside the user's scope is neither read nor reported (the relay would refuse it anyway).
  const visibleIds = useMemo(
    () => (shared ? (clusterIds ?? NO_CLUSTERS).filter(id => shownClusterName(id, connectionId, controls.clusterName) !== null) : NO_CLUSTERS),
    [shared, clusterIds, connectionId, controls.clusterName],
  )
  // The last stop or lift, followed on a shared policy: the statuses are read every 5 s during the first seconds and
  // then while a cluster is pending, for 3 minutes at most; at the usual pace otherwise (a held cluster included).
  const follow = shared ? controls.followUp : null
  const [graceOver, setGraceOver] = useState<StopFollowUp | null>(null)
  const [fastOver, setFastOver] = useState<StopFollowUp | null>(null)
  useEffect(() => {
    if (!follow) return
    const grace = setTimeout(() => setGraceOver(follow), FOLLOW_GRACE_MS)
    const fastEnd = setTimeout(() => setFastOver(follow), FOLLOW_FAST_FOR_MS)
    return () => { clearTimeout(grace); clearTimeout(fastEnd) }
  }, [follow])
  const [fast, setFast] = useState(false)
  const statuses = useMergedClusters(visibleIds, useMicrosegStatus, fast ? FOLLOW_STATUS_MS : undefined)
  // The IP filter: off while a zone is enforced, or guests outside every zone on the network of an enforced zone.
  const ownCluster = useMemo(() => [connectionId], [connectionId])
  const ipFilter = useIPFilterBanner(policy, shared ? visibleIds : ownCluster)
  const { canWrite } = useMicrosegWrite()
  // The held writes are confirmed on this connection alone (relay `cluster` scope): the right on it is enough.
  const canConfirm = useMicrosegClusterWrite().canWriteOn(connectionId)
  const format = useFormatter()
  const { status, statusError, reload, action, open, busy, actionError, dialogError, notice } = controls
  // A socle refusal names the addresses the rules leave out, and the Docker reason, in the user's language.
  const socleLines = dialogError?.code === 'SOCLE_MISSING'
    ? socleRefusalLines(dialogError.detail).map(line => t(`microsegPilot.${line.key}`, line.values))
    : []
  // On a shared policy it names the connection refused: said as the user knows that cluster, never as the backend wrote it.
  const refusedOn = dialogError?.code === 'SOCLE_MISSING' ? socleRefusalCluster(dialogError.serverMessage) : null
  const refusedName = refusedOn ? shownClusterName(refusedOn, connectionId, controls.clusterName) : null
  let refusedLine: string | null = null
  if (refusedOn) refusedLine = refusedName !== null ? t('microsegPilot.stop.socleOn', { name: refusedName }) : t('microsegPilot.stop.socleOnOther')
  const refusalLines = refusedLine ? [refusedLine, ...socleLines] : socleLines
  // A lift refused for the traffic between the nodes has its own wording: the generic one speaks of the web UI and SSH.
  const trafficRefused = dialogError?.code === 'SOCLE_MISSING' && isTrafficRefusal(dialogError.detail)
  let dialogErrorText: string | null = null
  if (dialogError) dialogErrorText = trafficRefused ? t('microsegPilot.stop.trafficRefused') : t(microsegErrorKeyOf(dialogError))

  // The clusters the stop and the lift act on, in the confirmation of a shared policy: those the user sees, by name,
  // and how many others.
  const hiddenCount = shared ? (clusterIds?.length ?? 0) - visibleIds.length : 0
  const visibleNames = visibleIds.map(id => shownClusterName(id, connectionId, controls.clusterName) ?? id).sort((a, b) => names.compare(a, b)).join(', ')
  const clusterList = hiddenCount > 0 ? t('microsegPilot.stop.clustersAndOthers', { names: visibleNames, count: hiddenCount }) : visibleNames

  const dialog: Record<ControlAction, { title: string; body: string; label: string; color: 'primary' | 'warning' | 'error' }> = {
    // A shared policy stops every associated cluster (listed on the line below), not only the tab's connection.
    stop: { title: t('microsegPilot.stop.title'), body: t(shared ? 'microsegPilot.stop.bodyShared' : 'microsegPilot.stop.body'), label: t('microsegPilot.stop.button'), color: 'error' },
    resume: { title: t('microsegPilot.stop.resumeTitle'), body: t('microsegPilot.stop.resumeBody'), label: t('microsegPilot.stop.resume'), color: 'primary' },
    confirmWrites: { title: t('microsegPilot.banner.confirmWritesTitle'), body: t('microsegPilot.banner.confirmWritesBody'), label: t('microsegPilot.banner.confirmWrites'), color: 'warning' },
  }

  const groupLine = (key: 'clustersStop' | 'clustersResume'): ConfirmInfoLine[] => (shared ? [{ icon: 'ri-stack-line', text: t(`microsegPilot.stop.${key}`, { names: clusterList }) }] : [])
  const infoLines: Record<ControlAction, ConfirmInfoLine[]> = {
    stop: [
      ...groupLine('clustersStop'),
      { icon: 'ri-flashlight-line', text: t('microsegPilot.stop.infoDisable') },
      { icon: 'ri-shield-cross-line', text: t('microsegPilot.stop.infoUnmanaged') },
      { icon: 'ri-shield-keyhole-line', text: t('microsegPilot.stop.infoObjects') },
      { icon: 'ri-lightbulb-line', text: t('microsegPilot.stop.infoUse') },
    ],
    resume: [
      ...groupLine('clustersResume'),
      { icon: 'ri-shield-check-line', text: t('microsegPilot.stop.resumeInfoReenable') },
      { icon: 'ri-error-warning-line', text: t('microsegPilot.stop.resumeInfoSocle') },
    ],
    confirmWrites: [],
  }

  // "Applied by the leader within a minute" is over once the status has moved.
  const shownNotice = notice?.type === 'leader' && notice.stop !== undefined && status && notice.stop !== status.emergency_stop ? null : notice
  const now = useNow(NOW_REFRESH_MS, status)
  const pausedUntil = status?.engine.paused_until
  const pausedShown = !!pausedUntil && stillPaused(pausedUntil, now)
  const stale = !!statusError && !!status
  const statusFailed = !!statusError && !status

  // The cluster firewall of each cluster, as its own status says (the stop turns each one off); a cluster whose status
  // cannot be read says so on its own line (the tab's own failure is the alert above), the others keep their state.
  const peerFailures = Object.fromEntries(Object.entries(statuses.errors).filter(([id]) => id !== connectionId))
  const stopOn = !!status?.emergency_stop || (shared && Object.values(statuses.byCluster).some(s => s?.emergency_stop))
  const firewallsOff = shared
    ? visibleIds.filter(id => {
      if (id in statuses.errors) return false
      const own = id === connectionId ? status ?? statuses.byCluster[id] : statuses.byCluster[id]
      const link = policy.clusters?.find(c => c.connection_id === id)
      return !!own && clusterFirewallOff(own, { policy: { ...policy.policy, stop_cluster_disabled: link?.stop_cluster_disabled } })
    })
    : []
  const nameOf = (id: string) => shownClusterName(id, connectionId, controls.clusterName, t('microsegPilot.plan.cluster.other'))

  // After a stop or a lift, each cluster's own status says whether it followed (the call answers for the policy).
  const stopDisabledOf = (id: string) => !!policy.clusters?.find(c => c.connection_id === id)?.stop_cluster_disabled
  const statusOf = (id: string) => (id in statuses.errors ? undefined : statuses.byCluster[id])
  // A cluster still off after a lift: its drifts say whether the engine keeps it off on purpose (read only then).
  const offAfterLift = follow && !follow.on
    ? visibleIds.filter(id => stopFollowState(false, statusOf(id), stopDisabledOf(id), false) === 'pending')
    : NO_CLUSTERS
  const liftDrifts = useMergedClusters(offAfterLift, useClusterDrifts)
  const unaligned = follow
    ? visibleIds.flatMap(id => {
      const held = Object.values(liftDrifts.byCluster).some(d => liftHeld(d, id))
      const state = stopFollowState(follow.on, statusOf(id), stopDisabledOf(id), held)
      return state ? [{ id, state }] : []
    })
    : []
  const settled = !!follow && graceOver === follow
  const anyPending = unaligned.some(l => l.state === 'pending')
  // Adjusted while rendering (React's way to follow a value): the next reads take the new pace.
  const wantFast = !!follow && fastOver !== follow && (!settled || anyPending)
  if (wantFast !== fast) setFast(wantFast)
  // "Pending" only once the clusters had the time to follow; a held cluster is said at once.
  const followLines = settled ? unaligned : unaligned.filter(l => l.state === 'held')
  const { reload: reloadStatuses } = statuses
  const { clearFollowUp } = controls
  // Every cluster is read again as soon as the call went through.
  useEffect(() => { if (follow) reloadStatuses() }, [follow, reloadStatuses])
  // Every cluster followed: nothing left to say.
  useEffect(() => { if (follow && !statuses.loading && unaligned.length === 0) clearFollowUp() }, [follow, statuses.loading, unaligned.length, clearFollowUp])

  // A cluster the engine cannot reach: its rules are not updated (the others keep its last known addresses). From the
  // statuses read above (the visible clusters only), or the tab's own on a policy of one cluster: no read of its own.
  const unreachableLines = shared
    ? visibleIds.flatMap(id => {
      const since = (id === connectionId ? status ?? statusOf(id) : statusOf(id))?.engine.unreachable_since
      return since ? [t('microsegPilot.banner.unreachableSince', { name: nameOf(id), time: formatWhen(format, since) })] : []
    })
    : (status?.engine.unreachable_since ? [t('microsegPilot.banner.unreachableSinceSingle', { time: formatWhen(format, status.engine.unreachable_since) })] : [])

  // A cluster whose firewall is off while the emergency stop does not explain it: nothing is filtered there. From the
  // statuses already read (no read of its own); the link's flag says whether a stop turned it off.
  const firewallOffLines = shared
    ? visibleIds.flatMap(id => {
      if (id in statuses.errors) return []
      const own = id === connectionId ? status ?? statuses.byCluster[id] : statuses.byCluster[id]
      return firewallOffByHand(own, stopDisabledOf(id)) ? [t('microsegPilot.banner.firewallOff', { name: nameOf(id) })] : []
    })
    : (firewallOffByHand(status, !!policy.policy.stop_cluster_disabled) ? [t('microsegPilot.banner.firewallOffSingle')] : [])

  // A reader that met a full page of the log in 24 hours may have missed lines: the strip says so, the load per node on hover.
  const logNodes = status?.engine.log_nodes ?? []
  const logBehind = logNodes.some(n => n.full_pages_24h > 0)

  const hasContent = stopOn || Object.keys(peerFailures).length > 0 || unreachableLines.length > 0 || firewallOffLines.length > 0 || followLines.length > 0 || !!status?.engine.held || !!shownNotice || actionError != null
    || statusFailed || stale || pausedShown || logBehind || !!policy.pending_changes || ipFilter.off || ipFilter.unzoned > 0

  return (
    <>
      {hasContent && (
        <Paper variant='outlined' sx={{ p: 2, mb: 2, '& > *:not(:last-child)': { mb: 2 }, '& > *:last-child': { mb: 0 } }}>
          {stopOn && (
            <Alert
              severity='error'
              variant='filled'
              action={<WriteTip><Button color='inherit' size='small' disabled={!canWrite} onClick={() => controls.ask('resume')}>{t('microsegPilot.stop.resume')}</Button></WriteTip>}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1.5 }}>
                <span>{t('microsegPilot.stop.active')}</span>
                {shared && firewallsOff.map(id => (
                  <Chip
                    key={id}
                    size='small'
                    variant='outlined'
                    icon={<i className='ri-shield-cross-line' />}
                    label={t('microsegPilot.stop.clusterFirewallOffOf', { name: nameOf(id) })}
                    sx={{ color: 'inherit', borderColor: 'currentColor', '& .MuiChip-icon': { color: 'inherit' } }}
                  />
                ))}
                {!shared && clusterFirewallOff(status, policy) && (
                  <Chip
                    size='small'
                    variant='outlined'
                    icon={<i className='ri-shield-cross-line' />}
                    label={t('microsegPilot.stop.clusterFirewallOff')}
                    sx={{ color: 'inherit', borderColor: 'currentColor', '& .MuiChip-icon': { color: 'inherit' } }}
                  />
                )}
              </Box>
            </Alert>
          )}

          {status?.engine.held && (
            <Alert
              severity='warning'
              action={<WriteTip allowed={canConfirm}><Button color='inherit' size='small' disabled={!canConfirm} onClick={() => controls.ask('confirmWrites')}>{t('microsegPilot.banner.confirmWrites')}</Button></WriteTip>}
            >
              <Typography variant='body2' component='span' sx={{ fontWeight: 600, mr: 1 }}>{t('microsegPilot.banner.held')}</Typography>
              {t('microsegPilot.banner.heldBody')}
            </Alert>
          )}

          {shownNotice?.type === 'leader' && <Alert severity='info' onClose={controls.clearNotice}>{t('microsegPilot.stop.appliedByLeader')}</Alert>}
          {shownNotice?.type === 'confirmed' && <Alert severity='success' onClose={controls.clearNotice}>{t('microsegPilot.banner.writesConfirmed')}</Alert>}
          {actionError != null && <MicrosegErrorAlert error={actionError} onClose={controls.clearActionError} />}
          {statusFailed && <MicrosegErrorAlert error={statusError} onRetry={reload} />}
          {shared && (
            // "Unreachable" only when it cannot be reached; a refusal (403, 404) only says its state cannot be read.
            <ClusterUnreadLines errors={peerFailures} tabConnection={connectionId} clusterName={controls.clusterName} variant={e => (isUnreachable(e) ? 'state' : 'refused')} />
          )}
          <ClusterStatusLines lines={unreachableLines} icon='ri-wifi-off-line' color='warning.main' testId='cluster-unreachable' />
          <ClusterStatusLines lines={firewallOffLines} icon='ri-shield-cross-line' color='error.main' testId='cluster-firewall-off' />
          {follow && <StopFollowLines lines={followLines} on={follow.on} nameOf={nameOf} />}
          {(ipFilter.off || ipFilter.unzoned > 0) && (
            <IPFilterBannerLines connectionId={connectionId} policy={policy} off={ipFilter.off} unzoned={ipFilter.unzoned} onOpenDrifts={onOpenDrifts} />
          )}

          {(pausedShown || stale || logBehind) && (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 4 }}>
              {pausedShown && (
                <Chip
                  size='small'
                  color='warning'
                  icon={<i className='ri-pause-circle-line' />}
                  label={t('microsegPilot.banner.pausedUntil', { time: formatWhen(format, pausedUntil!) })}
                />
              )}

              {stale && (
                <Chip size='small' color='warning' variant='outlined' icon={<i className='ri-wifi-off-line' />} label={t('microsegPilot.banner.statusStale')} />
              )}

              {logBehind && (
                <Tooltip title={<LogNodeLines nodes={logNodes} />} describeChild>
                  <Chip size='small' color='warning' variant='outlined' icon={<i className='ri-file-list-3-line' />} label={t('microsegPilot.banner.logBehind')} />
                </Tooltip>
              )}
            </Box>
          )}

          <PendingChangesBar connectionId={connectionId} policy={policy} onOpenPlan={onOpenPlan} clusterName={controls.clusterName} />
        </Paper>
      )}

      <MicrosegConfirmDialog
        open={open}
        title={dialog[action].title}
        body={dialog[action].body}
        infoLines={infoLines[action]}
        confirmLabel={dialog[action].label}
        color={dialog[action].color}
        busy={busy}
        error={dialogErrorText}
        errorDetail={refusalLines.length > 0 ? null : dialogError?.serverMessage}
        errorLines={refusalLines}
        onConfirm={controls.run}
        onCancel={controls.close}
      />
    </>
  )
}
