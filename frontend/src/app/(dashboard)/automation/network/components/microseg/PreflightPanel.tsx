'use client'

import { useCallback, useEffect, useState } from 'react'
import { Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import { MicrosegApiError, microsegApi, microsegErrorKeyOf } from '@/lib/microseg/api'
import type { PreflightCheck, PreflightStatus } from '@/lib/microseg/types'

import { ONE_LINE_SX } from './dialogParts'
import { heldByStop, opensWizard, parseRate, preflightMessage, raisesLogRate } from './preflightModel'
import { WriteTip, useMicrosegWrite } from './microsegAccess'
import TruncatedText from './TruncatedText'

const STATUS_ICON: Record<PreflightStatus, { icon: string; color: string }> = {
  pass: { icon: 'ri-checkbox-circle-fill', color: 'success.main' },
  warn: { icon: 'ri-alert-fill', color: 'warning.main' },
  fail: { icon: 'ri-close-circle-fill', color: 'error.main' },
}

function CheckRow({ check, onOpenWizard, onResume, rateLimit }: { check: PreflightCheck; onOpenWizard?: () => void; onResume?: () => void; rateLimit?: RateLimitFix }) {
  const t = useTranslations('microsegPilot.preflight')
  const tStop = useTranslations('microsegPilot.stop')
  const { title, detail, more = [] } = preflightMessage(check)
  const name = title ? t(`checks.${title}.title`) : check.id
  // The rate PVE writes ("20/second") is said with a translated unit; any other wording is shown as PVE wrote it.
  const rawRate = detail?.values?.rate
  const rate = parseRate(typeof rawRate === 'string' ? rawRate : undefined)
  const values = rate ? { ...detail?.values, rate: t(`rateUnits.${rate.unit}`, { count: rate.count }) } : detail?.values
  // Every reason on the same line, in full in the tooltip of the cut text.
  const message = detail ? [t(detail.key, values), ...more.map(line => t(line.key, line.values))].join(' ') : ''
  // The engine raises the log rate while a zone observes once the settings hold the rate to use: the warning is then handled.
  const planned = raisesLogRate(check, rateLimit?.observe)
  const plannedRate = planned ? parseRate(planned) : null
  const plannedText = planned ? t('checks.log_ratelimit.planned', { rate: plannedRate ? t(`rateUnits.${plannedRate.unit}`, { count: plannedRate.count }) : planned }) : ''
  const icon = planned ? STATUS_ICON.pass : STATUS_ICON[check.status] ?? STATUS_ICON.warn
  const raisable = check.id === 'log_ratelimit' && check.status === 'warn' && !planned && !!rateLimit?.onRaise

  return (
    <Box role='listitem' aria-label={`${name}: ${t(`status.${check.status}`)}`} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minHeight: 48, minWidth: 0, borderBottom: 1, borderColor: 'divider' }}>
      <Box component='i' className={icon.icon} sx={{ color: icon.color, fontSize: 20, flexShrink: 0 }} />
      <TruncatedText text={name} fontWeight={600} sx={{ flex: '0 0 auto', width: 170 }} />
      <TruncatedText text={planned ? plannedText : message} variant='body2' color='text.secondary' sx={{ flex: '1 1 0', minWidth: 0 }} />
      {raisable && <RaiseLogRate onRaise={rateLimit!.onRaise!} />}
      {onResume && heldByStop(check) && (
        <Button size='small' variant='outlined' color='error' onClick={onResume} sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}>{tStop('resume')}</Button>
      )}
      {onOpenWizard && opensWizard(check) && (
        <Button size='small' variant='outlined' onClick={onOpenWizard} sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}>{t('openWizard')}</Button>
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

type Props = {
  open: boolean
  connectionId: string
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

/** The pre-flight checks of a connection, one line each. The cluster is read on every opening: nothing is cached. */
export default function PreflightPanel({ open, connectionId, onClose, refreshKey = 0, onOpenWizard, onResume, rateLimit }: Props) {
  const t = useTranslations('microsegPilot.preflight')
  const tAll = useTranslations()
  const [attempt, setAttempt] = useState(0)
  // The answer is tagged with the request it belongs to, so a new opening, round or retry never shows the previous one.
  const key = open ? `${connectionId}:${refreshKey}:${attempt}` : null
  const [state, setState] = useState<{ key: string | null; checks: PreflightCheck[] | null; error: unknown }>({ key: null, checks: null, error: null })

  useEffect(() => {
    if (!key) return
    let cancelled = false
    microsegApi(connectionId).getPreflight().then(
      checks => { if (!cancelled) setState({ key, checks, error: null }) },
      (error: unknown) => { if (!cancelled) setState({ key, checks: null, error }) },
    )
    return () => { cancelled = true }
  }, [key, connectionId])

  const current = state.key === key
  const checks = current ? state.checks : null
  const error = current ? state.error : null

  const retry = useCallback(() => setAttempt(n => n + 1), [])

  let failure: string | null = null
  if (error) {
    const code = error instanceof MicrosegApiError ? error.code : ''
    if (code === 'BUSY') failure = t('busy')
    else if (code === 'NOT_FOUND') failure = t('noClient')
    else failure = tAll(microsegErrorKeyOf(error))
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth='md' fullWidth aria-labelledby='microseg-preflight-title'>
      <DialogTitle id='microseg-preflight-title' sx={ONE_LINE_SX}>{t('title')}</DialogTitle>
      <DialogContent>
        {failure && (
          <Alert severity='warning' action={<Button color='inherit' size='small' onClick={retry}>{tAll('common.retry')}</Button>}>
            {failure}
          </Alert>
        )}
        {!failure && !checks && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 1 }}>
            <CircularProgress size={18} />
            <Typography color='text.secondary' noWrap>{t('checking')}</Typography>
          </Box>
        )}
        {checks && (
          <Box role='list'>
            {checks.map(check => <CheckRow key={check.id} check={check} onOpenWizard={onOpenWizard} onResume={onResume} rateLimit={rateLimit} />)}
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        {!failure && <Button onClick={retry} disabled={!checks}>{t('runAgain')}</Button>}
        <Button onClick={onClose} variant='contained'>{tAll('common.close')}</Button>
      </DialogActions>
    </Dialog>
  )
}
