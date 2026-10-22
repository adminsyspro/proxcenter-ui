'use client'

import React, { useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  TextField,
  Typography,
} from '@mui/material'

import AppDialogTitle from '@/components/ui/AppDialogTitle'
import { useToast } from '@/contexts/ToastContext'
import { cephCreateUrl, postCephTask } from '@/lib/ceph/serviceClient'

/*
   Create a Ceph monitor or manager on the node being viewed (ui#1164): a
   short confirmation, the monitor with its optional address. PVE names the
   daemon after the node, so there is nothing else to choose.
*/

export type CephDaemonCreateKind = 'mon' | 'mgr'

export default function CephCreateDaemonDialog({
  open,
  kind,
  connId,
  node,
  onClose,
  onCreated,
}: Readonly<{
  open: boolean
  kind: CephDaemonCreateKind
  connId: string
  node: string
  onClose: () => void
  onCreated?: (upid?: string) => void
}>) {
  const t = useTranslations()
  const toast = useToast()
  const [address, setAddress] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const close = () => {
    if (busy) return
    setError(null)
    setAddress('')
    onClose()
  }

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const body: Record<string, unknown> = { kind }
      if (kind === 'mon' && address.trim()) body['mon-address'] = address.trim()
      const result = await postCephTask(cephCreateUrl(connId, node), body)
      if (!result.ok) {
        setError(result.error || `HTTP ${result.status}`)
        return
      }
      toast.success(t(`cephService.${kind}CreateStarted`, { node }))
      onCreated?.(result.upid)
      setAddress('')
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onClose={close} maxWidth="xs" fullWidth>
      <AppDialogTitle icon={<img src="/images/ceph-logo.svg" alt="" width={20} height={20} />} onClose={close}>
        {t(`cephService.create${kind === 'mon' ? 'Mon' : 'Mgr'}Title`, { node })}
      </AppDialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '20px !important' }}>
        <Typography variant="body2" color="text.secondary">
          {t(kind === 'mon' ? 'cephService.createMonHelp' : 'cephService.createMgrHelp')}
        </Typography>
        {kind === 'mon' && (
          <TextField
            size="small"
            fullWidth
            label={t('cephService.monAddress')}
            value={address}
            onChange={e => setAddress(e.target.value)}
            placeholder="10.0.0.1, 10.0.0.2"
            helperText={t('cephService.monAddressHelp')}
            disabled={busy}
          />
        )}
        {error && <Alert severity="error">{t('cephService.createFailed', { error })}</Alert>}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={close} color="inherit" disabled={busy}>{t('common.cancel')}</Button>
        <Button
          variant="contained"
          disabled={busy}
          startIcon={busy ? <CircularProgress size={16} /> : <i className="ri-add-line" />}
          onClick={() => void submit()}
        >
          {t('common.create')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
