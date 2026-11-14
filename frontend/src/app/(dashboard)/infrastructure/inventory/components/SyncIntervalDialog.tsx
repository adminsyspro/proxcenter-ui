'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'

import { Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, FormControlLabel, Tooltip, Typography } from '@mui/material'

import PagedRows from '@/components/ui/PagedRows'
import { SYNC_INTERVAL_DEFAULT_SEC, estimateCutover, formatSyncInterval, type CutoverMeasure } from '@/lib/migration/warm/sync-interval'

import { formatDowntimeBudget } from './migrationGuards'
import SyncIntervalSlider from './SyncIntervalSlider'

export interface SyncIntervalJob {
  jobId: string
  name: string
  /** The interval the migration syncs at now. */
  syncIntervalSec?: number | null
  /** The interval the engine suggests from the syncs it measured. */
  suggestedSyncIntervalSec?: number | null
  /** What those syncs measured: the cutover is estimated from it for the interval on the slider. */
  measure?: CutoverMeasure | null
}

interface SkippedJob { jobId: string; sourceVmName: string | null; status: string; error?: string }

/** The suggestion every selected VM can live with: the shortest one, when each has one. */
function commonSuggestion(jobs: SyncIntervalJob[]): number | null {
  const values = jobs.map(j => j.suggestedSyncIntervalSec)
  if (values.length === 0 || values.some(v => typeof v !== 'number')) return null
  return Math.min(...(values as number[]))
}

/**
 * The cutover the selected VMs would get at an interval: the longest catch-up
 * sync and the longest downtime among the ones that have been measured, next
 * to the tightest downtime those migrations aim at. `over` when one of them
 * would miss its own target. Null while none has been measured.
 */
function worstCutover(jobs: SyncIntervalJob[], intervalSec: number): { catchUpSec: number; downtimeSec: number; targetSec: number | null; over: boolean } | null {
  const estimates = jobs.flatMap(j => (j.measure ? [{ ...estimateCutover(j.measure, intervalSec), targetSec: j.measure.targetDowntimeSec }] : []))
  if (estimates.length === 0) return null
  const targets = estimates.flatMap(e => (e.targetSec ? [e.targetSec] : []))
  return {
    catchUpSec: Math.max(...estimates.map(e => e.catchUpSec)),
    downtimeSec: Math.max(...estimates.map(e => e.downtimeSec)),
    targetSec: targets.length > 0 ? Math.min(...targets) : null,
    over: estimates.some(e => e.targetSec != null && e.downtimeSec > e.targetSec),
  }
}

/**
 * Change the interval between two syncs of migrations that already wait for
 * their manual cutover: one migration (`jobId`), or the waiting VMs of a bulk
 * batch (`batchId`), all selected, which the operator can untick.
 *
 * The slider starts on the interval in force and the engine's suggestion sits
 * under it with a button that moves the slider there: nothing is applied until
 * the operator confirms.
 */
export default function SyncIntervalDialog({ open, jobId, batchId, jobs, defaultSyncIntervalSec, onClose, onDone }: {
  open: boolean
  /** A single migration: the request goes to its own route. */
  jobId?: string
  /** A bulk batch: the request names the selected VMs. */
  batchId?: string
  jobs: SyncIntervalJob[]
  /** The setting of the source connection, offered as "back to the default" for a single migration. */
  defaultSyncIntervalSec?: number | null
  onClose: () => void
  /** Called after a request the server accepted, so the caller reads the state again. */
  onDone: () => void
}) {
  const t = useTranslations()
  const k = (key: string, values?: Record<string, any>) => t(`inventoryPage.esxiMigration.${key}`, values)
  const [selected, setSelected] = useState<Set<string>>(() => new Set(jobs.map(j => j.jobId)))
  const [valueSec, setValueSec] = useState<number>(jobs[0]?.syncIntervalSec ?? SYNC_INTERVAL_DEFAULT_SEC)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [skipped, setSkipped] = useState<SkippedJob[]>([])

  // Each opening starts from the interval in force and from every waiting VM.
  useEffect(() => {
    if (!open) return
    setSelected(new Set(jobs.map(j => j.jobId)))
    setValueSec(jobs[0]?.syncIntervalSec ?? SYNC_INTERVAL_DEFAULT_SEC)
    setError(null)
    setSkipped([])
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset on open only: the list refreshes under an open dialog
  }, [open])

  const shown = jobs.filter(j => selected.has(j.jobId))
  const all = shown.length === jobs.length && jobs.length > 0
  const suggestion = commonSuggestion(shown)
  const estimate = worstCutover(shown, valueSec)
  const estimateValues = estimate && { catchUp: formatDowntimeBudget(estimate.catchUpSec), downtime: formatDowntimeBudget(estimate.downtimeSec) }
  let estimateText = k('syncIntervalNoEstimate')
  if (estimate && estimateValues) {
    estimateText = estimate.targetSec != null
      ? k('syncIntervalEstimateWithTarget', { ...estimateValues, target: formatDowntimeBudget(estimate.targetSec) })
      : k('syncIntervalEstimate', estimateValues)
  }
  const toggle = (id: string) => setSelected(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  const send = async (syncIntervalSec: number | null) => {
    setBusy(true)
    setError(null)
    setSkipped([])
    try {
      const res = batchId
        ? await fetch(`/api/v1/migrations/batches/${encodeURIComponent(batchId)}/sync-interval`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ syncIntervalSec, jobIds: shown.map(j => j.jobId) }),
        })
        : await fetch(`/api/v1/migrations/${encodeURIComponent(jobId || '')}/sync-interval`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ syncIntervalSec }),
        })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) { setError(d?.error || `HTTP ${res.status}`); return }
      onDone()
      const left: SkippedJob[] = Array.isArray(d?.data?.skipped) ? d.data.skipped : []
      if (left.length > 0) { setSkipped(left); return }
      onClose()
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{k('syncIntervalDialogTitle')}</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 1.5 }}>{k('syncIntervalDialogBody')}</DialogContentText>
        {batchId && (
          <>
            <FormControlLabel
              sx={{ ml: 0 }}
              control={<Checkbox size="small" checked={all} indeterminate={shown.length > 0 && !all} onChange={() => setSelected(all ? new Set() : new Set(jobs.map(j => j.jobId)))} data-testid="sync-interval-all" />}
              label={<Typography variant="body2" fontWeight={600}>{t('common.all')}</Typography>}
            />
            <Box sx={{ maxHeight: 260, overflowY: 'auto', mb: 1.5 }}>
              <PagedRows items={jobs} testId="sync-interval-pager">
                {job => (
                  <Box key={job.jobId} sx={{ display: 'flex', alignItems: 'center', gap: 1 }} data-testid={`sync-interval-row-${job.jobId}`}>
                    <Checkbox size="small" checked={selected.has(job.jobId)} onChange={() => toggle(job.jobId)} slotProps={{ input: { 'aria-label': job.name } }} />
                    <i className="ri-computer-line" style={{ fontSize: 14, opacity: 0.7 }} />
                    <Typography variant="body2" noWrap sx={{ flex: 1, minWidth: 0 }}>{job.name}</Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ flexShrink: 0 }}>
                      {job.suggestedSyncIntervalSec != null && job.suggestedSyncIntervalSec !== (job.syncIntervalSec ?? SYNC_INTERVAL_DEFAULT_SEC)
                        ? k('syncIntervalRowSuggested', { current: formatSyncInterval(job.syncIntervalSec ?? SYNC_INTERVAL_DEFAULT_SEC), suggested: formatSyncInterval(job.suggestedSyncIntervalSec) })
                        : formatSyncInterval(job.syncIntervalSec ?? SYNC_INTERVAL_DEFAULT_SEC)}
                    </Typography>
                  </Box>
                )}
              </PagedRows>
            </Box>
          </>
        )}
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.5 }}>
          <Typography variant="body2">{k('syncInterval')}</Typography>
          <Typography variant="body2" fontWeight={700} sx={{ ml: 'auto' }} data-testid="sync-interval-value">{formatSyncInterval(valueSec)}</Typography>
        </Box>
        <SyncIntervalSlider valueSec={valueSec} onChange={setValueSec} label={k('syncInterval')} disabled={busy} />
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 1, minHeight: 30 }} data-testid="sync-interval-suggestion">
          <i className="ri-lightbulb-line" style={{ fontSize: 16, opacity: 0.7 }} />
          <Typography variant="body2" color="text.secondary" sx={{ flex: 1, minWidth: 0 }}>
            {suggestion != null ? k('syncIntervalSuggested', { interval: formatSyncInterval(suggestion) }) : k('syncIntervalNoSuggestion')}
          </Typography>
          <Tooltip title={k('syncIntervalSuggestedTooltip')} arrow placement="top">
            <i className="ri-question-line" style={{ fontSize: 14, opacity: 0.6 }} />
          </Tooltip>
          {suggestion != null && (
            <Button size="small" variant="text" disabled={busy || suggestion === valueSec} onClick={() => setValueSec(suggestion)} sx={{ textTransform: 'none', minWidth: 0 }} data-testid="sync-interval-use-suggestion">
              {k('syncIntervalUseSuggestion')}
            </Button>
          )}
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minHeight: 30 }} data-testid="sync-interval-estimate">
          {estimate?.over
            ? <i className="ri-alert-line" style={{ fontSize: 16, color: 'var(--mui-palette-warning-main)' }} data-testid="sync-interval-estimate-over" />
            : <i className="ri-time-line" style={{ fontSize: 16, opacity: 0.7 }} />}
          <Typography variant="body2" color={estimate?.over ? 'warning.main' : 'text.secondary'} sx={{ flex: 1, minWidth: 0 }}>
            {estimateText}
          </Typography>
          <Tooltip title={k('syncIntervalEstimateTooltip')} arrow placement="top">
            <i className="ri-question-line" style={{ fontSize: 14, opacity: 0.6 }} />
          </Tooltip>
        </Box>
        {error && <Alert severity="error" sx={{ mt: 1, py: 0 }} data-testid="sync-interval-error">{error}</Alert>}
        {skipped.length > 0 && (
          <Alert severity="warning" sx={{ mt: 1, py: 0 }} data-testid="sync-interval-skipped">
            {k('syncIntervalSkipped', { names: skipped.map(s => s.sourceVmName || s.jobId).join(', ') })}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={() => send(null)} disabled={busy || shown.length === 0} sx={{ mr: 'auto', textTransform: 'none', whiteSpace: 'nowrap' }} data-testid="sync-interval-default">
          {defaultSyncIntervalSec != null ? k('syncIntervalUseDefaultValue', { interval: formatSyncInterval(defaultSyncIntervalSec) }) : k('syncIntervalUseDefault')}
        </Button>
        <Button onClick={onClose} disabled={busy}>{t(skipped.length > 0 ? 'common.close' : 'common.back')}</Button>
        <Button variant="contained" disabled={busy || shown.length === 0} onClick={() => send(valueSec)} sx={{ whiteSpace: 'nowrap' }} data-testid="sync-interval-confirm">
          {batchId ? k('syncIntervalApplyCount', { count: shown.length }) : k('syncIntervalApply')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
