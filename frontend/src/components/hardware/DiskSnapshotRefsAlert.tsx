'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  List, ListItem, ListItemIcon, ListItemText, Typography,
} from '@mui/material'

import { deleteSnapshotsSequential } from '@/lib/migration/deleteSnapshotsSequential'

type DiskSnapshotRefsAlertProps = {
  /** Snapshots that still reference the disk's volume (non-empty). */
  snapshots: string[]
  /** 'move': "delete source" is off; 'delete': the unused disk cannot be removed. */
  mode: 'move' | 'delete'
  /** connId:type:node:vmid, the key of the snapshot DELETE route. */
  vmKey: string
  canDeleteSnapshots: boolean
  /** Called after a deletion attempt, even a partial one, so the caller rechecks. */
  onDeleted: () => void
}

/**
 * Warns that snapshots still hold a disk (#1004), and offers to delete them
 * the way the cross-cluster migration dialog does: the button never deletes
 * directly, it opens a confirmation naming every snapshot first.
 */
export function DiskSnapshotRefsAlert({ snapshots, mode, vmKey, canDeleteSnapshots, onDeleted }: DiskSnapshotRefsAlertProps) {
  const t = useTranslations()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const openConfirm = () => {
    setError(null)
    setConfirmOpen(true)
  }

  const handleConfirm = async () => {
    setBusy(true)
    setError(null)
    const result = await deleteSnapshotsSequential(vmKey, snapshots, () => {})
    setBusy(false)
    if (result.ok) setConfirmOpen(false)
    else setError(`${result.failed}: ${result.error}`)
    onDeleted()
  }

  return (
    <>
      <Alert severity="warning" icon={<i className="ri-camera-line" />}>
        {t(mode === 'move' ? 'hardware.snapshotRefsMove' : 'hardware.snapshotRefsDelete', { snapshots: snapshots.join(', ') })}
        {canDeleteSnapshots && (
          <Box sx={{ mt: 1 }}>
            <Button
              color="warning"
              variant="outlined"
              size="small"
              onClick={openConfirm}
              startIcon={<i className="ri-delete-bin-line" />}
            >
              {t('hardware.snapshotRefsDeleteButton')}
            </Button>
          </Box>
        )}
      </Alert>

      <Dialog open={confirmOpen} onClose={() => !busy && setConfirmOpen(false)} maxWidth="xs" fullWidth aria-labelledby="disk-snapshot-refs-confirm-title">
        <DialogTitle id="disk-snapshot-refs-confirm-title">{t('hardware.snapshotRefsConfirmTitle')}</DialogTitle>
        <DialogContent>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          <Typography variant="body2">{t('hardware.snapshotRefsConfirmBody')}</Typography>
          <List dense>
            {snapshots.map(name => (
              <ListItem key={name}>
                <ListItemIcon sx={{ minWidth: 32 }}>
                  <i className="ri-camera-fill" style={{ fontSize: 18 }} />
                </ListItemIcon>
                <ListItemText primary={name} />
              </ListItem>
            ))}
          </List>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setConfirmOpen(false)} disabled={busy}>{t('common.cancel')}</Button>
          <Button
            variant="contained"
            color="error"
            onClick={handleConfirm}
            disabled={busy}
            startIcon={busy ? <CircularProgress size={16} color="inherit" /> : <i className="ri-delete-bin-line" />}
          >
            {t('common.delete')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
