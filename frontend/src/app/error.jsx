'use client'

import { useEffect } from 'react'

import ErrorPage from '@components/ErrorPage'

export default function Error({ error, reset }) {
  useEffect(() => {
    // Log l'erreur pour le debugging
    console.error('Application error:', error)
  }, [error])

  return (
    <ErrorPage
      code={500}
      title="Une erreur s'est produite"
      description={
        process.env.NODE_ENV === 'development'
          ? error?.message || "Une erreur inattendue s'est produite."
          : "Une erreur inattendue s'est produite. Veuillez réessayer."
      }
      showRetryButton
      onRetry={reset}
    />
  )
}
