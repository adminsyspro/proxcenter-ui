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
 * The way out of a refused guest shutdown.
 *
 * The pipeline asks the guest to shut down and then waits for a confirmed
 * powered-off state. When the guest refuses, that wait used to be silent and the
 * run was lost. It is now a step of its own, and this is the action attached to
 * it: stop the source hard, on the operator's decision only, because a hard power
 * off makes the final delta crash-consistent (#614).
 */

type PowerOffJob = {
  id: string
  status: string
  currentStep?: string | null
} | null | undefined

/** True while the pipeline is waiting for the source to reach a powered-off state. */
export function isAwaitingPowerOff(job: PowerOffJob): boolean {
  return job?.currentStep === 'awaiting_power_off'
    && !['completed', 'failed', 'cancelled'].includes(job?.status ?? '')
}

export default function ForcePowerOffButton({
  job,
  size = 'small',
  onRequested,
}: {
  job: PowerOffJob
  size?: 'small' | 'medium'
  onRequested?: () => void
}) {
  const t = useTranslations()
  const theme = useTheme()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  if (!isAwaitingPowerOff(job)) return null

  const requestForcePowerOff = async () => {
    setBusy(true)
    try {
      await fetch(`/api/v1/migrations/${job!.id}/force-poweroff`, { method: 'POST' })
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
        variant="contained"
        color="error"
        disabled={busy}
        startIcon={<i className="ri-shut-down-line" style={{ fontSize: 14 }} />}
        onClick={() => setConfirmOpen(true)}
        sx={{ textTransform: 'none' }}
      >
        {t('inventoryPage.esxiMigration.forcePowerOff')}
      </Button>

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Box sx={{
            width: 40, height: 40, borderRadius: 2,
            bgcolor: alpha(theme.palette.error.main, 0.12),
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <i className="ri-shut-down-line" style={{ fontSize: 22, color: theme.palette.error.main }} />
          </Box>
          {t('inventoryPage.esxiMigration.forcePowerOffConfirmTitle')}
        </DialogTitle>
        <DialogContent>
          <DialogContentText>
            {t('inventoryPage.esxiMigration.forcePowerOffConfirmBody')}
          </DialogContentText>
          <Alert severity="warning" sx={{ mt: 2 }}>
            {t('inventoryPage.esxiMigration.forcePowerOffCrashConsistent')}
          </Alert>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setConfirmOpen(false)} color="inherit">
            {t('common.cancel')}
          </Button>
          <Button
            variant="contained"
            color="error"
            disabled={busy}
            startIcon={busy ? <CircularProgress size={16} /> : undefined}
            onClick={requestForcePowerOff}
          >
            {t('inventoryPage.esxiMigration.forcePowerOff')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
