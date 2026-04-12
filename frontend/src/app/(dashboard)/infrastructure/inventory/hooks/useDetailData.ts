import { useCallback, useEffect, useRef, useState } from 'react'

import type { InventorySelection, DetailsPayload } from '../types'
import { fetchDetails, parseVmId, parseNodeId, cpuPct, pct } from '../helpers'
import type { VmRow, TrendPoint } from '@/components/VmsTable'

/**
 * Custom hook that encapsulates the detail/data fetching logic
 * previously inlined in InventoryDetails.
 *
 * Manages: data, localTags, loading, error, refreshing states,
 * the main fetch-on-selection useEffect, the live-metrics polling
 * useEffect, refreshData callback, and loadVmTrendsBatch callback.
 */
export function useDetailData(selection: InventorySelection | null) {
  const [data, setData] = useState<DetailsPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [localTags, setLocalTags] = useState<string[]>([])
  const [refreshing, setRefreshing] = useState(false)

  // ---- Main fetch on selection change ----
  useEffect(() => {
    let alive = true

    async function run() {
      setError(null)
      setData(null)
      setLocalTags([])

      if (!selection) return

      setLoading(true)

      try {
        const payload = await fetchDetails(selection)

        if (!alive) return
        if (!payload) {
          // root selection — no details to display
          setLoading(false)
          return
        }
        setData(payload)
        setLocalTags(payload.tags || [])
      } catch (e: any) {
        if (!alive) return
        setError(e?.message || String(e))
      } finally {
        if (!alive) return
        setLoading(false)
      }
    }

    run()

    return () => {
      alive = false
    }
  }, [selection?.type, selection?.id])

  // ---- Live-metrics polling (CPU/RAM/Storage every 2s) ----
  // Uses targeted /status/current endpoint instead of /cluster/resources (all VMs).
  // Pauses when the browser tab is hidden (Page Visibility API).
  const pollAliveRef = useRef(true)

  useEffect(() => {
    if (!selection || !data) return
    const isVm = selection.type === 'vm'
    const isNode = selection.type === 'node'
    if (!isVm && !isNode) return

    // Only for running VMs or online nodes
    if (isVm && data.vmRealStatus !== 'running') return
    if (isNode && data.status !== 'ok') return

    pollAliveRef.current = true
    let intervalId: ReturnType<typeof setInterval> | null = null

    const poll = async () => {
      if (!pollAliveRef.current) return
      try {
        if (isVm) {
          const { connId, node, type, vmid } = parseVmId(selection.id)
          const res = await fetch(
            `/api/v1/connections/${encodeURIComponent(connId)}/guests/${encodeURIComponent(type)}/${encodeURIComponent(node)}/${encodeURIComponent(vmid)}/status`,
            { cache: 'no-store' }
          )
          const json = await res.json()
          const g = json?.data
          if (!g || !pollAliveRef.current) return
          setData(prev => prev ? {
            ...prev,
            metrics: {
              cpu: { label: 'CPU', pct: cpuPct(g.cpu) },
              ram: { label: 'RAM', pct: pct(Number(g.mem ?? 0), Number(g.maxmem ?? 0)), used: Number(g.mem ?? 0), max: Number(g.maxmem ?? 0) },
              storage: { label: 'Storage', pct: pct(Number(g.disk ?? 0), Number(g.maxdisk ?? 0)), used: Number(g.disk ?? 0), max: Number(g.maxdisk ?? 0) },
            },
          } : prev)
        } else {
          const { connId, node } = parseNodeId(selection.id)
          const res = await fetch(
            `/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/status`,
            { cache: 'no-store' }
          )
          const json = await res.json()
          const n = json?.data
          if (!n || !pollAliveRef.current) return
          const cpu = n.cpu
          const mem = n.memory?.used ?? n.mem
          const maxmem = n.memory?.total ?? n.maxmem
          const disk = n.rootfs?.used ?? n.disk
          const maxdisk = n.rootfs?.total ?? n.maxdisk
          setData(prev => prev ? {
            ...prev,
            metrics: {
              ...prev.metrics,
              cpu: { label: 'CPU', pct: cpuPct(cpu), used: cpuPct(cpu), max: 100 },
              ram: { label: 'RAM', pct: pct(Number(mem ?? 0), Number(maxmem ?? 0)), used: Number(mem ?? 0), max: Number(maxmem ?? 0) },
              storage: { label: 'Storage', pct: pct(Number(disk ?? 0), Number(maxdisk ?? 0)), used: Number(disk ?? 0), max: Number(maxdisk ?? 0) },
            },
          } : prev)
        }
      } catch {
        // Silently ignore polling errors
      }
    }

    function start() {
      if (intervalId !== null) return
      poll()
      intervalId = setInterval(poll, 5000)
    }

    function stop() {
      if (intervalId !== null) {
        clearInterval(intervalId)
        intervalId = null
      }
    }

    function onVisChange() {
      if (document.visibilityState === 'visible') start()
      else stop()
    }

    document.addEventListener('visibilitychange', onVisChange)
    if (document.visibilityState === 'visible') start()

    return () => {
      pollAliveRef.current = false
      stop()
      document.removeEventListener('visibilitychange', onVisChange)
    }
  }, [selection?.type, selection?.id, data?.vmRealStatus, data?.status])

  // ---- refreshData callback ----
  const refreshData = useCallback(async () => {
    if (!selection || refreshing) return
    setRefreshing(true)
    try {
      const payload = await fetchDetails(selection)
      if (payload) {
        setData(payload)
        setLocalTags(payload.tags || [])
      }
    } catch (e: any) {
      console.error('Refresh error:', e)
    } finally {
      setRefreshing(false)
    }
  }, [selection, refreshing])

  // ---- loadVmTrendsBatch callback ----
  const loadVmTrendsBatch = useCallback(async (vms: VmRow[]): Promise<Record<string, TrendPoint[]>> => {
    if (vms.length === 0) return {}

    // Grouper les VMs par connexion
    const byConnection: Record<string, VmRow[]> = {}

    vms.forEach(vm => {
      if (!byConnection[vm.connId]) {
        byConnection[vm.connId] = []
      }

      byConnection[vm.connId].push(vm)
    })

    // Faire un appel par connexion (en parallèle)
    const results: Record<string, TrendPoint[]> = {}

    await Promise.all(
      Object.entries(byConnection).map(async ([connId, connVms]) => {
        try {
          const res = await fetch(
            `/api/v1/connections/${encodeURIComponent(connId)}/guests/trends`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                items: connVms.map(vm => ({ type: vm.type, node: vm.node, vmid: vm.vmid })),
                timeframe: 'day'  // day donne ~24h de données, on prendra les 3 dernières heures
              }),
              cache: 'no-store'
            }
          )

          if (!res.ok) return

          const json = await res.json()
          const data = json?.data || {}

          // Mapper les résultats vers les IDs de VMs
          connVms.forEach(vm => {
            const key = `${vm.type}:${vm.node}:${vm.vmid}`
            const points = data[key] || []

            // Prendre les ~36 derniers points (~3h de données avec résolution 5min du timeframe day)
            results[vm.id] = points.slice(-36)
          })
        } catch (e) {
          console.error('Failed to batch load trends for connection', connId, e)
        }
      })
    )

    return results
  }, [])

  return {
    data,
    setData,
    loading,
    error,
    localTags,
    setLocalTags,
    refreshing,
    refreshData,
    loadVmTrendsBatch,
  }
}
