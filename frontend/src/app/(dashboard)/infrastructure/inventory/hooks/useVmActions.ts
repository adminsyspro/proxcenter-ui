import { useCallback, useEffect, useRef, useState } from 'react'

import type { NodeRow, BulkAction } from '@/components/NodesTable'
import type { VmRow } from '@/components/VmsTable'
import type { CrossClusterMigrateParams } from '@/components/MigrateVmDialog'
import type { InventorySelection, DetailsPayload } from '../types'
import type { AllVmItem, HostItem } from '../InventoryTree'
import { parseVmId, fetchDetails } from '../helpers'

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

type Toast = {
  success: (msg: string) => void
  error: (msg: string) => void
  warning: (msg: string) => void
  info: (msg: string) => void
}

type TrackTaskFn = (opts: {
  upid: string
  connId: string
  node: string
  description: string
  onSuccess?: () => void
  onError?: () => void
  queryParams?: Record<string, string>
}) => void

export type TableMigrateVm = {
  connId: string
  node: string
  type: string
  vmid: string
  name: string
  status: string
  isCluster: boolean
} | null

export type TableCloneVm = {
  connId: string
  node: string
  type: string
  vmid: string
  name: string
} | null

export type BulkActionDialogState = {
  open: boolean
  action: BulkAction | null
  node: NodeRow | null
  targetNode: string
}

export type ConfirmActionState = {
  action: string
  title: string
  message: string
  vmName?: string
  onConfirm: () => Promise<void>
} | null

type CreationPending = { vmid: string; connId: string; node: string; type: 'qemu' | 'lxc' } | null

/* ------------------------------------------------------------------ */
/* Hook params                                                         */
/* ------------------------------------------------------------------ */

interface UseVmActionsParams {
  selection: InventorySelection | null
  onSelect?: (sel: InventorySelection) => void
  onRefresh?: () => Promise<void>
  toast: Toast
  t: (key: string) => string
  trackTask: TrackTaskFn
  data: DetailsPayload | null
  setData: (d: DetailsPayload | null) => void
  setLocalTags: (tags: string[]) => void
  allVms: AllVmItem[]
  onVmActionStart?: (connId: string, vmid: string) => void
  onVmActionEnd?: (connId: string, vmid: string) => void
  onOptimisticVmStatus?: (connId: string, vmid: string, status: string) => void
  setConfirmAction: (v: ConfirmActionState) => void
  setConfirmActionLoading: (v: boolean) => void
  setActionBusy: (v: boolean) => void
}

/* ------------------------------------------------------------------ */
/* Hook                                                                */
/* ------------------------------------------------------------------ */

export function useVmActions({
  selection,
  onSelect,
  onRefresh,
  toast,
  t,
  trackTask,
  data,
  setData,
  setLocalTags,
  allVms,
  onVmActionStart,
  onVmActionEnd,
  onOptimisticVmStatus,
  setConfirmAction,
  setConfirmActionLoading,
  setActionBusy,
}: UseVmActionsParams) {

  // Keep a ref to latest data/setData so closures always see current values
  const dataRef = useRef(data)
  const setDataRef = useRef(setData)
  useEffect(() => { dataRef.current = data }, [data])
  useEffect(() => { setDataRef.current = setData }, [setData])

  // ── Internal state ──────────────────────────────────────────────────

  const [tableMigrateVm, setTableMigrateVm] = useState<TableMigrateVm>(null)
  const [tableCloneVm, setTableCloneVm] = useState<TableCloneVm>(null)
  const [bulkActionDialog, setBulkActionDialog] = useState<BulkActionDialogState>({
    open: false, action: null, node: null, targetNode: '',
  })
  const [creationPending, setCreationPending] = useState<CreationPending>(null)
  const [highlightedVmId, setHighlightedVmId] = useState<string | null>(null)

  // Poll to detect when a newly created VM appears in the inventory
  useEffect(() => {
    if (!creationPending) return

    const { vmid, connId, node, type } = creationPending
    const fullId = `${connId}:${node}:${type}:${vmid}`

    const vmExists = allVms.some(vm =>
      vm.connId === connId &&
      String(vm.vmid) === vmid
    )

    if (vmExists) {
      setHighlightedVmId(fullId)
      setCreationPending(null)

      setTimeout(() => {
        setHighlightedVmId(null)
      }, 5000)
    }
  }, [allVms, creationPending])

  // ── Creation handlers ───────────────────────────────────────────────

  const handleGuestCreated = useCallback(async (vmid: string, connId: string, node: string, guestType: 'qemu' | 'lxc') => {
    setCreationPending({ vmid, connId, node, type: guestType })

    await new Promise(resolve => setTimeout(resolve, 2000))

    if (onRefresh) {
      await onRefresh()
    }

    let attempts = 0
    const maxAttempts = 10

    const pollInterval = setInterval(async () => {
      attempts++

      if (onRefresh) {
        await onRefresh()
      }

      if (attempts >= maxAttempts) {
        clearInterval(pollInterval)
        setCreationPending(null)
      }
    }, 3000)

    setTimeout(() => {
      clearInterval(pollInterval)
    }, 30000)
  }, [onRefresh])

  const handleVmCreated = useCallback(async (vmid: string, connId: string, node: string) => {
    return handleGuestCreated(vmid, connId, node, 'qemu')
  }, [handleGuestCreated])

  const handleLxcCreated = useCallback(async (ctid: string, connId: string, node: string) => {
    return handleGuestCreated(ctid, connId, node, 'lxc')
  }, [handleGuestCreated])

  // ── Migration handlers (selected VM panel) ──────────────────────────

  const handleMigrateVm = useCallback(async (targetNode: string, online: boolean, targetStorage?: string, withLocalDisks?: boolean) => {
    if (selection?.type !== 'vm') throw new Error('No VM selected')

    const { connId, node, type, vmid } = parseVmId(selection.id)

    const body: Record<string, any> = { target: targetNode, online }

    if (targetStorage) {
      body['targetstorage'] = targetStorage
    }

    if (withLocalDisks) {
      body['withLocalDisks'] = true
    }

    const res = await fetch(
      `/api/v1/connections/${encodeURIComponent(connId)}/guests/${type}/${encodeURIComponent(node)}/${encodeURIComponent(vmid)}/migrate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }
    )

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))

      throw new Error(err?.error || `HTTP ${res.status}`)
    }

    toast.success(t('vmActions.migrateSuccess'))

    if (onSelect) {
      onSelect({ type: 'cluster', id: connId })
    }

    await new Promise(resolve => setTimeout(resolve, 1500))

    if (onRefresh) {
      await onRefresh()
    }
  }, [selection, onRefresh, onSelect, toast, t])

  // ── Cross-cluster migration (selected VM panel) ─────────────────────

  const handleCrossClusterMigrate = useCallback(async (params: CrossClusterMigrateParams) => {
    if (selection?.type !== 'vm') throw new Error('No VM selected')

    const { connId, node, type, vmid } = parseVmId(selection.id)

    const res = await fetch(
      `/api/v1/connections/${encodeURIComponent(connId)}/guests/${type}/${encodeURIComponent(node)}/${encodeURIComponent(vmid)}/remote-migrate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetConnectionId: params.targetConnectionId,
          targetNode: params.targetNode,
          targetVmid: params.targetVmid,
          targetStorage: params.targetStorage,
          targetBridge: params.targetBridge,
          online: params.online,
          delete: params.deleteSource,
          bwlimit: params.bwlimit
        })
      }
    )

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err?.error || `HTTP ${res.status}`)
    }

    const json = await res.json()
    const upid = json.data

    if (upid && typeof upid === 'string' && upid.startsWith('UPID:')) {
      trackTask({
        upid,
        connId,
        node,
        description: `VM ${vmid}: ${t('vmActions.migrate')} (cross-cluster)`,
        onSuccess: () => { onRefresh?.() },
        onError: () => { onRefresh?.() },
        ...(params.deleteSource ? { queryParams: { deleteSource: 'true' } } : {}),
      })
    }

    toast.success(t('vmActions.migrateSuccess'))

    if (onSelect) {
      onSelect({ type: 'cluster', id: connId })
    }
  }, [selection, onRefresh, onSelect, toast, t, trackTask])

  // ── Clone (selected VM panel) ───────────────────────────────────────

  const handleCloneVm = useCallback(async (params: { targetNode: string; newVmid: number; name: string; targetStorage?: string; format?: string; pool?: string; full: boolean }) => {
    if (selection?.type !== 'vm') throw new Error('No VM selected')

    const { connId, node, type, vmid } = parseVmId(selection.id)

    const res = await fetch(
      `/api/v1/connections/${encodeURIComponent(connId)}/guests/${type}/${encodeURIComponent(node)}/${encodeURIComponent(vmid)}/clone`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          newid: params.newVmid,
          name: params.name || undefined,
          target: params.targetNode !== node ? params.targetNode : undefined,
          storage: params.targetStorage || undefined,
          format: params.format || undefined,
          pool: params.pool || undefined,
          full: params.full
        })
      }
    )

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))

      throw new Error(err?.error || `HTTP ${res.status}`)
    }

    const json = await res.json()
    const upid = json.data
    if (upid && typeof upid === 'string' && upid.startsWith('UPID:')) {
      trackTask({
        upid,
        connId,
        node,
        description: `${params.name || `VM ${vmid}`}: ${t('vmActions.clone')}`,
        onSuccess: () => { onRefresh?.() },
      })
    } else {
      toast.success(t('vmActions.cloneSuccess'))
      onRefresh?.()
    }
  }, [selection, onRefresh, toast, t, trackTask])

  // ── Table migrate: open dialog ──────────────────────────────────────

  const handleTableMigrate = useCallback((vm: any) => {
    setTableMigrateVm({
      connId: vm.connId,
      node: vm.node,
      type: vm.type,
      vmid: String(vm.vmid),
      name: vm.name || `VM ${vm.vmid}`,
      status: vm.status || 'unknown',
      isCluster: vm.isCluster ?? false
    })
  }, [])

  // ── Table migrate: submit ───────────────────────────────────────────

  const handleTableMigrateVm = useCallback(async (targetNode: string, online: boolean, targetStorage?: string, withLocalDisks?: boolean) => {
    if (!tableMigrateVm) throw new Error('No VM selected for migration')

    const { connId, node, type, vmid } = tableMigrateVm

    const body: Record<string, any> = { target: targetNode, online }

    if (targetStorage) {
      body['targetstorage'] = targetStorage
    }

    if (withLocalDisks) {
      body['withLocalDisks'] = true
    }

    const res = await fetch(
      `/api/v1/connections/${encodeURIComponent(connId)}/guests/${type}/${encodeURIComponent(node)}/${encodeURIComponent(vmid)}/migrate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }
    )

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))

      throw new Error(err?.error || `HTTP ${res.status}`)
    }

    toast.success(t('vmActions.migrateSuccess'))

    await new Promise(resolve => setTimeout(resolve, 2000))

    if (onRefresh) {
      await onRefresh()
    }

    setTableMigrateVm(null)
  }, [tableMigrateVm, onRefresh, toast, t])

  // ── Table cross-cluster migrate ─────────────────────────────────────

  const handleTableCrossClusterMigrate = useCallback(async (params: CrossClusterMigrateParams) => {
    if (!tableMigrateVm) throw new Error('No VM selected for migration')

    const { connId, node, type, vmid } = tableMigrateVm

    const res = await fetch(
      `/api/v1/connections/${encodeURIComponent(connId)}/guests/${type}/${encodeURIComponent(node)}/${encodeURIComponent(vmid)}/remote-migrate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetConnectionId: params.targetConnectionId,
          targetNode: params.targetNode,
          targetVmid: params.targetVmid,
          targetStorage: params.targetStorage,
          targetBridge: params.targetBridge,
          online: params.online,
          delete: params.deleteSource,
          bwlimit: params.bwlimit
        })
      }
    )

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err?.error || `HTTP ${res.status}`)
    }

    const json = await res.json()
    const upid = json.data

    if (upid && typeof upid === 'string' && upid.startsWith('UPID:')) {
      trackTask({
        upid,
        connId,
        node,
        description: `VM ${vmid}: ${t('vmActions.migrate')} (cross-cluster)`,
        onSuccess: () => { onRefresh?.(); setTableMigrateVm(null) },
        onError: () => { onRefresh?.(); setTableMigrateVm(null) },
        ...(params.deleteSource ? { queryParams: { deleteSource: 'true' } } : {}),
      })
    }

    toast.success(t('vmActions.migrateSuccess'))
    setTableMigrateVm(null)
  }, [tableMigrateVm, onRefresh, toast, t, trackTask])

  // ── Table clone ─────────────────────────────────────────────────────

  const handleTableCloneVm = useCallback(async (params: { targetNode: string; newVmid: number; name: string; targetStorage?: string; format?: string; pool?: string; full: boolean }) => {
    if (!tableCloneVm) throw new Error('No VM selected for cloning')

    const { connId, node, type, vmid } = tableCloneVm

    const body: Record<string, any> = {
      newid: params.newVmid,
      name: params.name,
      target: params.targetNode,
      full: params.full ? 1 : 0
    }

    if (params.targetStorage) {
      body.storage = params.targetStorage
    }

    if (params.format) {
      body.format = params.format
    }

    if (params.pool) {
      body.pool = params.pool
    }

    const res = await fetch(
      `/api/v1/connections/${encodeURIComponent(connId)}/guests/${type}/${encodeURIComponent(node)}/${encodeURIComponent(vmid)}/clone`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }
    )

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))

      throw new Error(err?.error || `HTTP ${res.status}`)
    }

    const json = await res.json()
    const upid = json.data
    if (upid && typeof upid === 'string' && upid.startsWith('UPID:')) {
      trackTask({
        upid,
        connId,
        node,
        description: `${params.name || `VM ${vmid}`}: ${t('vmActions.clone')}`,
        onSuccess: () => { onRefresh?.(); setTableCloneVm(null) },
      })
    } else {
      toast.success(t('vmActions.cloneSuccess'))
      onRefresh?.()
      setTableCloneVm(null)
    }
  }, [tableCloneVm, onRefresh, toast, t, trackTask])

  // ── Bulk actions ────────────────────────────────────────────────────

  const handleNodeBulkAction = useCallback((node: NodeRow, action: BulkAction) => {
    setBulkActionDialog({ open: true, action, node, targetNode: '' })
  }, [])

  const handleHostBulkAction = useCallback((host: HostItem, action: BulkAction) => {
    const nodeRow: NodeRow = {
      id: host.key,
      connId: host.connId,
      node: host.node,
      name: host.node,
      status: 'online',
      cpu: 0,
      ram: 0,
      storage: 0,
      vms: host.vms.length,
    }
    setBulkActionDialog({ open: true, action, node: nodeRow, targetNode: '' })
  }, [])

  const executeBulkAction = useCallback(async () => {
    const { action, node, targetNode } = bulkActionDialog
    if (!action || !node || !data?.allVms) return

    const nodeVms = (data.allVms as any[]).filter((vm: any) =>
      vm.node === node.name && !vm.template
    )

    if (nodeVms.length === 0) {
      toast.warning(t('common.noData'))
      setBulkActionDialog({ open: false, action: null, node: null, targetNode: '' })
      return
    }

    let vmsToProcess: any[] = []
    let apiAction = ''
    let description = ''

    switch (action) {
      case 'start-all':
        vmsToProcess = nodeVms.filter((vm: any) => vm.status === 'stopped')
        apiAction = 'start'
        description = t('bulkActions.startingVms')
        break
      case 'shutdown-all':
        vmsToProcess = nodeVms.filter((vm: any) => vm.status === 'running')
        apiAction = 'shutdown'
        description = t('bulkActions.stoppingVms')
        break
      case 'stop-all':
        vmsToProcess = nodeVms.filter((vm: any) => vm.status === 'running')
        apiAction = 'stop'
        description = t('bulkActions.stoppingVms')
        break
      case 'migrate-all':
        if (!targetNode) {
          toast.error(t('bulkActions.selectTargetNode'))
          return
        }
        vmsToProcess = nodeVms.filter((vm: any) => vm.status !== 'stopped' || true) // All VMs
        apiAction = 'migrate'
        description = t('bulkActions.migratingVms')
        break
    }

    if (vmsToProcess.length === 0) {
      toast.info(t('common.noData'))
      setBulkActionDialog({ open: false, action: null, node: null, targetNode: '' })
      return
    }

    setBulkActionDialog({ open: false, action: null, node: null, targetNode: '' })
    toast.info(`${description} (${vmsToProcess.length} VMs)...`)

    const batchSize = 5
    let successCount = 0
    let errorCount = 0

    for (let i = 0; i < vmsToProcess.length; i += batchSize) {
      const batch = vmsToProcess.slice(i, i + batchSize)

      await Promise.all(batch.map(async (vm: any) => {
        try {
          let url: string
          let body: any = undefined

          if (apiAction === 'migrate') {
            url = `/api/v1/connections/${encodeURIComponent(vm.connId)}/guests/${vm.type}/${encodeURIComponent(vm.node)}/${encodeURIComponent(vm.vmid)}/migrate`
            body = JSON.stringify({ target: targetNode, online: vm.status === 'running' })
          } else {
            url = `/api/v1/connections/${encodeURIComponent(vm.connId)}/guests/${vm.type}/${encodeURIComponent(vm.node)}/${encodeURIComponent(vm.vmid)}/${apiAction}`
          }

          const res = await fetch(url, {
            method: 'POST',
            headers: body ? { 'Content-Type': 'application/json' } : undefined,
            body,
          })

          if (res.ok) {
            successCount++
          } else {
            errorCount++
          }
        } catch {
          errorCount++
        }
      }))
    }

    if (errorCount === 0) {
      toast.success(`${description} - ${successCount} VMs`)
    } else if (successCount > 0) {
      toast.warning(`${description} - ${successCount} OK, ${errorCount} erreurs`)
    } else {
      toast.error(`${description} - ${errorCount} erreurs`)
    }

    if (onRefresh) {
      setTimeout(() => onRefresh(), 2000)
    }
  }, [bulkActionDialog, data?.allVms, t, toast, onRefresh])

  // ── VM action (selected VM panel) ───────────────────────────────────

  const handleVmAction = useCallback(async (action: string) => {
    if (selection?.type !== 'vm') return

    const { connId, node, type, vmid } = parseVmId(selection.id)

    // Actions nécessitant confirmation via dialog MUI
    if (['shutdown', 'stop', 'suspend', 'reboot'].includes(action)) {
      const actionLabels: Record<string, { title: string; message: string; icon: string }> = {
        shutdown: { title: t('audit.actions.stop'), message: 'ACPI shutdown', icon: '⏻' },
        stop: { title: t('audit.actions.stop'), message: t('common.warning'), icon: '⛔' },
        suspend: { title: t('audit.actions.suspend'), message: t('audit.actions.suspend'), icon: '⏸️' },
        reboot: { title: t('audit.actions.restart'), message: 'ACPI reboot', icon: '🔄' },
      }

      const label = actionLabels[action]

      setConfirmAction({
        action,
        title: label.title,
        message: label.message,
        vmName: data?.title || `VM ${vmid}`,
        onConfirm: async () => {
          setConfirmActionLoading(true)
          onVmActionStart?.(connId, vmid)

          try {
            const url = `/api/v1/connections/${encodeURIComponent(connId)}/guests/${type}/${encodeURIComponent(node)}/${encodeURIComponent(vmid)}/${action}`
            const res = await fetch(url, { method: 'POST' })
            const json = await res.json()

            if (!res.ok || json.error) {
              throw new Error(json?.error || `HTTP ${res.status}`)
            }

            // Optimistic update
            const optimisticStatus: Record<string, string> = {
              start: 'running', stop: 'stopped', shutdown: 'stopped',
              reboot: 'running', reset: 'running', suspend: 'paused',
              hibernate: 'stopped', resume: 'running',
            }
            if (optimisticStatus[action]) {
              onOptimisticVmStatus?.(connId, vmid, optimisticStatus[action])
              // Also update the detail panel immediately
              if (dataRef.current) {
                const s = optimisticStatus[action]
                const mappedStatus = (s === 'running' ? 'ok' : s === 'paused' ? 'warn' : 'crit') as any
                setDataRef.current({ ...dataRef.current, status: mappedStatus, vmRealStatus: s })
              }
            }

            const refreshAll = () => {
              fetchDetails(selection).then(payload => {
                setDataRef.current(payload)
                setLocalTags(payload.tags || [])
              })
            }

            const upid = json.data
            if (upid && typeof upid === 'string' && upid.startsWith('UPID:')) {
              trackTask({
                upid,
                connId,
                node,
                description: `${data?.title || `VM ${vmid}`}: ${t(`vmActions.${action}`)}`,
                onSuccess: () => {
                  refreshAll()
                  fetch('/api/v1/inventory/poll', { method: 'POST' }).catch(() => {})
                  setTimeout(() => onVmActionEnd?.(connId, vmid), 500)
                },
                onError: () => {
                  onVmActionEnd?.(connId, vmid)
                },
              })
            } else {
              toast.success(t(`vmActions.${action}Success`))
              refreshAll()
              fetch('/api/v1/inventory/poll', { method: 'POST' }).catch(() => {})
              setTimeout(() => onVmActionEnd?.(connId, vmid), 500)
            }

            setConfirmAction(null)
          } catch (e: any) {
            onVmActionEnd?.(connId, vmid)
            const errorMsg = e?.message || e
            toast.error(`${t('common.error')} (${action}): ${errorMsg}`)
          } finally {
            setConfirmActionLoading(false)
          }
        }
      })

      return
    }

    // Actions sans confirmation (start, etc.)
    setActionBusy(true)
    onVmActionStart?.(connId, vmid)

    try {
      const url = `/api/v1/connections/${encodeURIComponent(connId)}/guests/${type}/${encodeURIComponent(node)}/${encodeURIComponent(vmid)}/${action}`
      const res = await fetch(url, { method: 'POST' })
      const json = await res.json()

      if (!res.ok || json.error) {
        throw new Error(json?.error || `HTTP ${res.status}`)
      }

      // Optimistic update
      const optimisticStatus: Record<string, string> = {
        start: 'running', stop: 'stopped', shutdown: 'stopped',
        reboot: 'running', reset: 'running', suspend: 'paused',
        hibernate: 'stopped', resume: 'running',
      }
      if (optimisticStatus[action]) {
        onOptimisticVmStatus?.(connId, vmid, optimisticStatus[action])
        if (dataRef.current) {
          const s = optimisticStatus[action]
          const mappedStatus = (s === 'running' ? 'ok' : s === 'paused' ? 'warn' : 'crit') as any
          setDataRef.current({ ...dataRef.current, status: mappedStatus, vmRealStatus: s })
        }
      }

      const refreshAll = () => {
        fetchDetails(selection).then(payload => {
          setDataRef.current(payload)
          setLocalTags(payload.tags || [])
        })
      }

      const upid = json.data
      if (upid && typeof upid === 'string' && upid.startsWith('UPID:')) {
        trackTask({
          upid,
          connId,
          node,
          description: `${data?.title || `VM ${vmid}`}: ${t(`vmActions.${action}`)}`,
          onSuccess: () => {
            refreshAll()
            fetch('/api/v1/inventory/poll', { method: 'POST' }).catch(() => {})
            setTimeout(() => onVmActionEnd?.(connId, vmid), 500)
          },
          onError: () => {
            onVmActionEnd?.(connId, vmid)
          },
        })
      } else {
        toast.success(t(`vmActions.${action}Success`))
        refreshAll()
        fetch('/api/v1/inventory/poll', { method: 'POST' }).catch(() => {})
        setTimeout(() => onVmActionEnd?.(connId, vmid), 500)
      }
    } catch (e: any) {
      onVmActionEnd?.(connId, vmid)
      const errorMsg = e?.message || e
      toast.error(`${t('common.error')} (${action}): ${errorMsg}`)
    } finally {
      setActionBusy(false)
    }
  }, [selection, data, toast, t, trackTask, onVmActionStart, onVmActionEnd, onOptimisticVmStatus, setConfirmAction, setConfirmActionLoading, setActionBusy, setData, setLocalTags])

  // ── Table VM action ─────────────────────────────────────────────────

  const handleTableVmAction = useCallback(async (vm: VmRow, action: 'start' | 'shutdown' | 'stop' | 'pause' | 'console' | 'details' | 'clone' | 'reboot' | 'suspend') => {
    if (action === 'details') {
      onSelect?.({ type: 'vm', id: vm.id })

      return
    }

    if (action === 'console') {
      const url = `/console/${encodeURIComponent(vm.type)}/${encodeURIComponent(vm.node)}/${encodeURIComponent(vm.vmid)}?connId=${encodeURIComponent(vm.connId)}`

      window.open(url, '_blank')

      return
    }

    if (action === 'clone') {
      setTableCloneVm({
        connId: vm.connId,
        node: vm.node,
        type: vm.type,
        vmid: String(vm.vmid),
        name: vm.name
      })

      return
    }

    const apiAction = action === 'pause' ? 'suspend' : action

    // Actions nécessitant confirmation
    if (['shutdown', 'stop', 'suspend', 'reboot'].includes(apiAction)) {
      const actionLabels: Record<string, { title: string; message: string }> = {
        shutdown: { title: t('audit.actions.stop'), message: 'ACPI shutdown' },
        stop: { title: t('audit.actions.stop'), message: t('common.warning') },
        suspend: { title: t('audit.actions.suspend'), message: t('audit.actions.suspend') },
        reboot: { title: t('audit.actions.restart'), message: 'ACPI reboot' },
      }

      const label = actionLabels[apiAction]

      setConfirmAction({
        action: apiAction,
        title: label.title,
        message: label.message,
        vmName: vm.name,
        onConfirm: async () => {
          setConfirmActionLoading(true)

          try {
            const url = `/api/v1/connections/${encodeURIComponent(vm.connId)}/guests/${vm.type}/${encodeURIComponent(vm.node)}/${encodeURIComponent(vm.vmid)}/${apiAction}`
            const res = await fetch(url, { method: 'POST' })
            const json = await res.json()

            if (!res.ok || json.error) {
              throw new Error(json?.error || `HTTP ${res.status}`)
            }

            const upid = json.data
            if (upid && typeof upid === 'string' && upid.startsWith('UPID:')) {
              trackTask({
                upid,
                connId: vm.connId,
                node: vm.node,
                description: `${vm.name}: ${t(`vmActions.${apiAction}`)}`,
                onSuccess: () => {
                  fetch('/api/v1/inventory/poll', { method: 'POST' }).catch(() => {})
                },
              })
            } else {
              toast.success(t(`vmActions.${apiAction}Success`))
              fetch('/api/v1/inventory/poll', { method: 'POST' }).catch(() => {})
            }

            setConfirmAction(null)
          } catch (e: any) {
            const errorMsg = e?.message || e
            toast.error(`${t('common.error')} (${apiAction}): ${errorMsg}`)
          } finally {
            setConfirmActionLoading(false)
          }
        }
      })

      return
    }

    // Actions sans confirmation (start)
    try {
      const url = `/api/v1/connections/${encodeURIComponent(vm.connId)}/guests/${vm.type}/${encodeURIComponent(vm.node)}/${encodeURIComponent(vm.vmid)}/${apiAction}`
      const res = await fetch(url, { method: 'POST' })
      const json = await res.json()

      if (!res.ok || json.error) {
        throw new Error(json?.error || `HTTP ${res.status}`)
      }

      const upid = json.data
      if (upid && typeof upid === 'string' && upid.startsWith('UPID:')) {
        trackTask({
          upid,
          connId: vm.connId,
          node: vm.node,
          description: `${vm.name}: ${t(`vmActions.${apiAction}`)}`,
          onSuccess: () => {
            fetch('/api/v1/inventory/poll', { method: 'POST' }).catch(() => {})
          },
        })
      } else {
        toast.success(t(`vmActions.${apiAction}Success`))
        fetch('/api/v1/inventory/poll', { method: 'POST' }).catch(() => {})
      }
    } catch (e: any) {
      const errorMsg = e?.message || e
      toast.error(`${t('common.error')} (${apiAction}) ${vm.name}: ${errorMsg}`)
    }
  }, [onSelect, t, toast, trackTask, setConfirmAction, setConfirmActionLoading])

  // ── Convenience wrappers ────────────────────────────────────────────

  const onStart = useCallback(() => handleVmAction('start'), [handleVmAction])
  const onShutdown = useCallback(() => handleVmAction('shutdown'), [handleVmAction])
  const onStop = useCallback(() => handleVmAction('stop'), [handleVmAction])
  const onPause = useCallback(() => handleVmAction('suspend'), [handleVmAction])

  // ── Return ──────────────────────────────────────────────────────────

  return {
    // State
    tableMigrateVm,
    setTableMigrateVm,
    tableCloneVm,
    setTableCloneVm,
    bulkActionDialog,
    setBulkActionDialog,
    creationPending,
    setCreationPending,
    highlightedVmId,
    setHighlightedVmId,

    // Handlers
    handleVmCreated,
    handleLxcCreated,
    handleMigrateVm,
    handleCrossClusterMigrate,
    handleCloneVm,
    handleTableMigrate,
    handleTableMigrateVm,
    handleTableCrossClusterMigrate,
    handleTableCloneVm,
    handleNodeBulkAction,
    handleHostBulkAction,
    executeBulkAction,
    handleVmAction,
    handleTableVmAction,
    onStart,
    onShutdown,
    onStop,
    onPause,
  }
}
