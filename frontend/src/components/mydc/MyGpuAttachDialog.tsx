'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'

import { Button, Dialog, DialogActions, DialogContent, MenuItem, Select, Stack, Typography } from '@mui/material'

import AppDialogTitle from '@/components/ui/AppDialogTitle'
import type { MyGpuEntry } from '@/lib/gpu/vdcView'

import { entryLabel, gpuErrorMessage, OneLine, OneLineAlert } from './myGpuShared'

type Candidate = { vmid: string; name: string; status: string }

interface Props {
  vdcId: string
  entries: MyGpuEntry[]
  onClose: () => void
  onDone: () => void
}

const LABEL_WIDTH = 110

const SMALL_SELECT_SX = {
  '& .MuiInputBase-input.MuiSelect-select': { minHeight: '1.4375em', lineHeight: '1.4375em' },
} as const

/** A line is open while it holds fewer cards than its contingent. */
const hasRoom = (e: MyGpuEntry) => !e.overCommitted && e.used < e.count

/**
 * Gives a GPU to one of the tenant's VMs: the VM comes from the candidates
 * route, the contingent line from the card's own view. The server picks the
 * physical card, so nothing here names infrastructure.
 */
export default function MyGpuAttachDialog({ vdcId, entries, onClose, onDone }: Props) {
  const t = useTranslations()
  const [candidates, setCandidates] = useState<Candidate[] | null>(null)
  const [vmid, setVmid] = useState('')
  const [entryId, setEntryId] = useState('')
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const r = await fetch(`/api/v1/vdcs/${encodeURIComponent(vdcId)}/gpu/candidates`, { cache: 'no-store' })
        const json = await r.json().catch(() => null)
        if (cancelled) return
        if (!r.ok) {
          setCandidates([])
          setError(gpuErrorMessage(t, json?.error ?? 'unavailable', json))
          return
        }
        setCandidates(Array.isArray(json?.data) ? json.data : [])
      } catch {
        if (cancelled) return
        setCandidates([])
        setError(gpuErrorMessage(t, 'unavailable'))
      }
    })()
    return () => { cancelled = true }
    // t is stable per locale; the candidates are read once per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vdcId])

  const chosen = candidates?.find((c) => c.vmid === vmid)

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const r = await fetch(`/api/v1/vdcs/${encodeURIComponent(vdcId)}/gpu`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'attach', vmid, entryId }),
      })
      const json = await r.json().catch(() => null)
      if (!r.ok) {
        setError(gpuErrorMessage(t, json?.error, json))
        return
      }
      // A whole card on a running VM only shows up after a stop and start: say so before closing.
      if (json?.data?.pendingStart === true) setPending(true)
      else onDone()
    } catch {
      setError(gpuErrorMessage(t, 'unavailable'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onClose={busy ? undefined : pending ? onDone : onClose} maxWidth="sm" fullWidth>
      <AppDialogTitle onClose={busy ? undefined : pending ? onDone : onClose} icon={<i className="ri-cpu-line" style={{ fontSize: 20 }} />}>
        <Typography variant="h6" component="span" noWrap sx={{ display: 'block' }}>{t('myVdc.gpu.attachTitle')}</Typography>
      </AppDialogTitle>
      <DialogContent>
        <Stack spacing={1.5} sx={{ mt: 1 }}>
          <Stack direction="row" alignItems="center" spacing={1.5}>
            <Typography variant="body2" color="text.secondary" noWrap sx={{ width: LABEL_WIDTH, flexShrink: 0 }}>
              {t('myVdc.gpu.attachVm')}
            </Typography>
            <Select
              size="small"
              fullWidth
              displayEmpty
              sx={SMALL_SELECT_SX}
              value={vmid}
              disabled={candidates === null || busy || pending}
              onChange={(e) => setVmid(String(e.target.value))}
              renderValue={(v) => {
                const c = candidates?.find((x) => x.vmid === v)
                return c ? `${c.name} (#${c.vmid})` : t(candidates === null ? 'myVdc.gpu.attachLoading' : 'myVdc.gpu.attachPickVm')
              }}
            >
              {(candidates ?? []).map((c) => (
                <MenuItem key={c.vmid} value={c.vmid}>
                  <OneLine>{`${c.name} (#${c.vmid})`}</OneLine>
                </MenuItem>
              ))}
            </Select>
          </Stack>

          <Stack direction="row" alignItems="center" spacing={1.5}>
            <Typography variant="body2" color="text.secondary" noWrap sx={{ width: LABEL_WIDTH, flexShrink: 0 }}>
              {t('myVdc.gpu.attachEntry')}
            </Typography>
            <Select
              size="small"
              fullWidth
              displayEmpty
              sx={SMALL_SELECT_SX}
              value={entryId}
              disabled={busy || pending}
              onChange={(e) => setEntryId(String(e.target.value))}
              renderValue={(v) => {
                const e = entries.find((x) => x.id === v)
                return e ? entryLabel(t, e) : t('myVdc.gpu.attachPickEntry')
              }}
            >
              {entries.map((e) => (
                <MenuItem key={e.id} value={e.id} disabled={!hasRoom(e)}>
                  <OneLine>{entryLabel(t, e)}</OneLine>
                </MenuItem>
              ))}
            </Select>
          </Stack>

          {candidates !== null && candidates.length === 0 && !error && (
            <OneLine variant="caption" color="text.secondary">{t('myVdc.gpu.attachNoVm')}</OneLine>
          )}
          {pending && <OneLineAlert severity="info">{t('myVdc.gpu.attachPending')}</OneLineAlert>}
          {!pending && chosen?.status === 'running' && (
            <OneLineAlert severity="warning">{t('myVdc.gpu.attachRunning')}</OneLineAlert>
          )}
          {error && <OneLineAlert severity="error">{error}</OneLineAlert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        {pending ? (
          <Button variant="contained" onClick={onDone}>{t('common.close')}</Button>
        ) : (
          <>
            <Button onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
            <Button variant="contained" onClick={submit} disabled={busy || !vmid || !entryId}>
              {t('myVdc.gpu.attachSubmit')}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  )
}
