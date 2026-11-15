'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'

import { Button } from '@mui/material'

import { canStartMigrationTest } from '@/lib/migration/warm/migration-test-state'

import MigrationTestDialog from './MigrationTestDialog'

type TestJob = {
  id: string
  status: string
  sourceVmName?: string | null
  targetNode?: string | null
  cutoverRequestedAt?: string | Date | null
  config?: { cutoverMode?: string | null; migrationType?: string | null } | null
  testRequest?: unknown
  testState?: unknown
} | null | undefined

/**
 * Opens the settings of a test of a waiting warm migration: a throwaway VM
 * booted on the replicated copy while the migration waits for its manual
 * cutover (lib/migration/warm/migration-test.ts).
 */
export default function MigrationTestButton({ job, size = 'small', onChanged }: {
  job: TestJob
  size?: 'small' | 'medium'
  onChanged?: () => void
}) {
  const t = useTranslations()
  const [open, setOpen] = useState(false)

  if (!job || !canStartMigrationTest(job)) return null

  return (
    <>
      <Button size={size} variant="outlined" startIcon={<i className="ri-flask-line" />} onClick={() => setOpen(true)} sx={{ textTransform: 'none' }} data-testid="migration-test-button">
        {t('inventoryPage.esxiMigration.testStart')}
      </Button>
      {open && (
        <MigrationTestDialog
          open
          jobId={job.id}
          name={job.sourceVmName || job.id}
          node={job.targetNode || ''}
          onClose={() => setOpen(false)}
          onStarted={onChanged}
        />
      )}
    </>
  )
}
