'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  LinearProgress, MenuItem, Select, TextField, Typography,
} from '@mui/material'
import { useTranslations } from 'next-intl'
import type { WorkerLayout } from '@/lib/k8s/provisionOrchestrator'
import { MAX_WORKERS_PER_CHANGE, nextWorkerNames, proposeAddresses } from '@/lib/k8s/workers'
import { SMALL_SELECT_SX } from '@/components/settings/VdcQuotaRow'
import { SizeSlider, CORES_MARKS, MEMORY_MARKS, DISK_MARKS, formatCores, formatMemory, formatDisk } from '@/components/k8s/SizeSlider'
import { MIN_CORES, MIN_MEMORY, MIN_DISK } from '@/lib/k8s/provision/types'

export interface WorkerChangeState {
  status: string
  phase: string
  progress: number
  error: string | null
  layout: WorkerLayout | null
}

const POLL_MS = 5000
/** Label column of the add-workers dialog: every line starts its controls there. */
const LABEL_WIDTH = 160

/**
 * The deployment behind a cluster ProxCenter deployed: its layout and where a
 * worker change stands. null for an imported cluster. Polls while a change
 * runs, and calls onSettled once it ends.
 */
export function useWorkerChange(clusterId: string, onSettled?: () => void) {
  const [state, setState] = useState<WorkerChangeState | null>(null)
  const settledRef = useRef(onSettled)
  settledRef.current = onSettled
  const runningRef = useRef(false)

  const load = useCallback(async () => {
    const res = await fetch(`/api/v1/k8s/clusters/${clusterId}/workers`, { cache: 'no-store' }).catch(() => null)
    if (!res?.ok) { setState(null); return null }
    const body = (await res.json().catch(() => null)) as WorkerChangeState | null
    setState(body)
    const running = body?.status === 'scaling'
    if (runningRef.current && !running) settledRef.current?.()
    runningRef.current = running
    return body
  }, [clusterId])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (state?.status !== 'scaling') return
    const timer = setInterval(() => { void load() }, POLL_MS)
    return () => clearInterval(timer)
  }, [state?.status, load])

  return { state, reload: load }
}

/** Progress or outcome of a worker change, above the node table. */
export function WorkerChangeBanner({ state, onDismissError }: { state: WorkerChangeState | null; onDismissError: () => void }) {
  const t = useTranslations('kubernetes.workers')
  if (!state) return null
  if (state.status === 'scaling') {
    return (
      <Box sx={{ mb: 1.5, p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 1, bgcolor: 'background.paper' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <CircularProgress size={14} />
          <Typography variant="body2" sx={{ fontWeight: 600 }}>{t('changing')}</Typography>
          <Box sx={{ flex: 1 }} />
          <Typography variant="body2" color="text.secondary">{state.progress}%</Typography>
        </Box>
        <LinearProgress variant="determinate" value={state.progress} sx={{ mt: 1, height: 4, borderRadius: 2 }} />
      </Box>
    )
  }
  if (state.error && state.phase === 'workers') {
    return <Alert severity="error" sx={{ mb: 1.5 }} onClose={onDismissError}>{t('failed', { message: state.error })}</Alert>
  }
  return null
}

function errorText(t: ReturnType<typeof useTranslations>, code: string | undefined): string {
  const key = `error.${code}`
  return code && t.has(key) ? t(key) : t('error.generic')
}

/**
 * Adds up to MAX_WORKERS_PER_CHANGE workers, with proposed addresses and
 * VMIDs. Their size starts from the cluster's worker sizing and applies to
 * the new workers only: the deployed ones are not resized.
 */
export function AddWorkersDialog({
  clusterId, clusterName, layout, onClose, onStarted,
}: {
  clusterId: string
  clusterName: string
  layout: WorkerLayout
  onClose: () => void
  onStarted: () => void
}) {
  const t = useTranslations('kubernetes.workers')
  const [count, setCount] = useState(1)
  const [size, setSize] = useState({ cores: layout.workerCores, memory: layout.workerMemory, disk: layout.workerDisk })
  const [rows, setRows] = useState(() => proposeAddresses(layout, 1))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const names = nextWorkerNames(clusterName, layout, count)

  const changeCount = (n: number) => {
    setCount(n)
    // Keep what was typed, propose the rest after it.
    setRows(prev => {
      const kept = prev.slice(0, n)
      const more = proposeAddresses(layout, n - kept.length, kept.map(r => r.ip))
        .map((r, i) => ({ ip: r.ip, vmid: Math.max(r.vmid, ...kept.map(k => k.vmid + 1 + i)) }))
      return [...kept, ...more]
    })
  }

  const submit = async () => {
    setBusy(true)
    setError(null)
    const res = await fetch(`/api/v1/k8s/clusters/${clusterId}/workers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ add: rows.map(r => ({ ...r, ...size })) }),
    }).catch(() => null)
    const body = await res?.json().catch(() => null)
    setBusy(false)
    if (res?.ok) { onStarted(); return }
    setError(body?.error === 'invalid_request' && body?.message ? t('error.invalid', { message: body.message }) : errorText(t, body?.error))
  }

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t('addTitle', { cluster: clusterName })}</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mt: 0.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Typography sx={{ width: LABEL_WIDTH, flexShrink: 0 }}>{t('count')}</Typography>
            <Select size="small" value={count} onChange={e => changeCount(Number(e.target.value))} sx={{ ...SMALL_SELECT_SX, width: 90 }}>
              {Array.from({ length: MAX_WORKERS_PER_CHANGE }, (_, i) => i + 1).map(n => <MenuItem key={n} value={n}>{n}</MenuItem>)}
            </Select>
          </Box>
          <SizeSlider labelWidth={LABEL_WIDTH} label={t('sizeCores')} value={size.cores} min={MIN_CORES} marks={CORES_MARKS} unit="vCPU" onChange={v => setSize(p => ({ ...p, cores: v }))} formatValue={formatCores} />
          <SizeSlider labelWidth={LABEL_WIDTH} label={t('sizeMemory')} value={size.memory} min={MIN_MEMORY} marks={MEMORY_MARKS} unit="MB" onChange={v => setSize(p => ({ ...p, memory: v }))} formatValue={formatMemory} />
          <SizeSlider labelWidth={LABEL_WIDTH} label={t('sizeDisk')} value={size.disk} min={MIN_DISK} marks={DISK_MARKS} unit="GB" onChange={v => setSize(p => ({ ...p, disk: v }))} formatValue={formatDisk} />
          {rows.map((r, i) => (
            <Box key={names[i]} sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <Typography sx={{ width: LABEL_WIDTH, flexShrink: 0 }} noWrap title={names[i]}>{names[i]}</Typography>
              <TextField
                size="small" label={t('ip')} value={r.ip} sx={{ flex: 1 }}
                onChange={e => setRows(prev => prev.map((p, j) => (j === i ? { ...p, ip: e.target.value.trim() } : p)))}
              />
              <TextField
                size="small" label={t('vmid')} type="number" value={r.vmid} sx={{ width: 120, flexShrink: 0 }}
                onChange={e => setRows(prev => prev.map((p, j) => (j === i ? { ...p, vmid: Number(e.target.value) } : p)))}
              />
            </Box>
          ))}
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>{t('addHelp')}</Typography>
        {error && <Alert severity="error" sx={{ mt: 1.5 }}>{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>{t('cancel')}</Button>
        <Button variant="contained" onClick={() => { void submit() }} disabled={busy || rows.length !== count} startIcon={busy ? <CircularProgress size={14} /> : <i className="ri-add-line" />}>
          {t('add', { count })}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

/**
 * Removes one worker: drain (which cordons it), then the orchestrator
 * destroys its VM. The drain is the explorer's own, so its progress shows on
 * the node row as usual.
 */
export function RemoveWorkerDialog({
  clusterId, nodeName, drain, onClose, onStarted,
}: {
  clusterId: string
  nodeName: string
  /** Runs the explorer's drain loop; resolves with its final phase. */
  drain: (nodeName: string) => Promise<string>
  onClose: () => void
  onStarted: () => void
}) {
  const t = useTranslations('kubernetes.workers')
  const [step, setStep] = useState<'confirm' | 'draining' | 'removing'>('confirm')
  const [error, setError] = useState<string | null>(null)

  const run = async () => {
    setError(null)
    setStep('draining')
    const phase = await drain(nodeName)
    if (phase !== 'done') { setStep('confirm'); setError(t('error.drain')); return }
    setStep('removing')
    const res = await fetch(`/api/v1/k8s/clusters/${clusterId}/workers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ remove: [nodeName] }),
    }).catch(() => null)
    const body = await res?.json().catch(() => null)
    if (res?.ok) { onStarted(); return }
    setStep('confirm')
    setError(errorText(t, body?.error))
  }

  const busy = step !== 'confirm'
  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{t('removeTitle', { node: nodeName })}</DialogTitle>
      <DialogContent>
        <Typography variant="body2">{t('removeText')}</Typography>
        <Alert severity="warning" sx={{ mt: 1.5 }}>{t('removeWarning')}</Alert>
        {busy && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1.5 }}>
            <CircularProgress size={14} />
            <Typography variant="body2">{step === 'draining' ? t('draining') : t('removing')}</Typography>
          </Box>
        )}
        {error && <Alert severity="error" sx={{ mt: 1.5 }}>{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>{t('cancel')}</Button>
        <Button color="error" variant="contained" onClick={() => { void run() }} disabled={busy}>{t('remove')}</Button>
      </DialogActions>
    </Dialog>
  )
}
