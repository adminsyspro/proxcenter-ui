'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'

import {
  Alert, Button, Checkbox, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Typography,
} from '@mui/material'

type CancelJob = {
  targetVmid?: number | null
  config?: { migrationType?: string | null } | null
} | null | undefined

/**
 * Confirmation of a migration cancel once data is copied. A warm migration
 * keeps a completed copy on the target after a failure (#612); on a cancel
 * the operator chooses, and removing it is ticked by default: a copy waiting
 * for a cutover that will not come is of no use.
 */
export default function CancelMigrationDialog({ open, job, busy = false, onClose, onConfirm }: {
  open: boolean
  job: CancelJob
  busy?: boolean
  onClose: () => void
  onConfirm: (removeTarget: boolean) => void
}) {
  const t = useTranslations()
  const warm = job?.config?.migrationType === 'warm'
  const [removeTarget, setRemoveTarget] = useState(true)

  // Ticked again each time the dialog opens.
  useEffect(() => {
    if (open) setRemoveTarget(true)
  }, [open])

  const k = (key: string, values?: Record<string, string | number>) => t(`inventoryPage.esxiMigration.${key}`, values)
  const removes = warm && removeTarget

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'error.main' }}>
        <i className="ri-error-warning-line" style={{ fontSize: 20 }} />
        {k('cancelMigrationConfirmTitle')}
      </DialogTitle>
      <DialogContent>
        <Typography sx={{ mb: 1.5 }}>{k('cancelMigrationConfirmStop')}</Typography>
        {warm && (
          <FormControlLabel
            sx={{ mb: 1.5 }}
            control={<Checkbox size="small" checked={removeTarget} onChange={e => setRemoveTarget(e.target.checked)} />}
            label={job?.targetVmid ? k('cancelMigrationRemoveTarget', { vmid: job.targetVmid }) : k('cancelMigrationRemoveCopy')}
          />
        )}
        {!removes && <Alert severity="warning" sx={{ mb: 1.5 }}>{k('cancelMigrationConfirmVolumesKept')}</Alert>}
        <Typography variant="body2" color="text.secondary">{k('cancelMigrationConfirmSourceUntouched')}</Typography>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} color="inherit">{k('keepMigrating')}</Button>
        <Button
          variant="contained"
          color="error"
          disabled={busy}
          startIcon={busy ? <CircularProgress size={16} /> : undefined}
          onClick={() => onConfirm(removes)}
        >
          {k('cancelMigration')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
