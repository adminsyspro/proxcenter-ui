import { useSWRFetch } from '@/hooks/useSWRFetch'

export interface HaConfig {
  enabled: boolean
  vip: string
  vipInterface: string
  deploymentState: 'idle' | 'deploying' | 'deployed' | 'failed'
  deploymentStep: number
  deployedAt: string | null
  nodes: HaNodeConfig[]
}

export interface HaNodeConfig {
  name: string
  ip: string
  vrrpPriority: number
  isCurrentNode: boolean
  maintenance: boolean
}

export function useHaConfig(enabled = true) {
  return useSWRFetch<HaConfig>(enabled ? '/api/v1/ha/config' : null, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    shouldRetryOnError: false,
  })
}
