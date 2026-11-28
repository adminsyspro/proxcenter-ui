'use client'

import { Alert, Box, CircularProgress, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import type { CephTaskFailure } from './hooks/useCephTask'

/*
   The state of a provisioning task inside its dialog (ui#1450): waiting for
   the PVE task, or why it did not go through.
*/

export function TaskFollowing() {
  const t = useTranslations('cephCockpit.provision.task')
  return (
    <Box data-testid='task-following' sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'text.secondary' }}>
      <CircularProgress size={14} />
      <Typography variant='body2'>{t('following')}</Typography>
    </Box>
  )
}

export function TaskFailureAlert({ failure }: Readonly<{ failure: CephTaskFailure }>) {
  const t = useTranslations('cephCockpit.provision.task')
  let text: string
  if (failure.timeout) text = t('timeout')
  else if (failure.task) text = failure.message ? t('failed', { reason: failure.message }) : t('failedBare')
  else text = failure.message
  return (
    <Alert severity={failure.timeout ? 'warning' : 'error'} data-testid='task-failure' sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
      {text}
    </Alert>
  )
}
