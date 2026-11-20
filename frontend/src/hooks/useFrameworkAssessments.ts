import useSWR from 'swr'

import type { FrameworkAssessment } from '@/lib/compliance/frameworkAssessment'
import type { NodeBreakdown } from '@/lib/compliance/nodeBreakdown'

import { COMPLIANCE_SWR_OPTIONS } from './useHardeningChecks'

interface FrameworksResponse {
  assessments: FrameworkAssessment[]
  nodes: NodeBreakdown[]
}

const fetcher = async (url: string): Promise<FrameworksResponse> => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  const json = await res.json()
  return { assessments: json.data ?? [], nodes: json.nodes ?? [] }
}

/**
 * Fetches framework assessments (one per registered framework) and per-node
 * check breakdowns for a given connection. Returns empty arrays while loading
 * or when connectionId is not yet available.
 */
export function useFrameworkAssessments(connectionId: string | null) {
  const { data, error, isLoading } = useSWR(
    connectionId
      ? `/api/v1/compliance/frameworks?connectionId=${encodeURIComponent(connectionId)}`
      : null,
    fetcher,
    COMPLIANCE_SWR_OPTIONS,
  )
  return { assessments: data?.assessments ?? [], nodes: data?.nodes ?? [], isLoading, error }
}
