'use client'

import { useState } from 'react'

import { useTranslations } from 'next-intl'

import { Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material'

type Props = {
  target: { connId: string; storage: string }
  onClose: () => void
  onRemoved: () => void
}

type Refusal =
  | { kind: 'in-use'; vmids: number[]; backupJobs: string[]; storages: string[] }
  | { kind: 'unverified'; unverified: string[] }
  | { kind: 'error'; message: string }

/**
 * Removes a cluster storage that is not a PBS one (roadmap#202). The route
 * refuses while something still uses it and says what; when a node could not
 * be read, the operator may remove it anyway. The data stays on the storage.
 */
export default function RemoveClusterStorageDialog({ target, onClose, onRemoved }: Props) {
  const t = useTranslations()
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState<Refusal | null>(null)

  const remove = async (force: boolean) => {
    setBusy(true)
    setRefusal(null)
    try {
      const url = `/api/v1/connections/${encodeURIComponent(target.connId)}/storage/${encodeURIComponent(target.storage)}${force ? '?force=1' : ''}`
      const res = await fetch(url, { method: 'DELETE' })
      const json = await res.json().catch(() => ({}))

      if (res.ok) {
        onRemoved()
        onClose()
        return
      }
      if (json?.code === 'STORAGE_IN_USE') setRefusal({ kind: 'in-use', vmids: json.vmids || [], backupJobs: json.backupJobs || [], storages: json.storages || [] })
      else if (json?.code === 'STORAGE_USAGE_UNVERIFIED') setRefusal({ kind: 'unverified', unverified: json.unverified || [] })
      else setRefusal({ kind: 'error', message: json?.error || `HTTP ${res.status}` })
    } catch (e: any) {
      setRefusal({ kind: 'error', message: e?.message || String(e) })
    }
    setBusy(false)
  }

  const line = (key: string, items: Array<string | number>) => items.length > 0 && (
    <Typography variant='body2'>{t(key as any, { list: items.join(', ') })}</Typography>
  )

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth='xs' fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <i className='ri-delete-bin-line' style={{ fontSize: 20 }} />
        {t('storage.clusterStorage.removeTitle', { storage: target.storage })}
      </DialogTitle>
      <DialogContent>
        <Typography variant='body2'>{t('storage.clusterStorage.removeConfirm', { storage: target.storage })}</Typography>
        {refusal?.kind === 'in-use' && (
          <Alert severity='error' sx={{ mt: 2 }}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
              <Typography variant='body2' fontWeight={600}>{t('storage.clusterStorage.inUse', { storage: target.storage })}</Typography>
              {line('storage.clusterStorage.inUseGuests', refusal.vmids)}
              {line('storage.clusterStorage.inUseJobs', refusal.backupJobs)}
              {line('storage.clusterStorage.inUseStorages', refusal.storages)}
            </Box>
          </Alert>
        )}
        {refusal?.kind === 'unverified' && (
          <Alert severity='warning' sx={{ mt: 2 }}>{t('storage.clusterStorage.unverified', { list: refusal.unverified.join(', ') })}</Alert>
        )}
        {refusal?.kind === 'error' && <Alert severity='error' sx={{ mt: 2 }}>{refusal.message}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
        {refusal?.kind === 'unverified' ? (
          <Button variant='contained' color='error' onClick={() => remove(true)} disabled={busy} startIcon={busy ? <CircularProgress size={14} color='inherit' /> : null}>
            {t('storage.clusterStorage.removeAnyway')}
          </Button>
        ) : (
          <Button variant='contained' color='error' onClick={() => remove(false)} disabled={busy || refusal?.kind === 'in-use'} startIcon={busy ? <CircularProgress size={14} color='inherit' /> : null}>
            {t('common.delete')}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  )
}
