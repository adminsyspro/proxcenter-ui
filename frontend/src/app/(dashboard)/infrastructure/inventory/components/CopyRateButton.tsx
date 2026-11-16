'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'

import { Button, IconButton, Tooltip } from '@mui/material'

import { isTerminalJobStatus } from '../bulkJobList'

import CopyRateDialog, { type CopyRateTarget } from './CopyRateDialog'

type RateJob = {
  id: string
  status: string
  batchId?: string | null
  config?: { migrationType?: string | null } | null
} | null | undefined

/** A warm migration not over yet: its copy rate cap (or its batch's) can still change. */
export function canChangeCopyRate(job: RateJob): boolean {
  return !!job && job.config?.migrationType === 'warm' && !isTerminalJobStatus(job.status)
}

/**
 * Opens the copy rate cap dialog of one migration (its own cap, or its batch's
 * for a migration of a batch) or of a batch. The values in force are read when
 * the button is clicked, with the right to migrate.
 */
export default function CopyRateButton({ job, batchId, batchStatus, size = 'small', variant = 'outlined', onChanged }: {
  job?: RateJob
  batchId?: string
  batchStatus?: string
  size?: 'small' | 'medium'
  /** 'icon': a small icon with its name in the tooltip, next to the throughput it changes. */
  variant?: 'outlined' | 'text' | 'icon'
  onChanged?: () => void
}) {
  const t = useTranslations()
  const [target, setTarget] = useState<CopyRateTarget | null>(null)
  const [busy, setBusy] = useState(false)

  const forBatch = !!batchId
  if (forBatch ? batchStatus !== 'running' && batchStatus !== 'paused' : !canChangeCopyRate(job)) return null

  const open = async () => {
    setBusy(true)
    try {
      const url = forBatch
        ? `/api/v1/migrations/batches/${encodeURIComponent(batchId!)}/copy-rate`
        : `/api/v1/migrations/${encodeURIComponent(job!.id)}/copy-rate`
      const res = await fetch(url)
      const d = res.ok ? (await res.json().catch(() => null))?.data : null
      const scope = forBatch || d?.scope === 'batch' ? 'batch' : 'job'
      setTarget({
        scope,
        jobId: job?.id,
        batchId: forBatch ? batchId : (d?.batchId ?? job?.batchId ?? null),
        copyRateLimit: d?.copyRateLimit ?? null,
        perHostMbps: d?.perHostMbps ?? null,
        effectiveMbps: d?.effectiveMbps ?? null,
      })
    } catch {
      // The dialog still opens without a cap: the change itself reports any refusal.
      setTarget({ scope: forBatch ? 'batch' : 'job', jobId: job?.id, batchId: batchId ?? job?.batchId ?? null, copyRateLimit: null, perHostMbps: null, effectiveMbps: null })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {variant === 'icon' ? (
        <Tooltip title={t('copyRate.button')} arrow>
          <span>
            <IconButton size="small" color="primary" disabled={busy} onClick={open} aria-label={t('copyRate.button')} data-testid="copy-rate-button" sx={{ p: 0.25 }}>
              <i className="ri-speed-line" style={{ fontSize: 16 }} />
            </IconButton>
          </span>
        </Tooltip>
      ) : (
        <Button size={size} variant={variant} disabled={busy} startIcon={<i className="ri-speed-line" />} onClick={open} sx={{ textTransform: 'none' }} data-testid="copy-rate-button">
          {t('copyRate.button')}
        </Button>
      )}
      {target && <CopyRateDialog target={target} onClose={() => setTarget(null)} onDone={onChanged} />}
    </>
  )
}
