'use client'

import { useEffect } from 'react'
import useSWR from 'swr'

import type { ReplicationStorages } from '@/lib/orchestrator/site-recovery.types'

export interface StorageDiscoveryState {
  data?: ReplicationStorages
  error: boolean
  loading: boolean
}

const fetcher = async (url: string): Promise<ReplicationStorages> => {
  const response = await fetch(url)

  if (!response.ok) throw new Error('Storage discovery failed')
  return response.json()
}

// A child per connection keeps hook order stable as the connection list changes.
export default function ReplicationStorageDiscovery({ connectionId, onChange }: {
  connectionId: string
  onChange: (id: string, state: StorageDiscoveryState) => void
}) {
  const { data, error, isLoading } = useSWR<ReplicationStorages>(
    `/api/v1/connections/${connectionId}/replication-storages`, fetcher, { dedupingInterval: 300_000 },
  )

  useEffect(() => {
    onChange(connectionId, { data, error: !!error, loading: isLoading })
  }, [connectionId, data, error, isLoading, onChange])

  return null
}
