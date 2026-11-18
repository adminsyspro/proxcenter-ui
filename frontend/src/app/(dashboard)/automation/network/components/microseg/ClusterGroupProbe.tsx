'use client'

import { useEffect } from 'react'

import { useMicrosegGroup, type GroupReadOptions } from '@/lib/microseg/useMicrosegGroup'

/** Read once: an association or a dissociation revalidates every clusters key explicitly (SettingsDialog). */
const PROBE_READ: GroupReadOptions = { revalidateIfStale: false, revalidateOnReconnect: false }

type Props = {
  connectionId: string
  /** Called with the cluster IDs of the connection's group once the backend answered (the connection alone on a failure). */
  onGroup: (connectionId: string, ids: string[]) => void
}

/**
 * Reads the group of one connection for the page's connection selector and renders nothing. One component per
 * connection, since a hook cannot be called in a loop: each read shares its SWR key with `useMicrosegGroup` in the
 * tab, so the selected connection is read once for both.
 */
export default function ClusterGroupProbe({ connectionId, onGroup }: Readonly<Props>) {
  const { ids, loading } = useMicrosegGroup(connectionId, PROBE_READ)
  useEffect(() => {
    if (!loading) onGroup(connectionId, ids)
  }, [connectionId, ids, loading, onGroup])
  return null
}
