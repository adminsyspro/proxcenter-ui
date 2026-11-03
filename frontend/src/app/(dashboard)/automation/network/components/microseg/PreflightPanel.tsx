'use client'

import { useCallback, useEffect, useState } from 'react'
import { Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Tooltip, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import { MicrosegApiError, microsegApi, microsegErrorKeyOf } from '@/lib/microseg/api'
import type { PreflightCheck, PreflightStatus } from '@/lib/microseg/types'

import { ONE_LINE_SX } from './dialogParts'
import { heldByStop, opensWizard, parseRate, preflightMessage } from './preflightModel'

const STATUS_ICON: Record<PreflightStatus, { icon: string; color: string }> = {
  pass: { icon: 'ri-checkbox-circle-fill', color: 'success.main' },
  warn: { icon: 'ri-alert-fill', color: 'warning.main' },
  fail: { icon: 'ri-close-circle-fill', color: 'error.main' },
}

function CheckRow({ check, onOpenWizard, onResume }: { check: PreflightCheck; onOpenWizard?: () => void; onResume?: () => void }) {
  const t = useTranslations('microsegPilot.preflight')
  const tStop = useTranslations('microsegPilot.stop')
  const { title, detail } = preflightMessage(check)
  const name = title ? t(`checks.${title}.title`) : check.id
  // The rate PVE writes ("20/second") is said with a translated unit; any other wording is shown as PVE wrote it.
  const rawRate = detail?.values?.rate
  const rate = parseRate(typeof rawRate === 'string' ? rawRate : undefined)
  const values = rate ? { ...detail?.values, rate: t(`rateUnits.${rate.unit}`, { count: rate.count }) } : detail?.values
  const message = detail ? t(detail.key, values) : ''
  const icon = STATUS_ICON[check.status] ?? STATUS_ICON.warn

  return (
    <Box role='listitem' aria-label={`${name}: ${t(`status.${check.status}`)}`} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minHeight: 48, minWidth: 0, borderBottom: 1, borderColor: 'divider' }}>
      <Box component='i' className={icon.icon} sx={{ color: icon.color, fontSize: 20, flexShrink: 0 }} />
      <Tooltip title={name}><Typography noWrap fontWeight={600} sx={{ flex: '0 0 auto', width: 170 }}>{name}</Typography></Tooltip>
      <Tooltip title={message}><Typography noWrap variant='body2' color='text.secondary' sx={{ flex: '1 1 0', minWidth: 0 }}>{message}</Typography></Tooltip>
      {onResume && heldByStop(check) && (
        <Button size='small' variant='outlined' color='error' onClick={onResume} sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}>{tStop('resume')}</Button>
      )}
      {onOpenWizard && opensWizard(check) && (
        <Button size='small' variant='outlined' onClick={onOpenWizard} sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}>{t('openWizard')}</Button>
      )}
    </Box>
  )
}

type Props = {
  open: boolean
  connectionId: string
  onClose: () => void
  /** Changes when the cluster may have changed under the panel (the wizard ran): the checks are read again. */
  refreshKey?: number
  /** Opens the deployment wizard (the fix of the socle and cluster firewall checks); absent: no fix button. */
  onOpenWizard?: () => void
  /** Opens the resume dialog (the fix of a cluster firewall the emergency stop holds off); absent: no button. */
  onResume?: () => void
}

/** The pre-flight checks of a connection, one line each. The cluster is read on every opening: nothing is cached. */
export default function PreflightPanel({ open, connectionId, onClose, refreshKey = 0, onOpenWizard, onResume }: Props) {
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
            {checks.map(check => <CheckRow key={check.id} check={check} onOpenWizard={onOpenWizard} onResume={onResume} />)}
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
