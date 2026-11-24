'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import { MicrosegApiError, microsegApi, microsegErrorKeyOf } from '@/lib/microseg/api'
import type { PreflightCheck, PreflightStatus } from '@/lib/microseg/types'
import { clustersToRead, useMergedClusters, type ClusterRead } from '@/lib/microseg/useMerged'

import ClusterChip from './ClusterChip'
import { shownClusterName } from './ClusterRunRow'
import { ONE_LINE_SX } from './dialogParts'
import IPFilterDetailsDialog from './IPFilterDetailsDialog'
import { heldByStop, ipFilterNotComputed, logSettingsHref, opensLogSettings, opensWizard, parseRate, preflightMessage, raisesLogRate } from './preflightModel'
import { WriteTip, useMicrosegWrite } from './microsegAccess'
import TruncatedText from './TruncatedText'

const STATUS_ICON: Record<PreflightStatus, { icon: string; color: string }> = {
  pass: { icon: 'ri-checkbox-circle-fill', color: 'success.main' },
  warn: { icon: 'ri-alert-fill', color: 'warning.main' },
  fail: { icon: 'ri-close-circle-fill', color: 'error.main' },
}

type ChipOf = { id: string; name: string }

function CheckRow({ check, onOpenWizard, onResume, rateLimit, cluster, onIPFilterDetails, connectionId }: { check: PreflightCheck; onOpenWizard?: () => void; onResume?: () => void; rateLimit?: RateLimitFix; cluster?: ChipOf; onIPFilterDetails?: () => void; connectionId: string }) {
  const t = useTranslations('microsegPilot.preflight')
  const tStop = useTranslations('microsegPilot.stop')
  const tFilter = useTranslations('microsegPilot.ipFilter.details')
  const { title, detail, more = [], joiner = ' ' } = preflightMessage(check)
  const name = title ? t(`checks.${title}.title`) : check.id
  // The rate PVE writes ("20/second") is said with a translated unit; any other wording is shown as PVE wrote it.
  const rawRate = detail?.values?.rate
  const rate = parseRate(typeof rawRate === 'string' ? rawRate : undefined)
  const values = rate ? { ...detail?.values, rate: t(`rateUnits.${rate.unit}`, { count: rate.count }) } : detail?.values
  // Every reason on the same line, in full in the tooltip of the cut text.
  const message = detail ? [t(detail.key, values), ...more.map(line => t(line.key, line.values))].join(joiner) : ''
  // The engine raises the log rate while a zone observes once the settings hold the rate to use: the warning is then handled.
  const planned = raisesLogRate(check, rateLimit?.observe)
  const plannedRate = planned ? parseRate(planned) : null
  const plannedText = planned ? t('checks.log_ratelimit.planned', { rate: plannedRate ? t(`rateUnits.${plannedRate.unit}`, { count: plannedRate.count }) : planned }) : ''
  const icon = planned ? STATUS_ICON.pass : STATUS_ICON[check.status] ?? STATUS_ICON.warn
  const raisable = check.id === 'log_ratelimit' && check.status === 'warn' && !planned && !!rateLimit?.onRaise

  return (
    <Box role='listitem' aria-label={`${name}: ${t(`status.${check.status}`)}`} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minHeight: 48, minWidth: 0, borderBottom: 1, borderColor: 'divider' }}>
      <Box component='i' className={icon.icon} sx={{ color: icon.color, fontSize: 20, flexShrink: 0 }} />
      {cluster && <ClusterChip connectionId={cluster.id} name={cluster.name} compact />}
      <TruncatedText text={name} fontWeight={600} sx={{ flex: '0 0 auto', width: 170 }} />
      <TruncatedText text={planned ? plannedText : message} variant='body2' color='text.secondary' sx={{ flex: '1 1 0', minWidth: 0 }} />
      {raisable && <RaiseLogRate onRaise={rateLimit!.onRaise!} />}
      {onIPFilterDetails && check.id === 'ip_filter' && !ipFilterNotComputed(check) && (
        <Button size='small' variant='outlined' onClick={onIPFilterDetails} sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}>{tFilter('button')}</Button>
      )}
      {onResume && heldByStop(check) && (
        <Button size='small' variant='outlined' color='error' onClick={onResume} sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}>{tStop('resume')}</Button>
      )}
      {onOpenWizard && opensWizard(check) && (
        <Button size='small' variant='outlined' onClick={onOpenWizard} sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}>{t('openWizard')}</Button>
      )}
      {/* The collection mode is a setting of the cluster connection: the fix opens it there, it switches nothing. */}
      {opensLogSettings(check) && (
        <Button size='small' variant='outlined' href={logSettingsHref(connectionId)} sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}>{t('openLogSettings')}</Button>
      )}
    </Box>
  )
}

/**
 * The log rate the engine raises the cluster to while a zone is observed (`observe_log_rate_limit` of the settings, empty
 * when unset), and the write that sets it to the recommended value (absent: no button).
 */
export type RateLimitFix = { observe: string; onRaise?: () => Promise<void> }

/** "Raise while observing": sets the rate of the settings, the engine applies it with the next plan and restores it after. */
function RaiseLogRate({ onRaise }: { onRaise: () => Promise<void> }) {
  const t = useTranslations('microsegPilot.preflight')
  const tAll = useTranslations()
  const { canWrite } = useMicrosegWrite()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const raise = async () => {
    setBusy(true)
    setError(null)
    try {
      await onRaise()
    } catch (e) {
      setError(e)
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      {!!error && <Typography variant='caption' color='error' noWrap sx={{ flexShrink: 1, minWidth: 0 }}>{tAll(microsegErrorKeyOf(error))}</Typography>}
      <WriteTip>
        <Button size='small' variant='outlined' onClick={() => { void raise() }} disabled={!canWrite || busy} data-testid='preflight-raise-log-rate' sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}
          startIcon={busy ? <CircularProgress size={14} /> : undefined}>
          {t('raiseLogRate')}
        </Button>
      </WriteTip>
    </>
  )
}

/**
 * The pre-flight checks of one cluster, read once per `round` (an opening, a retry, the wizard done): nothing is cached.
 * Nothing is read without a cluster or a round. The answer is tagged with the round it belongs to, so a new one never
 * shows the previous answer.
 */
function usePreflightRead(connId: string | null, round: string | null): ClusterRead<PreflightCheck[]> {
  const key = connId && round ? `${connId}:${round}` : null
  const [state, setState] = useState<{ key: string | null; checks: PreflightCheck[] | null; error: unknown }>({ key: null, checks: null, error: null })
  useEffect(() => {
    if (!key || !connId) return
    let cancelled = false
    microsegApi(connId).getPreflight().then(
      checks => { if (!cancelled) setState({ key, checks, error: null }) },
      (error: unknown) => { if (!cancelled) setState({ key, checks: null, error }) },
    )
    return () => { cancelled = true }
  }, [key, connId])
  const current = state.key === key
  return { data: current ? state.checks ?? undefined : undefined, error: current ? state.error ?? undefined : undefined, loading: !!key && !current }
}

type Props = {
  open: boolean
  connectionId: string
  /** The clusters sharing the policy: each one's checks are read and listed with its chip; the connection alone when absent. */
  clusterIds?: string[]
  /**
   * The group's anchor, undefined while the group is read: with `clusterIds`, nothing is read before the group is known,
   * so the tab's cluster never moves to another read slot and runs its checks (Proxmox calls) twice.
   */
  anchor?: string
  clusterName?: (id: string) => string
  onClose: () => void
  /** Changes when the cluster may have changed under the panel (the wizard ran): the checks are read again. */
  refreshKey?: number
  /** Opens the deployment wizard (the fix of the cluster firewall check: it turns it on, and writes nothing on the nodes); absent: no fix button. */
  onOpenWizard?: () => void
  /** Opens the resume dialog (the fix of a cluster firewall the emergency stop holds off); absent: no button. */
  onResume?: () => void
  /** The log rate of the settings and how to set it, for the log rate check. */
  rateLimit?: RateLimitFix
}

/**
 * The pre-flight checks of a connection, one line each; on a shared policy those of every cluster, each line with its
 * cluster's chip, a cluster that cannot be read on a line of its own. The clusters are read on every opening: nothing
 * is cached.
 */
export default function PreflightPanel({ open, connectionId, clusterIds, anchor, clusterName, onClose, refreshKey = 0, onOpenWizard, onResume, rateLimit }: Props) {
  const t = useTranslations('microsegPilot.preflight')
  const tAll = useTranslations()
  const [attempt, setAttempt] = useState(0)
  // The cluster whose IP filter details are open (the line of that cluster's check).
  const [filterOf, setFilterOf] = useState<string | null>(null)
  const ids = useMemo(() => clustersToRead(connectionId, { anchor, clusterIds }), [connectionId, anchor, clusterIds])
  const shared = ids.length > 1
  const round = open ? `${refreshKey}:${attempt}` : null
  const useClusterChecks = (id: string | null) => usePreflightRead(id, round)
  const reads = useMergedClusters(ids, useClusterChecks)

  const retry = useCallback(() => setAttempt(n => n + 1), [])

  const failureOf = (error: unknown): string | null => {
    if (!error) return null
    const code = error instanceof MicrosegApiError ? error.code : ''
    if (code === 'BUSY') return t('busy')
    if (code === 'NOT_FOUND') return t('noClient')
    return tAll(microsegErrorKeyOf(error))
  }

  // One cluster: the checks and the failure of its read, as they always were shown.
  const checks = shared ? null : reads.byCluster[connectionId] ?? null
  const failure = shared ? null : failureOf(reads.errors[connectionId])
  const chipOf = (id: string): ChipOf => ({ id, name: shownClusterName(id, connectionId, clusterName, tAll('microsegPilot.plan.cluster.other')) })
  // The deployment wizard writes to the tab's connection: its fix is offered on that cluster's lines only.
  const sharedRows = shared ? ids.flatMap(id => {
    const failed = failureOf(reads.errors[id])
    if (failed) {
      return [(
        <Box key={`${id}:failed`} role='listitem' aria-label={failed} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minHeight: 48, minWidth: 0, borderBottom: 1, borderColor: 'divider' }}>
          <Box component='i' className={STATUS_ICON.warn.icon} sx={{ color: STATUS_ICON.warn.color, fontSize: 20, flexShrink: 0 }} />
          <ClusterChip connectionId={id} name={chipOf(id).name} compact />
          <TruncatedText text={failed} variant='body2' color='text.secondary' sx={{ flex: '1 1 0', minWidth: 0 }} />
        </Box>
      )]
    }
    return (reads.byCluster[id] ?? []).map(check => (
      <CheckRow key={`${id}:${check.id}`} check={check} connectionId={id} cluster={chipOf(id)} onOpenWizard={id === connectionId ? onOpenWizard : undefined} onResume={onResume} rateLimit={rateLimit} onIPFilterDetails={() => setFilterOf(id)} />
    ))
  }) : []

  return (
    <>
    <Dialog open={open} onClose={onClose} maxWidth='md' fullWidth aria-labelledby='microseg-preflight-title'>
      <DialogTitle id='microseg-preflight-title' sx={ONE_LINE_SX}>{t('title')}</DialogTitle>
      <DialogContent>
        {failure && (
          <Alert severity='warning' action={<Button color='inherit' size='small' onClick={retry}>{tAll('common.retry')}</Button>}>
            {failure}
          </Alert>
        )}
        {shared && sharedRows.length > 0 && <Box role='list'>{sharedRows}</Box>}
        {((!shared && !failure && !checks) || (shared && reads.loading)) && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 1 }}>
            <CircularProgress size={18} />
            <Typography color='text.secondary' noWrap>{t('checking')}</Typography>
          </Box>
        )}
        {checks && (
          <Box role='list'>
            {checks.map(check => <CheckRow key={check.id} check={check} connectionId={connectionId} onOpenWizard={onOpenWizard} onResume={onResume} rateLimit={rateLimit} onIPFilterDetails={() => setFilterOf(connectionId)} />)}
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        {!failure && <Button onClick={retry} disabled={shared ? reads.loading : !checks}>{t('runAgain')}</Button>}
        <Button onClick={onClose} variant='contained'>{tAll('common.close')}</Button>
      </DialogActions>
    </Dialog>
    {filterOf !== null && <IPFilterDetailsDialog connectionId={connectionId} clusterIds={[filterOf]} clusterName={clusterName} onClose={() => setFilterOf(null)} />}
    </>
  )
}
