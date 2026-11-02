'use client'

import { Alert, Button } from '@mui/material'
import { useTranslations } from 'next-intl'

type Props = {
  /** What failed on the last load of the firewall data; nothing is shown without it. */
  error: string | null | undefined
  onRetry?: () => void
}

/**
 * Shown at the top of the tabs that list firewall data when a load failed (#1022): an empty list or a cluster
 * without options would otherwise read as "nothing configured".
 */
export default function FirewallLoadAlert({ error, onRetry }: Props) {
  const t = useTranslations()
  if (!error) return null

  return (
    <Alert
      severity='warning'
      sx={{ mb: 2, py: 0.25 }}
      action={onRetry ? <Button color='inherit' size='small' onClick={onRetry}>{t('common.retry')}</Button> : undefined}
    >
      {t('networkPage.loadError', { error })}
    </Alert>
  )
}
