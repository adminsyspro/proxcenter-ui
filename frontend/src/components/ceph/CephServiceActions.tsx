'use client'

import React, { useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  FormControlLabel,
  IconButton,
  TableCell,
  Tooltip,
  Typography,
} from '@mui/material'

import AppDialogTitle from '@/components/ui/AppDialogTitle'
import { useToast } from '@/contexts/ToastContext'
import { cephServiceUrl, postCephTask, type CephOkToStopView } from '@/lib/ceph/serviceClient'

/*
   Ceph service management of the node Ceph tab (ui#1164): the Actions cell
   of the OSD, Monitor and Manager rows (start, stop, restart of that daemon
   on the node that hosts it), and the two icon buttons of each card header
   (refresh, create). Start is immediate; stop and restart confirm in a
   dialog, and an OSD goes through ceph osd ok-to-stop first: when placement
   groups would go offline the dialog says how many and asks for an explicit
   acknowledgement before forcing.
*/

export type CephDaemonKind = 'osd' | 'mon' | 'mgr'
export type CephDaemonAction = 'start' | 'stop' | 'restart'

export interface CephDaemonTarget {
  kind: CephDaemonKind
  /** The PVE service name: osd.2, mon.pve1, mgr.pve1. */
  service: string
  /** The node that hosts the daemon, where the command must run. */
  host: string
  /** OSD up, monitor in quorum, manager active or standby. */
  running: boolean
}

const cephIcon = <img src="/images/ceph-logo.svg" alt="" width={20} height={20} />

const ACTION_ICON: Record<CephDaemonAction, string> = {
  start: 'ri-play-line',
  stop: 'ri-stop-line',
  restart: 'ri-restart-line',
}

/** The refresh and create buttons of a Ceph card header. */
export function CephCardHeaderActions({
  onRefresh,
  refreshing = false,
  onCreate,
  createLabel,
  createDisabledReason = null,
  canManage,
}: Readonly<{
  onRefresh: () => void
  refreshing?: boolean
  /** Without it the header carries the refresh button only (no OSD creation, ui#1164). */
  onCreate?: () => void
  createLabel?: string
  /** When set, the create button is disabled and this is its tooltip. */
  createDisabledReason?: string | null
  canManage: boolean
}>) {
  const t = useTranslations()
  const createTitle = canManage ? (createDisabledReason ?? createLabel ?? '') : t('cephService.noPermission')
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }} data-testid="ceph-card-actions">
      <Tooltip title={t('cephService.refresh')}>
        <span>
          <IconButton size="small" aria-label={t('cephService.refresh')} onClick={onRefresh} disabled={refreshing}>
            {refreshing ? <CircularProgress size={16} /> : <i className="ri-refresh-line" style={{ fontSize: 18 }} />}
          </IconButton>
        </span>
      </Tooltip>
      {onCreate && (
      <Tooltip title={createTitle}>
        <span>
          <IconButton
            size="small"
            color="primary"
            aria-label={createLabel}
            onClick={onCreate}
            disabled={!canManage || createDisabledReason !== null}
          >
            <i className="ri-add-line" style={{ fontSize: 18 }} />
          </IconButton>
        </span>
      </Tooltip>
      )}
    </Box>
  )
}

/** Three icon buttons, one per action, each with the reason it is disabled. */
function ActionButton({
  action,
  target,
  disabledReason,
  busy,
  onClick,
}: Readonly<{ action: CephDaemonAction; target: CephDaemonTarget; disabledReason: string | null; busy: boolean; onClick: () => void }>) {
  const t = useTranslations()
  const label = t(`cephService.${action}Service`, { service: target.service })
  return (
    <Tooltip title={disabledReason ?? label}>
      <span>
        <IconButton
          size="small"
          aria-label={label}
          disabled={disabledReason !== null}
          onClick={onClick}
          sx={{ p: 0.5 }}
        >
          {busy ? <CircularProgress size={14} /> : <i className={ACTION_ICON[action]} style={{ fontSize: 16 }} />}
        </IconButton>
      </span>
    </Tooltip>
  )
}

export function CephServiceActionsCell({
  connId,
  target,
  canManage,
  onDone,
}: Readonly<{
  connId: string
  target: CephDaemonTarget
  canManage: boolean
  /** Called once a task was started, so the caller refreshes the Ceph data shortly after. */
  onDone?: (action: CephDaemonAction, upid?: string) => void
}>) {
  const t = useTranslations()
  const toast = useToast()
  const [busy, setBusy] = useState<CephDaemonAction | null>(null)
  // The action the dialog confirms; null while closed.
  const [pending, setPending] = useState<Exclude<CephDaemonAction, 'start'> | null>(null)
  const [okToStop, setOkToStop] = useState<CephOkToStopView | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { service, host } = target

  const reason = (action: CephDaemonAction): string | null => {
    if (!canManage) return t('cephService.noPermission')
    if (busy) return null
    if (action === 'start' && target.running) return t('cephService.alreadyRunning', { service })
    if (action !== 'start' && !target.running) return t('cephService.notRunning', { service })
    return null
  }

  const run = async (action: CephDaemonAction, force: boolean): Promise<boolean> => {
    setBusy(action)
    setError(null)
    try {
      const result = await postCephTask(cephServiceUrl(connId, host), { action, service, force })
      if (result.ok) {
        toast.success(t(`cephService.${action}Started`, { service, host }))
        onDone?.(action, result.upid)
        return true
      }
      if (result.code === 'not_ok_to_stop' && !force) {
        setOkToStop(result.okToStop ?? { ok: false, message: result.error ?? null })
        return false
      }
      if (pending) setError(result.error || `HTTP ${result.status}`)
      else toast.error(t('cephService.failed', { error: result.error || `HTTP ${result.status}` }))
      return false
    } finally {
      setBusy(null)
    }
  }

  const close = () => {
    if (busy) return
    setPending(null)
    setOkToStop(null)
    setAcknowledged(false)
    setError(null)
  }

  const confirm = async () => {
    if (!pending) return
    const done = await run(pending, okToStop !== null && acknowledged)
    if (done) close()
  }

  const open = (action: Exclude<CephDaemonAction, 'start'>) => {
    setOkToStop(null)
    setAcknowledged(false)
    setError(null)
    setPending(action)
  }

  const unsafe = okToStop !== null
  const pgCount = okToStop?.numNotOkPgs ?? 0

  return (
    <TableCell align="right" sx={{ whiteSpace: 'nowrap', py: 0.5 }} data-testid={`ceph-actions-${service}`}>
      <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25 }}>
        <ActionButton action="start" target={target} disabledReason={reason('start')} busy={busy === 'start'} onClick={() => void run('start', false)} />
        <ActionButton action="stop" target={target} disabledReason={reason('stop')} busy={busy === 'stop' && !pending} onClick={() => open('stop')} />
        <ActionButton action="restart" target={target} disabledReason={reason('restart')} busy={busy === 'restart' && !pending} onClick={() => open('restart')} />
      </Box>

      <Dialog open={pending !== null} onClose={close} maxWidth="xs" fullWidth>
        <AppDialogTitle icon={cephIcon} onClose={close}>
          {pending ? t(`cephService.${pending}Title`, { service }) : ''}
        </AppDialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <Typography variant="body2">{pending ? t(`cephService.${pending}Body`, { service, host }) : ''}</Typography>

          {target.kind === 'mon' && <Alert severity="warning">{t('cephService.monQuorumWarning')}</Alert>}

          {target.kind === 'osd' && !unsafe && (
            <Typography variant="caption" color="text.secondary">{t('cephService.osdOkToStopHint')}</Typography>
          )}

          {unsafe && (
            <Alert severity="error" data-testid="ceph-not-ok-to-stop">
              <Typography variant="body2" fontWeight={600}>{t('cephService.notOkToStop', { service })}</Typography>
              <Typography variant="body2">
                {okToStop?.message
                  ? t('cephService.notOkToStopUnknown', { error: okToStop.message })
                  : t('cephService.notOkToStopPgs', { count: pgCount })}
              </Typography>
              <FormControlLabel
                sx={{ mt: 0.5 }}
                control={<Checkbox size="small" checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)} />}
                label={t('cephService.acknowledge')}
              />
            </Alert>
          )}

          {error && <Alert severity="error">{t('cephService.failed', { error })}</Alert>}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={close} color="inherit" disabled={busy !== null}>{t('common.cancel')}</Button>
          <Button
            variant="contained"
            color={unsafe || target.kind === 'mon' ? 'warning' : 'primary'}
            disabled={busy !== null || (unsafe && !acknowledged)}
            startIcon={busy ? <CircularProgress size={16} /> : <i className={pending ? ACTION_ICON[pending] : ''} />}
            onClick={() => void confirm()}
          >
            {pending ? t(`cephService.${pending}`) : ''}
          </Button>
        </DialogActions>
      </Dialog>
    </TableCell>
  )
}
