import { useCallback, useEffect, useState } from 'react'

import type { InventorySelection } from '../types'
import { parseVmId } from '../helpers'

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

type Toast = {
  success: (msg: string) => void
  error: (msg: string) => void
  warning?: (msg: string) => void
  info?: (msg: string) => void
}

type ConfirmAction = {
  action: string
  title: string
  message: string
  vmName?: string
  onConfirm: () => Promise<void>
} | null

interface UseSnapshotsParams {
  selection: InventorySelection | null
  detailTab?: number
  t: (key: string) => string
  toast: Toast
  data: any
  setConfirmAction: (action: ConfirmAction) => void
  setConfirmActionLoading: (loading: boolean) => void
}

/* ------------------------------------------------------------------ */
/* Hook                                                                */
/* ------------------------------------------------------------------ */

export function useSnapshots({
  selection,
  detailTab,
  t,
  toast,
  data,
  setConfirmAction,
  setConfirmActionLoading,
}: UseSnapshotsParams) {
  const [snapshots, setSnapshots] = useState<any[]>([])
  const [snapshotsLoading, setSnapshotsLoading] = useState(false)
  const [snapshotsError, setSnapshotsError] = useState<string | null>(null)
  const [snapshotsLoaded, setSnapshotsLoaded] = useState(false)
  const [snapshotActionBusy, setSnapshotActionBusy] = useState(false)
  const [showCreateSnapshot, setShowCreateSnapshot] = useState(false)
  const [newSnapshotName, setNewSnapshotName] = useState('')
  const [newSnapshotDesc, setNewSnapshotDesc] = useState('')
  const [newSnapshotRam, setNewSnapshotRam] = useState(false)
  const [snapshotFeatureAvailable, setSnapshotFeatureAvailable] = useState<boolean | null>(null)

  const loadSnapshots = useCallback(async () => {
    if (!selection || selection.type !== 'vm') return

    const { connId, type, node, vmid } = parseVmId(selection.id)
    const vmKey = `${connId}:${type}:${node}:${vmid}`

    setSnapshotsLoading(true)
    setSnapshotsError(null)

    try {
      // Check snapshot feature availability for LXC containers
      if (type === 'lxc') {
        const featureRes = await fetch(
          `/api/v1/guests/${encodeURIComponent(vmKey)}/features?feature=snapshot`,
          { cache: 'no-store' }
        )
        const featureJson = await featureRes.json()
        setSnapshotFeatureAvailable(featureJson.data?.hasFeature ?? false)
      } else {
        setSnapshotFeatureAvailable(true)
      }

      const res = await fetch(
        `/api/v1/guests/${encodeURIComponent(vmKey)}/snapshots`,
        { cache: 'no-store' }
      )

      const json = await res.json()

      if (json.error) {
        setSnapshotsError(json.error)
      } else {
        setSnapshots(json.data?.snapshots || [])
        setSnapshotsLoaded(true)
      }
    } catch (e: any) {
      setSnapshotsError(e.message || t('errors.loadingError'))
    } finally {
      setSnapshotsLoading(false)
    }
  }, [selection, t])

  const createSnapshot = useCallback(async () => {
    if (!selection || selection.type !== 'vm' || !newSnapshotName.trim()) return

    const { connId, type, node, vmid } = parseVmId(selection.id)
    const vmKey = `${connId}:${type}:${node}:${vmid}`

    setSnapshotActionBusy(true)

    try {
      const res = await fetch(
        `/api/v1/guests/${encodeURIComponent(vmKey)}/snapshots`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: newSnapshotName.trim(),
            description: newSnapshotDesc.trim(),
            vmstate: newSnapshotRam,
          }),
        }
      )

      const json = await res.json()

      if (json.error) {
        setSnapshotsError(json.error)
        toast.error(json.error)
      } else {
        setShowCreateSnapshot(false)
        setNewSnapshotName('')
        setNewSnapshotDesc('')
        setNewSnapshotRam(false)
        toast.success(t('inventory.snapshotCreated'))

        // Recharger après un délai
        setTimeout(loadSnapshots, 2000)
      }
    } catch (e: any) {
      const errorMsg = e.message || t('errors.addError')
      setSnapshotsError(errorMsg)
      toast.error(errorMsg)
    } finally {
      setSnapshotActionBusy(false)
    }
  }, [selection, newSnapshotName, newSnapshotDesc, newSnapshotRam, loadSnapshots, toast, t])

  const deleteSnapshot = useCallback(async (snapname: string) => {
    if (!selection || selection.type !== 'vm') return

    const { connId, type, node, vmid } = parseVmId(selection.id)
    const vmKey = `${connId}:${type}:${node}:${vmid}`

    setConfirmAction({
      action: 'delete-snapshot',
      title: t('inventory.deleteSnapshot'),
      message: `${t('common.deleteConfirmation')} "${snapname}"`,
      vmName: data?.title || `VM ${vmid}`,
      onConfirm: async () => {
        setConfirmActionLoading(true)
        setSnapshotActionBusy(true)

        try {
          const res = await fetch(
            `/api/v1/guests/${encodeURIComponent(vmKey)}/snapshots?name=${encodeURIComponent(snapname)}`,
            { method: 'DELETE' }
          )

          const json = await res.json()

          if (json.error) {
            setSnapshotsError(json.error)
            toast.error(json.error)
          } else {
            toast.success(t('inventory.snapshotDeleted'))
            setTimeout(loadSnapshots, 2000)
          }

          setConfirmAction(null)
        } catch (e: any) {
          const errorMsg = e.message || t('errors.deleteError')
          setSnapshotsError(errorMsg)
          toast.error(errorMsg)
        } finally {
          setSnapshotActionBusy(false)
          setConfirmActionLoading(false)
        }
      }
    })
  }, [selection, loadSnapshots, data?.title, toast, t, setConfirmAction, setConfirmActionLoading])

  const rollbackSnapshot = useCallback(async (snapname: string, hasVmstate?: boolean) => {
    if (!selection || selection.type !== 'vm') return

    const { connId, type, node, vmid } = parseVmId(selection.id)
    const vmKey = `${connId}:${type}:${node}:${vmid}`

    setConfirmAction({
      action: 'restore-snapshot',
      title: t('audit.actions.restore'),
      message: `${t('audit.actions.restore')} "${snapname}"?`,
      vmName: data?.title || `VM ${vmid}`,
      onConfirm: async () => {
        setConfirmActionLoading(true)
        setSnapshotActionBusy(true)

        try {
          const res = await fetch(
            `/api/v1/guests/${encodeURIComponent(vmKey)}/snapshots/${encodeURIComponent(snapname)}`,
            { method: 'POST' }
          )

          const json = await res.json()

          if (json.error) {
            setSnapshotsError(json.error)
            toast.error(json.error)
          } else {
            toast.success(t('inventory.snapshotRestored'))
            setConfirmAction(null)
            setTimeout(loadSnapshots, 2000)
            fetch('/api/v1/inventory/poll', { method: 'POST' }).catch(() => {})
          }
        } catch (e: any) {
          const errorMsg = e.message || t('errors.updateError')
          setSnapshotsError(errorMsg)
          toast.error(errorMsg)
        } finally {
          setSnapshotActionBusy(false)
          setConfirmActionLoading(false)
        }
      }
    })
  }, [selection, data?.title, toast, t, setConfirmAction, setConfirmActionLoading])

  // Reset snapshot states when selection changes
  const resetSnapshots = useCallback(() => {
    setSnapshotsLoaded(false)
    setSnapshots([])
    setSnapshotsError(null)
    setSnapshotFeatureAvailable(null)
  }, [])

  // Load snapshots when Snapshots tab is opened (lazy loading)
  useEffect(() => {
    if (selection?.type === 'vm' && detailTab === 5 && !snapshotsLoaded && !snapshotsLoading) {
      loadSnapshots()
    }
  }, [selection?.type, selection?.id, detailTab, snapshotsLoaded, snapshotsLoading, loadSnapshots])

  return {
    snapshots,
    snapshotsLoading,
    snapshotsError,
    snapshotsLoaded,
    snapshotActionBusy,
    showCreateSnapshot,
    setShowCreateSnapshot,
    newSnapshotName,
    setNewSnapshotName,
    newSnapshotDesc,
    setNewSnapshotDesc,
    newSnapshotRam,
    setNewSnapshotRam,
    snapshotFeatureAvailable,
    loadSnapshots,
    createSnapshot,
    deleteSnapshot,
    rollbackSnapshot,
    resetSnapshots,
  }
}
