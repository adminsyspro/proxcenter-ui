'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'

import { Button } from '@mui/material'

import { isTerminalJobStatus } from '../bulkJobList'

import SyncIntervalDialog, { type SyncIntervalJob } from './SyncIntervalDialog'

type HoldJob = {
  id: string
  status: string
  sourceVmName?: string | null
  cutoverRequestedAt?: string | Date | null
  config?: { cutoverMode?: string | null; migrationType?: string | null } | null
} | null | undefined

/** A warm migration launched with a manual cutover, not over, whose cutover was not asked yet. */
export function canChangeSyncInterval(job: HoldJob): boolean {
  return !!job && job.config?.cutoverMode === 'manual' && job.config?.migrationType !== 'cold'
    && !isTerminalJobStatus(job.status) && !job.cutoverRequestedAt
}

/**
 * Opens the interval dialog of one waiting migration. The interval in force
 * and the engine's suggestion are read when the button is clicked, with the
 * right to migrate: the operator may not be allowed to open the source
 * connection in Settings.
 */
export default function SyncIntervalButton({ job, size = 'small', onChanged }: {
  job: HoldJob
  size?: 'small' | 'medium'
  onChanged?: () => void
}) {
  const t = useTranslations()
  const [state, setState] = useState<{ row: SyncIntervalJob; defaultSec: number | null } | null>(null)
  const [busy, setBusy] = useState(false)

  if (!canChangeSyncInterval(job)) return null

  const open = async () => {
    setBusy(true)
    const row: SyncIntervalJob = { jobId: job!.id, name: job!.sourceVmName || job!.id }
    try {
      const res = await fetch(`/api/v1/migrations/${encodeURIComponent(job!.id)}/sync-interval`)
      const d = res.ok ? (await res.json().catch(() => null))?.data : null
      setState({
        row: { ...row, syncIntervalSec: d?.syncIntervalSec ?? null, suggestedSyncIntervalSec: d?.suggestedSyncIntervalSec ?? null, measure: d?.measure ?? null },
        defaultSec: d?.defaultSyncIntervalSec ?? null,
      })
    } catch {
      // The dialog still opens on the default: the change itself reports any refusal.
      setState({ row, defaultSec: null })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button size={size} variant="outlined" disabled={busy} startIcon={<i className="ri-timer-line" />} onClick={open} sx={{ textTransform: 'none' }} data-testid="sync-interval-button">
        {t('inventoryPage.esxiMigration.syncIntervalChange')}
      </Button>
      {state && (
        <SyncIntervalDialog
          open
          jobId={job!.id}
          jobs={[state.row]}
          defaultSyncIntervalSec={state.defaultSec}
          onClose={() => setState(null)}
          onDone={() => onChanged?.()}
        />
      )}
    </>
  )
}
