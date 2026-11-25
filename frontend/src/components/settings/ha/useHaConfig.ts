import { useSWRFetch } from '@/hooks/useSWRFetch'

export interface HaConfig {
  enabled: boolean
  vip: string
  vipInterface: string
  externalUrl?: string
  imageSource?: HaImageSource
  deploymentState: 'idle' | 'deploying' | 'deployed' | 'failed'
  deploymentStep: number
  deployedAt: string | null
  nodes: HaNodeConfig[]
  securityLevel?: number
  securityUpgrade?: HaSecurityUpgrade | null
  /** State of the etcd and HAProxy image update (same record shape). */
  imageUpdate?: HaSecurityUpgrade | null
}

export interface HaSecurityUpgrade {
  v: number
  phase: number
  nodeIndex: number
  status: 'running' | 'failed' | 'done'
  error?: string
  startedAt: string
  updatedAt: string
  awaitingSelfRestart?: boolean
}

/**
 * A running HA cluster: deployed, or converted once (deployedAt) with its
 * last deploy failed. The security upgrade accepts both.
 */
export function isConvertedCluster(config: Pick<HaConfig, 'deploymentState' | 'deployedAt'> | undefined): boolean {
  if (!config) return false

  return config.deploymentState === 'deployed' || (config.deploymentState === 'failed' && !!config.deployedAt)
}

export type HaImageSourceMode = '' | 'online' | 'registry' | 'local'

export interface HaImageSource {
  mode: HaImageSourceMode
  registry?: string
  caCert?: string
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

export interface HaNodeImages {
  node: string
  etcd?: string
  haproxy?: string
  outdated: boolean
  error?: string
}

/** Tags of the etcd and HAProxy images this version deploys, and the ones each node still names. */
export interface HaImageStatus {
  etcd: string
  haproxy: string
  nodes: HaNodeImages[]
  outdated: boolean
  checkedAt: string
}

export function useHaImages(enabled = true) {
  return useSWRFetch<HaImageStatus>(enabled ? '/api/v1/ha/images' : null, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    shouldRetryOnError: false,
  })
}
