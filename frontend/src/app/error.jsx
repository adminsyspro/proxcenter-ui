'use client'

import { useEffect } from 'react'
import { useTranslations } from 'next-intl'

import ErrorPage from '@components/ErrorPage'

export default function Error({ error, reset }) {
  const t = useTranslations('errorPages')

  useEffect(() => {
    console.error('Application error:', error)
  }, [error])

  return (
    <ErrorPage
      code={500}
      title={t('errorOccurred')}
      description={
        process.env.NODE_ENV === 'development'
          ? error?.message || t('unexpectedError')
          : t('unexpectedErrorRetry')
      }
      showRetryButton
      onRetry={reset}
    />
  )
}
