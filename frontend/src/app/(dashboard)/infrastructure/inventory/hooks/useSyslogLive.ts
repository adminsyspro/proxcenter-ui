'use client'

import { useEffect } from 'react'
import { parseNodeId } from '../helpers'

/**
 * Generic hook that polls a node API endpoint every 2s while active,
 * pausing when the tab is hidden and resuming on visibility change.
 */
function useLivePolling(
  active: boolean,
  selectionId: string | undefined,
  buildUrl: (connId: string, nodeName: string) => string,
  onData: (json: any) => void,
  deps: any[],
) {
  useEffect(() => {
    if (!active) return

    const { connId, node: nodeName } = parseNodeId(selectionId || '')

    // Owned by this effect run: the cleanup (node switch, tab change, live
    // mode off) aborts the request in flight, so a late answer for the
    // previous node can never be written into the current node's panel.
    const controller = new AbortController()
    const { signal } = controller

    const fetchLogs = async () => {
      if (signal.aborted) return
      try {
        const res = await fetch(buildUrl(connId, nodeName), {
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache' },
          signal,
        })
        if (res.ok) {
          const json = await res.json()
          if (!signal.aborted) onData(json)
        }
      } catch (e) {
        if (!signal.aborted) console.error('Live polling error:', e)
      }
    }

    void fetchLogs()

    let interval: ReturnType<typeof setInterval> | null = null

    function start() { if (interval !== null) return; interval = setInterval(fetchLogs, 2000) }
    function stop() { if (interval !== null) { clearInterval(interval); interval = null } }
    function onVis() { if (document.visibilityState === 'visible') { void fetchLogs(); start() } else { stop() } }

    document.addEventListener('visibilitychange', onVis)
    if (document.visibilityState === 'visible') start()

    return () => { controller.abort(); stop(); document.removeEventListener('visibilitychange', onVis) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}

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
  useLivePolling(
    nodeSyslogLive && selectionType === 'node' && nodeTab === 6 && nodeSystemSubTab === 6,
    selectionId,
    (connId, nodeName) =>
      `/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(nodeName)}/syslog?limit=200&_t=${Date.now()}`,
    (json) => setNodeSyslogData(json.data || []),
    [nodeSyslogLive, selectionType, selectionId, nodeTab, nodeSystemSubTab, setNodeSyslogData],
  )
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
  useLivePolling(
    nodeCephLogLive && selectionType === 'node' && !!clusterName,
    selectionId,
    (connId, nodeName) =>
      `/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(nodeName)}/ceph?section=log&logLines=100&_t=${Date.now()}`,
    (json) => {
      if (json.data?.log) {
        setNodeCephData((prev: any) => ({ ...prev, log: json.data.log }))
      }
    },
    [nodeCephLogLive, selectionType, selectionId, clusterName, setNodeCephData],
  )
}
