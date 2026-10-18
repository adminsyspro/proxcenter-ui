'use client'

import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

/**
 * Why a DRS recommendation action did not go through: the guest moved, the
 * recommendation expired, or the orchestrator refused it (a rolling update in
 * progress on the cluster, a node being drained...). It used to be a native
 * alert(), out of the application theme.
 */
export default function DrsActionNoticeDialog({
  message,
  onClose,
}: Readonly<{
  message: string | null
  onClose: () => void
}>) {
  const t = useTranslations()

  return (
    <Dialog open={!!message} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'warning.main' }}>
        <i className="ri-error-warning-line" style={{ fontSize: 20 }} />
        {t('drsPage.actionNoticeTitle')}
      </DialogTitle>
      <DialogContent>
        <Typography>{message}</Typography>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button variant="contained" onClick={onClose}>
          {t('common.close')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
