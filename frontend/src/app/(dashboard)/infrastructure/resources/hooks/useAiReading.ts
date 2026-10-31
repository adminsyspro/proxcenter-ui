'use client'

import { useCallback, useMemo, useState } from 'react'

import { useLocale } from 'next-intl'

import { fetcher, useSWRFetch } from '@/hooks/useSWRFetch'

/**
 * An AI reading of the page (forecast reading, optimisation plan). The server
 * keeps one per scope and language for 15 minutes, so opening the tab again costs
 * no model call; `regenerate` asks for a new one.
 */
export function useAiReading<T>(path: string, connectionId: string | undefined, enabled: boolean) {
  const locale = useLocale()
  const [regenerating, setRegenerating] = useState(false)
  const [regenerateFailed, setRegenerateFailed] = useState(false)

  const url = useMemo(() => {
    const params = new URLSearchParams()
    if (connectionId) params.set('connectionId', connectionId)
    const qs = params.toString()

    return `${path}${qs ? `?${qs}` : ''}`
  }, [path, connectionId])

  // The locale is part of the key only: the server reads it from the cookie.
  const { data, error, isLoading, mutate } = useSWRFetch<{ data: T }>(enabled ? `${url}#${locale}` : null, {
    revalidateOnFocus: false,
    revalidateIfStale: false,
    shouldRetryOnError: false,
  })

  const regenerate = useCallback(async () => {
    setRegenerating(true)
    setRegenerateFailed(false)

    try {
      // The shared fetcher: no browser cache, and a dead session goes to the login page.
      await mutate(await fetcher(`${url}${url.includes('?') ? '&' : '?'}refresh=1`), { revalidate: false })
    } catch {
      setRegenerateFailed(true)
    } finally {
      setRegenerating(false)
    }
  }, [url, mutate])

  return {
    reading: data?.data ?? null,
    loading: isLoading || regenerating,
    failed: Boolean(error) || regenerateFailed,
    regenerate,
  }
}
