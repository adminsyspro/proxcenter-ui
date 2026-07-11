import { useSWRFetch } from '@/hooks/useSWRFetch'

export interface PatroniMember {
  name: string
  host: string
  role: 'leader' | 'sync_standby' | 'replica' | 'standby_leader'
  state: string
  timeline: number
  lagBytes: number
}

export interface EtcdMember {
  name: string
  healthy: boolean
}

export interface FailoverEvent {
  timeline: number
  lsn: string
  newLeader: string
  timestamp: string
  reason: string
}

export interface HaCluster {
  patroni: {
    scope: string
    members: PatroniMember[]
    syncMode: string
    paused: boolean
  }
  etcd: {
    healthy: boolean
    members: EtcdMember[]
  }
  vip: {
    address: string
    holder: string
  }
  services: Record<string, Record<string, string>>
  history: FailoverEvent[]
}

export function useHaCluster(enabled: boolean) {
  return useSWRFetch<HaCluster>(enabled ? '/api/v1/ha/cluster' : null, {
    refreshInterval: 10_000,
  })
}
