'use client'

import Link from 'next/link'
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

export type SshVerdict = 'ok' | 'missing-rule' | 'ssh-disabled' | 'unreachable'

/** Why ProxCenter cannot run pveceph on a node, and where to fix it. Nothing for 'ok'. */
export function SshVerdictAlert({ verdict }: Readonly<{ verdict: SshVerdict | string | null | undefined }>) {
  const t = useTranslations('cephCockpit.provision.ssh')
  if (!verdict || verdict === 'ok') return null
  if (verdict === 'missing-rule' || verdict === 'SUDO_RULE_MISSING') {
    return (
      <Alert severity='warning' data-testid='ssh-verdict'>
        {t('missingRule')} <Link href='/settings?tab=ssh-commands'>{t('missingRuleLink')}</Link>
      </Alert>
    )
  }
  if (verdict === 'ssh-disabled' || verdict === 'SSH_DISABLED') {
    return (
      <Alert severity='warning' data-testid='ssh-verdict'>
        {t('disabled')} <Link href='/settings?tab=connections'>{t('disabledLink')}</Link>
      </Alert>
    )
  }
  return <Alert severity='error' data-testid='ssh-verdict'>{t('unreachable')}</Alert>
}

/** A refusal of a pveceph route: the SSH ones point to their settings, a pveceph failure shows what it printed. */
export function ProvisionFailureAlert({ failure }: Readonly<{ failure: CephTaskFailure }>) {
  const t = useTranslations('cephCockpit.provision.ssh')
  const code = failure.result?.code
  if (code === 'SUDO_RULE_MISSING' || code === 'SSH_DISABLED') return <SshVerdictAlert verdict={code} />
  if (code === 'PVECEPH_FAILED') {
    return (
      <Alert severity='error' data-testid='pveceph-failed'>
        {t('pvecephFailed')}
        <Box component='pre' sx={{ m: 0, mt: 0.75, fontFamily: 'monospace', fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {failure.result?.output}
        </Box>
      </Alert>
    )
  }
  return <TaskFailureAlert failure={failure} />
}
