'use client'

import { Chip } from '@mui/material'

import { JOB_TYPE_FALLBACK_LABELS, JOB_TYPE_LABEL_KEYS, jobTypeIcon } from '@/lib/tasks/jobTypes'

/*
   Status and type pastilles of a Task Center job. Shared by the Task Center
   table and the job detail dialog so a job is labelled identically wherever it
   shows up (#767).
*/

export function StatusChip({ status, t }) {
  const config = {
    running: { label: t('jobsPage.statusRunning'), color: 'info' },
    success: { label: t('jobsPage.statusSuccess'), color: 'success' },
    completed: { label: t('jobsPage.statusSuccess'), color: 'success' },
    failed: { label: t('jobsPage.statusFailed'), color: 'error' },
    cancelled: { label: t('jobsPage.statusCancelled'), color: 'error' },
    queued: { label: t('jobsPage.statusQueued'), color: 'default' },
    pending: { label: t('jobsPage.statusQueued'), color: 'default' },
    paused: { label: t('jobsPage.statusPaused'), color: 'warning' }
  }

  const cfg = config[status] || { label: status, color: 'default' }

  return <Chip size='small' label={cfg.label} color={cfg.color} sx={{ minWidth: 80 }} />
}

export function TypeChip({ type, t }) {
  const label = t && JOB_TYPE_LABEL_KEYS[type] ? t(JOB_TYPE_LABEL_KEYS[type]) : (JOB_TYPE_FALLBACK_LABELS[type] || type)
  const icon = jobTypeIcon(type)

  return (
    <Chip
      size='small'
      label={label}
      variant='outlined'
      icon={<i className={icon} style={{ fontSize: 14 }} />}
    />
  )
}
