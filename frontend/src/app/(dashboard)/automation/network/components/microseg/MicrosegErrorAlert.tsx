'use client'

import { Alert, Button, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import { MicrosegApiError, microsegErrorKeyOf } from '@/lib/microseg/api'
import { FATAL_CODES } from '@/lib/microseg/useMicroseg'

type Props = {
  error: unknown
  /** Shown as a Retry button when given, unless trying again cannot cure the error (no licence, no right...). */
  onRetry?: () => void
  onClose?: () => void
}

/**
 * One translated message for any error of the micro-segmentation client (UA3).
 * The server's own wording is only added for INVALID, where it says what is wrong.
 */
export default function MicrosegErrorAlert({ error, onRetry, onClose }: Props) {
  const t = useTranslations()
  const fatal = error instanceof MicrosegApiError && FATAL_CODES.has(error.code)
  const detail = error instanceof MicrosegApiError && error.code === 'INVALID' ? error.serverMessage : undefined

  return (
    <Alert
      severity='error'
      onClose={onClose}
      action={onRetry && !fatal ? <Button color='inherit' size='small' onClick={onRetry}>{t('common.retry')}</Button> : undefined}
      sx={{ mb: 2 }}
    >
      {t(microsegErrorKeyOf(error))}
      {detail && <Typography variant='body2' component='div'>{detail}</Typography>}
    </Alert>
  )
}
