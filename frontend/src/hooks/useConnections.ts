import { useState, useEffect } from 'react'
import { useSWRFetch } from './useSWRFetch'

export function useConnections(type?: 'pve' | 'pbs') {
  const url = type ? `/api/v1/connections?type=${type}` : '/api/v1/connections'
  return useSWRFetch(url, { revalidateOnFocus: true })
}

export function usePVEConnections() {
  return useConnections('pve')
}

export function usePBSConnections() {
  return useConnections('pbs')
}

/**
 * Returns only PVE connections that are clusters (2+ nodes).
 * Standalone single-node hosts are filtered out.
 */
export function useClusterConnections() {
  const { data: connectionsData, ...rest } = usePVEConnections()
  const [filteredData, setFilteredData] = useState<typeof connectionsData>(undefined)

  useEffect(() => {
    if (!connectionsData?.data) {
      setFilteredData(undefined)
      return
    }

    const connections = connectionsData.data
    if (connections.length === 0) {
      setFilteredData({ data: [] })
      return
    }

    let cancelled = false
    setFilteredData(undefined)

    Promise.all(
      connections.map(async (conn: any) => {
        try {
          const res = await fetch(`/api/v1/connections/${conn.id}/nodes`)
          if (!res.ok) return null
          const json = await res.json()
          return (json?.data?.length ?? 0) >= 2 ? conn : null
        } catch {
          return null
        }
      })
    ).then((results) => {
      if (!cancelled) {
        setFilteredData({ data: results.filter(Boolean) })
      }
    })

    return () => { cancelled = true }
  }, [connectionsData])

  return { ...rest, data: filteredData }
}
