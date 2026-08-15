'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'

import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from '@mui/material'
import { alpha, useTheme } from '@mui/material/styles'

/**
 * The operator's switchover control, with its confirmation.
 *
 * One component rather than a copy per surface: the button belongs both to the
 * VM panel (where a job started through the API is followed) and to the migrate
 * dialog (where the operator who started the run is actually looking). Two
 * hand-written copies would drift, and the first one to drift would be the one
 * nobody is watching.
 */

type WarmJob = {
  id: string
  status: string
  projectedDowntimeSec?: number | null
  config?: { cutoverMode?: string } | null
} | null | undefined

/**
 * A manual-cutover run holds in `delta_sync`, replicating, instead of parking in
 * `awaiting_cutover`. It is waiting for the operator all the same, so both read
 * as "waiting" everywhere in the UI (#443).
 */
export function isWarmHold(job: WarmJob): boolean {
  return job?.config?.cutoverMode === 'manual' && job?.status === 'delta_sync'
}

/** True when the migration is waiting on a human, whichever way it got there. */
export function isAwaitingOperator(job: WarmJob): boolean {
  return isWarmHold(job) || job?.status === 'awaiting_cutover'
}

/**
 * The cutover can only be requested once a delta pass has produced an estimate:
 * before that the pipeline has no projection to show and no change id to resume
 * from.
 */
export function canRequestCutover(job: WarmJob): boolean {
  return !!job && ['delta_sync', 'awaiting_cutover'].includes(job.status) && job.projectedDowntimeSec != null
}

export default function WarmCutoverButton({
  job,
  size = 'small',
  onRequested,
}: {
  job: WarmJob
  size?: 'small' | 'medium'
  onRequested?: () => void
}) {
  const t = useTranslations()
  const theme = useTheme()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  if (!canRequestCutover(job)) return null

  const awaiting = isAwaitingOperator(job)
  const mins = Math.round((job!.projectedDowntimeSec ?? 0) / 60)

  const requestCutover = async () => {
    setBusy(true)
    try {
      await fetch(`/api/v1/migrations/${job!.id}/cutover`, { method: 'POST' })
      onRequested?.()
    } finally {
      setBusy(false)
      setConfirmOpen(false)
    }
  }

  return (
    <>
      <Button
        size={size}
        variant={awaiting ? 'contained' : 'outlined'}
        color="primary"
        disabled={busy}
        startIcon={<i className="ri-flashlight-line" style={{ fontSize: 14 }} />}
        onClick={() => setConfirmOpen(true)}
        sx={{ textTransform: 'none' }}
      >
        {t('inventoryPage.esxiMigration.cutoverNow')}
      </Button>

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Box sx={{
            width: 40, height: 40, borderRadius: 2,
            bgcolor: alpha(theme.palette.primary.main, 0.12),
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <i className="ri-flashlight-line" style={{ fontSize: 22, color: theme.palette.primary.main }} />
          </Box>
          {t('inventoryPage.esxiMigration.cutoverConfirmTitle')}
        </DialogTitle>
        <DialogContent>
          <DialogContentText>
            {t('inventoryPage.esxiMigration.cutoverConfirmBody', { mins })}
          </DialogContentText>
          {/* Only the automatic mode can reach the gate, and only there does the
              warning hold: a manual hold is waiting on purpose, not diverging. */}
          {job!.status === 'awaiting_cutover' && (
            <Alert severity="warning" sx={{ mt: 2 }}>
              {t('inventoryPage.esxiMigration.cutoverNotConverging')}
            </Alert>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setConfirmOpen(false)} color="inherit">
            {t('common.cancel')}
          </Button>
          <Button
            variant="contained"
            color="primary"
            disabled={busy}
            startIcon={busy ? <CircularProgress size={16} /> : undefined}
            onClick={requestCutover}
          >
            {t('inventoryPage.esxiMigration.cutoverNow')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
