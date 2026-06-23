import useSWR from 'swr'

import type { FrameworkAssessment } from '@/lib/compliance/frameworkAssessment'

const fetcher = async (url: string): Promise<FrameworkAssessment[]> => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return (await res.json()).data
}

/**
 * Fetches framework assessments (NIST 800-53, NIST 800-171, CMMC L2) for a
 * given connection. Returns null assessments while loading or when
 * connectionId is not yet available.
 */
export function useFrameworkAssessments(connectionId: string | null) {
  const { data, error, isLoading } = useSWR(
    connectionId
      ? `/api/v1/compliance/frameworks?connectionId=${encodeURIComponent(connectionId)}`
      : null,
    fetcher,
  )
  return { assessments: data ?? [], isLoading, error }
}
