'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'

import { Button, Dialog, DialogActions, DialogContent, Stack, Typography } from '@mui/material'

import AppDialogTitle from '@/components/ui/AppDialogTitle'

import { gpuErrorMessage, OneLine, OneLineAlert } from './myGpuShared'

interface Props {
  vdcId: string
  vmid: string
  vmName: string
  vmStatus: string
  /** Kind of the GPU, e.g. "vGPU RTXA5000-12Q". */
  gpuLabel: string
  hostpci: string
  onClose: () => void
  onDone: () => void
}

const LABEL_WIDTH = 110

/** Confirms the release of one GPU of a VM, one fact per line. */
export default function MyGpuReleaseDialog({ vdcId, vmid, vmName, vmStatus, gpuLabel, hostpci, onClose, onDone }: Props) {
  const t = useTranslations()
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const r = await fetch(`/api/v1/vdcs/${encodeURIComponent(vdcId)}/gpu`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'release', vmid, hostpci }),
      })
      const json = await r.json().catch(() => null)
      if (!r.ok) {
        setError(gpuErrorMessage(t, json?.error, json))
        return
      }
      // The release of a running VM only applies after a stop and start: say so before closing.
      if (json?.data?.pendingStart === true) setPending(true)
      else onDone()
    } catch {
      setError(gpuErrorMessage(t, 'unavailable'))
    } finally {
      setBusy(false)
    }
  }

  const facts: Array<[string, string]> = [
    [t('myVdc.gpu.releaseVm'), `${vmName} (#${vmid})`],
    [t('myVdc.gpu.releaseGpu'), gpuLabel],
  ]

  return (
    <Dialog open onClose={busy ? undefined : pending ? onDone : onClose} maxWidth="sm" fullWidth>
      <AppDialogTitle onClose={busy ? undefined : pending ? onDone : onClose} icon={<i className="ri-cpu-line" style={{ fontSize: 20 }} />}>
        <Typography variant="h6" component="span" noWrap sx={{ display: 'block' }}>{t('myVdc.gpu.releaseTitle')}</Typography>
      </AppDialogTitle>
      <DialogContent>
        <Stack spacing={1} sx={{ mt: 1 }}>
          {facts.map(([label, value]) => (
            <Stack key={label} direction="row" alignItems="center" spacing={1.5} sx={{ minWidth: 0 }}>
              <Typography variant="body2" color="text.secondary" noWrap sx={{ width: LABEL_WIDTH, flexShrink: 0 }}>{label}</Typography>
              <OneLine>{value}</OneLine>
            </Stack>
          ))}
          <OneLine variant="caption" color="text.secondary">{t('myVdc.gpu.releaseHint')}</OneLine>
          {pending && <OneLineAlert severity="info">{t('myVdc.gpu.releasePending')}</OneLineAlert>}
          {!pending && vmStatus === 'running' && <OneLineAlert severity="warning">{t('myVdc.gpu.releaseRunning')}</OneLineAlert>}
          {error && <OneLineAlert severity="error">{error}</OneLineAlert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        {pending ? (
          <Button variant="contained" onClick={onDone}>{t('common.close')}</Button>
        ) : (
          <>
            <Button onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
            <Button variant="contained" color="warning" onClick={submit} disabled={busy}>
              {t('myVdc.gpu.release')}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  )
}
