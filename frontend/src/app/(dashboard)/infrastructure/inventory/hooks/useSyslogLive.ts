'use client'

import { useEffect } from 'react'
import { parseNodeId } from '../helpers'

/**
 * Polls syslog data every 2s when nodeSyslogLive is true and the correct tab is active.
 */
export function useSyslogLive(
  nodeSyslogLive: boolean,
  selectionType: string | undefined,
  selectionId: string | undefined,
  nodeTab: number,
  nodeSystemSubTab: number,
  setNodeSyslogData: (data: string[]) => void,
) {
  useEffect(() => {
    if (!nodeSyslogLive || selectionType !== 'node' || nodeTab !== 5 || nodeSystemSubTab !== 6) return

    const { connId, node: nodeName } = parseNodeId(selectionId || '')

    const fetchLogs = async () => {
      try {
        const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(nodeName)}/syslog?limit=200&_t=${Date.now()}`, {
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache' }
        })
        if (res.ok) {
          const json = await res.json()
          setNodeSyslogData(json.data || [])
        }
      } catch (e) {
        console.error('Failed to refresh syslog:', e)
      }
    }

    fetchLogs()
    const interval = setInterval(fetchLogs, 2000)
    return () => clearInterval(interval)
  }, [nodeSyslogLive, selectionType, selectionId, nodeTab, nodeSystemSubTab, setNodeSyslogData])
}

/**
 * Polls ceph log data every 2s when nodeCephLogLive is true and a cluster node is selected.
 */
export function useCephLogLive(
  nodeCephLogLive: boolean,
  selectionType: string | undefined,
  selectionId: string | undefined,
  clusterName: string | undefined,
  setNodeCephData: (updater: (prev: any) => any) => void,
) {
  useEffect(() => {
    if (!nodeCephLogLive || selectionType !== 'node' || !clusterName) return

    const { connId, node: nodeName } = parseNodeId(selectionId || '')

    const fetchLogs = async () => {
      try {
        const timestamp = Date.now()
        const res = await fetch(
          `/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(nodeName)}/ceph?section=log&logLines=100&_t=${timestamp}`,
          {
            cache: 'no-store',
            headers: {
              'Cache-Control': 'no-cache, no-store, must-revalidate',
              'Pragma': 'no-cache'
            }
          }
        )
        if (res.ok) {
          const json = await res.json()
          if (json.data?.log) {
            setNodeCephData((prev: any) => ({ ...prev, log: json.data.log }))
          }
        }
      } catch (e) {
        console.error('Failed to fetch live logs:', e)
      }
    }

    fetchLogs()
    const interval = setInterval(fetchLogs, 2000)
    return () => clearInterval(interval)
  }, [nodeCephLogLive, selectionType, selectionId, clusterName, setNodeCephData])
}
