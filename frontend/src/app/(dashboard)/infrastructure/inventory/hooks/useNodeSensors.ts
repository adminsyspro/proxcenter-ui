'use client'

import { useEffect, useState } from 'react'

import type { NodeSensors } from '@/lib/sensors/hwmon'

export type NodeSensorsState = {
  sensors: NodeSensors | null
  loading: boolean
}

/**
 * Node temperatures for the inventory header.
 *
 * Deliberately outside the node detail payload: reading them costs an SSH
 * round trip, and the header must render immediately whether or not the host
 * has sensors or the connection has SSH. A node with nothing to report simply
 * leaves `sensors` null and the caller renders no row.
 */
export function useNodeSensors(connId?: string, nodeName?: string): NodeSensorsState {
  const [sensors, setSensors] = useState<NodeSensors | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!connId || !nodeName) {
      setSensors(null)
      setLoading(false)

      return
    }

    // Clear straight away: keeping the previous node's readings on screen
    // while the next node's request is in flight attributes one host's
    // temperature to another.
    setSensors(null)
    setLoading(true)

    const controller = new AbortController()

    const url = `/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(nodeName)}/sensors`

    fetch(url, { signal: controller.signal })
      .then(res => (res.ok ? res.json() : null))
      .then(json => {
        if (controller.signal.aborted) return

        const data = json?.data

        setSensors(data?.available ? { readings: data.readings, byRole: data.byRole, hottest: data.hottest } : null)
        setLoading(false)
      })
      .catch(() => {
        if (controller.signal.aborted) return

        setSensors(null)
        setLoading(false)
      })

    return () => controller.abort()
  }, [connId, nodeName])

  return { sensors, loading }
}
