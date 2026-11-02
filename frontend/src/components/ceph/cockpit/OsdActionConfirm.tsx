'use client'

import { useState, type FormEvent } from 'react'

import { Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, TextField, Typography } from '@mui/material'
import { useFormatter, useTranslations } from 'next-intl'

import AppDialogTitle from '@/components/ui/AppDialogTitle'
import type { OkToStopPayload } from '@/lib/ceph/okToStop'
import type { OutImpact } from '@/lib/ceph/osdOutImpact'
import { forceForVerdict, needsOsdNameTyping, okToStopVerdict } from '@/lib/ceph/osdTable'
import { binaryUnit } from '@/lib/ceph/overview'
import type { CephOsd } from '@/lib/ceph/types'

import { Eyebrow, TABULAR, ThresholdBar, usePercent } from './ui'

/*
   Confirmation of the risky OSD actions (out, stop, restart). The modal shows the
   estimated fill of the other OSDs and the verdict of `ceph osd ok-to-stop`; it asks to
   type the OSD name when the verdict is refused or missing, or when the projected fill
   passes nearfull or cannot be estimated. It confirms with force only when the verdict was overridden. While the verdict is being asked
   nothing can be confirmed: a verdict not yet known is never read as a safe one.
*/

export type OsdRiskyAction = 'out' | 'stop' | 'restart'

export interface OsdActionConfirmProps {
  action: OsdRiskyAction
  osd: CephOsd
  impact: OutImpact
  /** The verdict of the ok-to-stop route; null when it could not be obtained. */
  okToStop: OkToStopPayload | null
  /** The verdict is still being asked. */
  loading?: boolean
  ratios: { nearfull: number; full: number }
  /** Fill (0 to 1) of the fullest receiver before the move, for the "before" gauge. */
  beforeRatio?: number | null
  busy?: boolean
  error?: string | null
  /** A warning above the verdict, e.g. Ceph changed its mind since the modal opened. */
  notice?: string | null
  /** `force` is true only when Ceph's verdict is overridden (refused or missing); a typed name for the projection alone sends false. */
  onConfirm: (force: boolean) => void
  onCancel: () => void
}

const ICON: Record<OsdRiskyAction, string> = { out: 'ri-logout-box-r-line', stop: 'ri-stop-circle-line', restart: 'ri-restart-line' }

function Verdict({ verdict, payload }: { verdict: ReturnType<typeof okToStopVerdict>; payload: OkToStopPayload | null }) {
  const t = useTranslations('cephCockpit.osd.confirm')
  const color = verdict === 'ok' ? 'success.main' : verdict === 'checking' ? 'text.secondary' : 'error.main'
  const icon = verdict === 'ok' ? 'ri-checkbox-circle-line' : verdict === 'checking' ? 'ri-time-line' : 'ri-error-warning-line'
  let text: string

  if (verdict === 'checking') text = t('verdictChecking')
  else if (verdict === 'ok') text = t('verdictOk')
  else if (verdict === 'refused') text = payload && payload.numNotOkPgs > 0 ? t('verdictRefused', { count: payload.numNotOkPgs }) : t('verdictRefusedBare')
  else text = payload?.message ? t('verdictUnknown', { error: payload.message }) : t('verdictUnknownBare')

  return (
    <Box data-testid='osd-verdict' data-verdict={verdict} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, color }}>
      {verdict === 'checking' ? <CircularProgress size={14} sx={{ mt: '3px' }} /> : <i className={icon} style={{ fontSize: 16, marginTop: 2 }} aria-hidden />}
      <Typography variant='body2' sx={{ color: 'text.primary' }}>{text}</Typography>
    </Box>
  )
}

function Impact({ action, osd, impact, ratios, beforeRatio }: Pick<OsdActionConfirmProps, 'action' | 'osd' | 'impact' | 'ratios' | 'beforeRatio'>) {
  const t = useTranslations('cephCockpit.osd.confirm')
  const format = useFormatter()
  const percent = usePercent()
  const unit = binaryUnit(impact.movedBytes)
  const moved = `${format.number(impact.movedBytes / unit.divisor, { maximumFractionDigits: 1 })} ${unit.unit}`
  const nothing = !impact.unknown && impact.movedBytes <= 0 && impact.receivers > 0 && !osd.in
  const noReceiver = !impact.unknown && impact.receivers === 0 && impact.movedBytes > 0
  const values = { pct: percent(impact.maxProjectedRatio, 1), nearfull: percent(ratios.nearfull, 0) }

  return (
    <Box data-testid='osd-impact' sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
      <Eyebrow>{t('impactTitle')}</Eyebrow>
      {nothing && <Typography variant='body2' color='text.secondary'>{t('moveNothing', { id: osd.id })}</Typography>}
      {noReceiver && <Typography variant='body2' sx={{ color: 'error.main' }}>{t('noReceiver', { class: osd.deviceClass })}</Typography>}
      {impact.unknown && <Typography variant='body2' sx={{ color: 'warning.main' }}>{t('estimateUnknown', { id: osd.id })}</Typography>}
      {!impact.unknown && !nothing && !noReceiver && (
        <>
          <Typography variant='body2' color='text.secondary' sx={TABULAR}>{t('moved', { size: moved, count: impact.receivers })}</Typography>
          {typeof beforeRatio === 'number' && (
            <Box sx={{ display: 'grid', gridTemplateColumns: '48px 1fr 56px', alignItems: 'center', columnGap: 1 }}>
              <Typography variant='caption' color='text.secondary'>{t('before')}</Typography>
              <ThresholdBar value={beforeRatio} max={1} nearfull={ratios.nearfull} full={ratios.full} size='sm' />
              <Typography variant='body2' fontWeight={700} sx={{ ...TABULAR, textAlign: 'right' }}>{percent(beforeRatio, 1)}</Typography>
            </Box>
          )}
          <Box sx={{ display: 'grid', gridTemplateColumns: '48px 1fr 56px', alignItems: 'center', columnGap: 1 }}>
            <Typography variant='caption' color='text.secondary'>{t('after')}</Typography>
            <ThresholdBar value={impact.maxProjectedRatio} max={1} nearfull={ratios.nearfull} full={ratios.full} size='sm' />
            <Typography variant='body2' fontWeight={700} sx={{ ...TABULAR, textAlign: 'right', color: impact.overNearfull ? 'error.main' : undefined }}>
              {percent(impact.maxProjectedRatio, 1)}
            </Typography>
          </Box>
          <Typography variant='body2' color='text.secondary' sx={{ display: 'block' }}>
            {impact.overNearfull ? t('projectedOver', values) : t('projectedUnder', values)}
          </Typography>
        </>
      )}
      {action !== 'out' && <Typography variant='caption' color='text.secondary' sx={{ display: 'block' }}>{t('stopNote')}</Typography>}
    </Box>
  )
}

export default function OsdActionConfirm({
  action, osd, impact, okToStop, loading = false, ratios, beforeRatio = null, busy = false, error = null, notice = null, onConfirm, onCancel,
}: Readonly<OsdActionConfirmProps>) {
  const t = useTranslations('cephCockpit.osd.confirm')
  const [typed, setTyped] = useState('')
  const verdict = okToStopVerdict(okToStop, loading)
  // A name typed for one verdict never carries over to another: when the verdict or the notice changes
  // (a late refusal after a name typed for the projection alone), the field starts empty again.
  const resetKey = `${verdict}|${notice ?? ''}|${okToStop?.numNotOkPgs ?? ''}|${okToStop?.message ?? ''}`
  const [seenKey, setSeenKey] = useState(resetKey)

  if (seenKey !== resetKey) {
    setSeenKey(resetKey)
    setTyped('')
  }

  const typing = needsOsdNameTyping(verdict, impact)
  const name = `osd.${osd.id}`
  const nameOk = typed.trim() === name
  // A verdict still being asked blocks everything; typing needs the exact name.
  const canConfirm = !busy && verdict !== 'checking' && (!typing || nameOk)
  const reasons = [
    verdict === 'refused' && t('reasonRefused'),
    verdict === 'unknown' && t('reasonUnknown'),
    impact.unknown && t('reasonLoadUnknown'),
    !impact.unknown && impact.overNearfull && t('reasonNearfull'),
  ].filter((r): r is string => Boolean(r))

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (canConfirm) onConfirm(forceForVerdict(verdict))
  }

  return (
    <Dialog open onClose={() => { if (!busy) onCancel() }} maxWidth='sm' fullWidth>
      <Box component='form' data-testid='osd-confirm-form' onSubmit={submit} noValidate>
        <AppDialogTitle icon={<i className={ICON[action]} style={{ fontSize: 22 }} aria-hidden />} onClose={busy ? undefined : onCancel}>
          {t(`title.${action}`, { id: osd.id })}
        </AppDialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Typography variant='body2'>{t(`body.${action}`, { id: osd.id, host: osd.host, pgs: osd.pgs ?? 0 })}</Typography>
          <Impact action={action} osd={osd} impact={impact} ratios={ratios} beforeRatio={beforeRatio} />
          {notice && <Alert severity='warning' data-testid='osd-notice'>{notice}</Alert>}
          <Verdict verdict={verdict} payload={okToStop} />

          {verdict !== 'checking' && typing && (
            <Alert severity='warning' icon={<i className='ri-error-warning-line' />} sx={{ alignItems: 'flex-start', '& .MuiAlert-message': { overflow: 'visible' } }}>
              <Typography variant='body2' sx={{ mb: 0.5 }}>{t('typeIntro')}</Typography>
              <Box component='ul' sx={{ m: 0, mb: 1.5, pl: 2.5 }}>
                {reasons.map(r => <li key={r}><Typography variant='body2'>{r}</Typography></li>)}
              </Box>
              <TextField
                autoFocus
                fullWidth
                size='small'
                value={typed}
                onChange={e => setTyped(e.target.value)}
                disabled={busy}
                label={t('typeLabel')}
                placeholder={name}
                helperText={t('typePrompt', { name })}
                slotProps={{ htmlInput: { autoComplete: 'off', spellCheck: false } }}
              />
            </Alert>
          )}

          {error && <Alert severity='error'>{t('error', { error })}</Alert>}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button type='button' color='inherit' onClick={onCancel} disabled={busy}>{t('cancel')}</Button>
          <Button
            type='submit'
            variant='contained'
            color={typing && verdict !== 'checking' ? 'error' : 'warning'}
            disabled={!canConfirm}
            startIcon={busy ? <CircularProgress size={16} color='inherit' /> : undefined}
          >
            {typing && verdict !== 'checking' ? t(`forceAction.${action}`) : t(`action.${action}`)}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  )
}
