'use client'

import React, { useRef, useState } from 'react'
import { useTranslations } from 'next-intl'

import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  LinearProgress,
  Tooltip,
  Typography,
} from '@mui/material'

import { uploadFileToStorage } from '@/lib/storage/uploadClient'

export interface IsoStorageRow {
  storage: string
  type?: string
  /** Set by the storages route for iaas tenants: upload-enabled ISO library or writable local storage. */
  tenantCanUpload?: boolean
}

interface IsoUploadControlsProps {
  connId: string
  node: string
  storage: string
  storageRow: IsoStorageRow | undefined
  /** Currently selected ISO file name (basename), if any. */
  selectedIso: string
  /** Called with the STORED name (the server may namespace it) once the upload landed. */
  onUploaded: (filename: string) => void | Promise<void>
  onDeleted: () => void | Promise<void>
  /** Mirrors the busy state so the host dialog can freeze its Save button. */
  onBusy?: (busy: boolean) => void
}

/**
 * Tenant-side "bring your own ISO" for the CD/DVD dialogs (#894): an upload
 * button when the selected storage accepts tenant uploads, and a delete
 * button on the tenant's own files (`custom-*`, the provider catalogue never
 * carries that prefix on a library). Renders nothing otherwise, so provider
 * and read-only flows look exactly as before.
 */
export function IsoUploadControls({
  connId, node, storage, storageRow, selectedIso, onUploaded, onDeleted, onBusy,
}: IsoUploadControlsProps) {
  const t = useTranslations()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadName, setUploadName] = useState('')
  const [pct, setPct] = useState(0)
  const [transferring, setTransferring] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!storageRow?.tenantCanUpload || !storage) return null

  const setBusy = (b: boolean) => onBusy?.(b)
  const ownFile = !!selectedIso && selectedIso.split('/').pop()!.startsWith('custom-')

  const handlePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError(null)
    setUploading(true)
    setBusy(true)
    setUploadName(file.name)
    setPct(0)
    setTransferring(false)
    try {
      const { filename } = await uploadFileToStorage({
        connId, node, storage, file, contentType: 'iso',
        onProgress: setPct,
        onPhase: (ph) => setTransferring(ph === 'transferring'),
      })
      await onUploaded(filename)
    } catch (err: any) {
      setError(err?.message || String(err))
    } finally {
      setUploading(false)
      setTransferring(false)
      setBusy(false)
    }
  }

  const handleDelete = async () => {
    setConfirmOpen(false)
    setError(null)
    setDeleting(true)
    setBusy(true)
    try {
      const volid = `${storage}:iso/${selectedIso}`
      const res = await fetch(
        `/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/storage/${encodeURIComponent(storage)}/content/${encodeURIComponent(volid)}`,
        { method: 'DELETE' },
      )
      if (!res.ok) {
        const json = await res.json().catch(() => ({} as any))
        throw new Error(json?.error || `HTTP ${res.status}`)
      }
      await onDeleted()
    } catch (err: any) {
      setError(err?.message || String(err))
    } finally {
      setDeleting(false)
      setBusy(false)
    }
  }

  return (
    <Box data-testid="iso-upload-controls" sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Button
          size="small"
          variant="outlined"
          component="label"
          disabled={uploading || deleting}
          startIcon={uploading ? <CircularProgress size={14} /> : <i className="ri-upload-2-line" />}
        >
          {t('hardware.cdrom.uploadIso')}
          <input
            ref={inputRef}
            type="file"
            hidden
            accept=".iso,application/x-iso9660-image"
            onChange={handlePick}
            data-testid="iso-upload-input"
          />
        </Button>
        {ownFile && (
          <Tooltip title={t('hardware.cdrom.deleteIso')} arrow>
            <span>
              <IconButton
                size="small"
                color="error"
                aria-label={t('hardware.cdrom.deleteIso')}
                disabled={uploading || deleting}
                onClick={() => setConfirmOpen(true)}
              >
                {deleting ? <CircularProgress size={16} /> : <i className="ri-delete-bin-line" style={{ fontSize: 18 }} />}
              </IconButton>
            </span>
          </Tooltip>
        )}
      </Box>

      {uploading && (
        <Box>
          <Typography variant="caption" color="text.secondary">
            {transferring
              ? t('hardware.cdrom.transferringIso', { name: uploadName })
              : t('hardware.cdrom.uploadingIso', { name: uploadName, pct })}
          </Typography>
          <LinearProgress variant={transferring ? 'indeterminate' : 'determinate'} value={pct} sx={{ mt: 0.5 }} />
        </Box>
      )}

      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('hardware.cdrom.deleteIso')}</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            {t('hardware.cdrom.deleteIsoConfirm', { name: selectedIso, storage })}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)}>{t('common.cancel')}</Button>
          <Button color="error" variant="contained" onClick={handleDelete}>{t('common.delete')}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

export default IsoUploadControls
