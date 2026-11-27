'use client'
import { useEffect, useState } from 'react'
import {
  Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle,
  Radio, TextField, Typography,
} from '@mui/material'
import { useTranslations } from 'next-intl'
import type { ResourceListItem } from '@/lib/k8s/types'
import type { WorkloadAction } from '@/lib/k8s/workloadActions'
import { MAX_REPLICAS } from '@/lib/k8s/workloadActions'
import { relativeAge } from '@/lib/k8s/overviewCharts'

interface Revision { revision: number; createdAt: string; images: string[]; replicas: number; current: boolean }

/** Desired replicas from a "ready/desired" summary cell, or null. */
export function desiredReplicas(item: ResourceListItem): number | null {
  const m = /^\d+\/(\d+)$/.exec(item.summary?.['ready'] ?? '')
  return m ? Number(m[1]) : null
}

const ERROR_KEYS = ['forbidden', 'not_found', 'auth_failed', 'unreachable', 'conflict'] as const

export function WorkloadActionDialog({
  clusterId, action, item, onClose, onDone,
}: {
  clusterId: string
  action: WorkloadAction
  item: ResourceListItem
  onClose: () => void
  /** Called after the cluster accepted the action, with the message to show. */
  onDone: (message: string) => void
}) {
  const t = useTranslations('kubernetes.workload')
  const desired = desiredReplicas(item)
  const [replicas, setReplicas] = useState<string>(desired === null ? '' : String(desired))
  const [revisions, setRevisions] = useState<Revision[] | null>(null)
  const [revision, setRevision] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const errorText = (code: string | undefined) =>
    (ERROR_KEYS as readonly string[]).includes(code ?? '') ? t(`error.${code}`) : t('error.generic')

  useEffect(() => {
    if (action !== 'rollback') return
    const ac = new AbortController()
    const qs = new URLSearchParams({ namespace: item.namespace ?? '', name: item.name })
    fetch(`/api/v1/k8s/clusters/${clusterId}/revisions?${qs}`, { signal: ac.signal })
      .then(async res => {
        const body = await res.json().catch(() => null)
        if (!res.ok) { setError(errorText(body?.error)); setRevisions([]); return }
        const list: Revision[] = body?.revisions ?? []
        setRevisions(list)
        setRevision(list.find(r => !r.current)?.revision ?? null)
      })
      .catch(err => { if ((err as Error).name !== 'AbortError') { setError(t('error.generic')); setRevisions([]) } })
    return () => ac.abort()
    // errorText depends only on t
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action, clusterId, item.namespace, item.name])

  const replicaCount = Number(replicas)
  const replicasValid = replicas !== '' && Number.isInteger(replicaCount) && replicaCount >= 0 && replicaCount <= MAX_REPLICAS
  let actionReady = true
  if (action === 'scale') actionReady = replicasValid && replicaCount !== desired
  else if (action === 'rollback') actionReady = revision !== null
  const canSubmit = !busy && actionReady

  const submit = async () => {
    setBusy(true)
    setError(null)
    const body: Record<string, unknown> = { action, kind: item.kind, namespace: item.namespace, name: item.name }
    if (action === 'scale') body.replicas = replicaCount
    if (action === 'rollback') body.revision = revision
    try {
      const res = await fetch(`/api/v1/k8s/clusters/${clusterId}/actions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) { setError(errorText(data?.error)); return }
      let doneMessage: string
      if (action === 'scale') doneMessage = t('done.scale', { name: item.name, count: data?.replicas ?? replicaCount })
      else if (action === 'rollback') doneMessage = t('done.rollback', { name: item.name, revision: revision ?? 0 })
      else doneMessage = t(`done.${action}`, { name: item.name })
      onDone(doneMessage)
    } catch {
      setError(t('error.generic'))
    } finally {
      setBusy(false)
    }
  }

  const title = t(`title.${action}`, { name: item.name })
  const noRevision = revisions !== null && revisions.filter(r => !r.current).length === 0 && !error

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth={action === 'rollback' ? 'sm' : 'xs'} fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        {(action === 'restart' || action === 'delete') && (
          <DialogContentText>{t(`body.${action}`)}</DialogContentText>
        )}

        {action === 'scale' && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, pt: 1 }}>
            <Typography sx={{ flex: 1 }}>{t('replicas')}</Typography>
            <TextField
              size="small"
              type="number"
              value={replicas}
              onChange={e => setReplicas(e.target.value)}
              error={replicas !== '' && !replicasValid}
              slotProps={{ htmlInput: { min: 0, max: MAX_REPLICAS, step: 1, 'aria-label': t('replicas') } }}
              sx={{ width: 120 }}
            />
            {desired !== null && (
              <Typography variant="caption" color="text.secondary" sx={{ width: 110 }}>
                {t('currentReplicas', { count: desired })}
              </Typography>
            )}
          </Box>
        )}

        {action === 'rollback' && revisions === null && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}><CircularProgress size={22} /></Box>
        )}
        {action === 'rollback' && noRevision && (
          <DialogContentText>{t('noRevision')}</DialogContentText>
        )}
        {action === 'rollback' && revisions !== null && !noRevision && (
          <Box role="radiogroup" aria-label={title}>
            {revisions.map(r => (
              <Box
                key={r.revision}
                onClick={() => { if (!r.current) setRevision(r.revision) }}
                sx={{
                  display: 'flex', alignItems: 'center', gap: 1, py: 0.25, px: 0.5, borderRadius: 1,
                  cursor: r.current ? 'default' : 'pointer', opacity: r.current ? 0.6 : 1,
                  '&:hover': r.current ? undefined : { bgcolor: 'action.hover' },
                }}
              >
                <Radio size="small" checked={revision === r.revision} disabled={r.current} slotProps={{ input: { 'aria-label': t('revision', { revision: r.revision }) } }} />
                <Typography sx={{ width: 110, flexShrink: 0 }}>{t('revision', { revision: r.revision })}</Typography>
                <Typography noWrap sx={{ flex: 1, minWidth: 0 }} title={r.images.join(', ')}>{r.images.join(', ')}</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ width: 70, textAlign: 'right', flexShrink: 0 }} title={r.createdAt}>
                  {r.current ? t('current') : relativeAge(r.createdAt)}
                </Typography>
              </Box>
            ))}
          </Box>
        )}

        {error && <Alert severity="error" sx={{ mt: 1.5 }}>{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>{t('cancel')}</Button>
        <Button
          variant="contained"
          color={action === 'delete' ? 'error' : 'primary'}
          onClick={submit}
          disabled={!canSubmit}
          startIcon={busy ? <CircularProgress size={16} /> : undefined}
        >
          {t(`action.${action}`)}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
