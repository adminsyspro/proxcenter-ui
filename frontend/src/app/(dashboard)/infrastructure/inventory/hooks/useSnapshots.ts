import { useCallback, useEffect, useRef, useState } from 'react'

import type { InventorySelection } from '../types'
import { parseVmId } from '../helpers'
import { deleteSnapshotsSequential } from '@/lib/migration/deleteSnapshotsSequential'
import { waitForPveTask } from '@/lib/proxmox/waitForTaskClient'

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

/** Snapshot task kind shown on the timeline row while it is in flight. */
export type SnapshotRowTask = 'delete' | 'create' | 'rollback'

interface UseSnapshotsParams {
  selection: InventorySelection | null
  detailTab?: number
  t: (key: string, values?: Record<string, string | number>) => string
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
  const [deleteAllBusy, setDeleteAllBusy] = useState(false)
  const [deleteAllProgress, setDeleteAllProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 })
  // Snapshot rows whose PVE task is still in flight (per-row spinner + chip),
  // keyed by snapshot name. Not delete-only: PVE writes the snapshot entry
  // into the VM config before the qmsnapshot/rollback task ends, so a freshly
  // created (or restored) row would otherwise look finished while its task is
  // still running.
  const [snapshotRowTasks, setSnapshotRowTasks] = useState<Record<string, SnapshotRowTask>>({})
  // Number of snapshot tasks we are still following. PVE holds a config lock on
  // the VM for the whole snapshot/rollback/delete task, so any other snapshot
  // action fired meanwhile fails with "VM is locked". The tab stays readable
  // (no blocking overlay), but the mutating buttons are disabled while > 0.
  const [snapshotTaskCount, setSnapshotTaskCount] = useState(0)

  // Current selection id, so long-lived closures (task follows and their
  // delayed refreshes can run for up to 10 min) can detect that the user has
  // moved to another VM and must stop writing state.
  const selectionIdRef = useRef(selection?.id)

  useEffect(() => {
    selectionIdRef.current = selection?.id
  }, [selection?.id])

  const loadSnapshots = useCallback(async () => {
    if (selection?.type !== 'vm') return

    const selectionId = selection.id
    const { connId, type, node, vmid } = parseVmId(selectionId)
    const vmKey = `${connId}:${type}:${node}:${vmid}`

    // loadSnapshots closes over the selection it was created for. Delayed
    // refreshes (setTimeout / task follows) may fire after the user switched
    // VM — skip every state write then, otherwise this would paint the
    // previous VM's snapshot list over the newly selected one.
    const isStale = () => selectionIdRef.current !== selectionId

    if (isStale()) return

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
        if (!isStale()) setSnapshotFeatureAvailable(featureJson.data?.hasFeature ?? false)
      } else {
        setSnapshotFeatureAvailable(true)
      }

      const res = await fetch(
        `/api/v1/guests/${encodeURIComponent(vmKey)}/snapshots`,
        { cache: 'no-store' }
      )

      const json = await res.json()

      if (isStale()) return

      if (json.error) {
        setSnapshotsError(json.error)
      } else {
        setSnapshots(json.data?.snapshots || [])
        setSnapshotsLoaded(true)
      }
    } catch (e: any) {
      if (!isStale()) setSnapshotsError(e.message || t('errors.loadingError'))
    } finally {
      if (!isStale()) setSnapshotsLoading(false)
    }
  }, [selection, t])

  /**
   * Follow the PVE task behind a snapshot action to its real end (issue #627).
   * The snapshot routes are fire-and-forget: they answer with a UPID as soon
   * as the task STARTS, but a qcow2 delta merge can take minutes. Toasting
   * success and refreshing once after 2s left "ghost" rows on screen (and
   * claimed success for tasks that later failed), so the success toast and the
   * authoritative reload now happen when the task actually finishes.
   */
  const followSnapshotTask = useCallback(async (args: {
    upid: unknown
    connId: string
    node: string
    /** Snapshot name whose timeline row is flagged while the task runs. */
    snapname: string
    /** Task kind the row announces (spinner + chip label). */
    rowTask: SnapshotRowTask
    successMessage: string
    fallbackError: string
  }) => {
    const { upid, connId, node, snapname, rowTask, successMessage, fallbackError } = args

    if (typeof upid !== 'string' || !upid.startsWith('UPID:')) {
      // No task to follow (older backend or mocked payload): keep the legacy
      // blind-refresh behaviour.
      toast.success(successMessage)
      setTimeout(loadSnapshots, 2000)
      return
    }

    const selectionId = selection?.id

    setSnapshotTaskCount((n) => n + 1)

    // Re-flagging the same name (e.g. a retried delete) must not pile up
    // entries: the map naturally keeps one flag per snapshot name.
    setSnapshotRowTasks((prev) => (prev[snapname] === rowTask ? prev : { ...prev, [snapname]: rowTask }))

    // Fast feedback: PVE registers config changes before the task ends, so an
    // early refresh often already reflects the action.
    setTimeout(loadSnapshots, 2000)

    const result = await waitForPveTask(connId, node, upid, {
      shouldContinue: () => selectionIdRef.current === selectionId,
    })

    setSnapshotTaskCount((n) => Math.max(0, n - 1))

    setSnapshotRowTasks((prev) => {
      if (!(snapname in prev)) return prev
      const next = { ...prev }
      delete next[snapname]
      return next
    })

    // The user navigated to another VM: its state is no longer ours to touch.
    if (result.outcome === 'abandoned') return

    if (result.outcome === 'ok') {
      toast.success(successMessage)
    } else if (result.outcome === 'failed') {
      const msg = result.error || fallbackError
      setSnapshotsError(msg)
      toast.error(msg)
    }
    // outcome === 'timeout': no toast — the reload below tells the truth (the
    // row stays visible if PVE still lists the snapshot).

    await loadSnapshots()
  }, [selection?.id, loadSnapshots, toast])

  const createSnapshot = useCallback(async () => {
    if (selection?.type !== 'vm' || !newSnapshotName.trim()) return

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
        // Captured before the reset below wipes the field.
        const snapname = newSnapshotName.trim()

        setShowCreateSnapshot(false)
        setNewSnapshotName('')
        setNewSnapshotDesc('')
        setNewSnapshotRam(false)

        // Toast + reload once the PVE task actually finishes (#627). Not
        // awaited: snapshotActionBusy must be released as soon as the HTTP
        // call returns, the follow runs in the background.
        void followSnapshotTask({
          upid: json.data?.upid,
          connId,
          node,
          snapname,
          rowTask: 'create',
          successMessage: t('inventory.snapshotCreated'),
          fallbackError: t('errors.addError'),
        })
      }
    } catch (e: any) {
      const errorMsg = e.message || t('errors.addError')
      setSnapshotsError(errorMsg)
      toast.error(errorMsg)
    } finally {
      setSnapshotActionBusy(false)
    }
  }, [selection, newSnapshotName, newSnapshotDesc, newSnapshotRam, followSnapshotTask, toast, t])

  const deleteSnapshot = useCallback(async (snapname: string) => {
    if (selection?.type !== 'vm') return

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
            // Fire-and-forget on purpose: the confirm dialog closes and
            // snapshotActionBusy is released right away, while the follow
            // keeps the row flagged as deleting until the merge really ends.
            void followSnapshotTask({
              upid: json.data?.upid,
              connId,
              node,
              snapname,
              rowTask: 'delete',
              successMessage: t('inventory.snapshotDeleted'),
              fallbackError: t('errors.deleteError'),
            })
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
  }, [selection, followSnapshotTask, data?.title, toast, t, setConfirmAction, setConfirmActionLoading])

  const deleteAllSnapshots = useCallback(() => {
    if (selection?.type !== 'vm') return

    const { connId, type, node, vmid } = parseVmId(selection.id)
    const vmKey = `${connId}:${type}:${node}:${vmid}`
    // Current (newest-first) order deletes leaf snapshots before their parents.
    const names = snapshots.filter((s: any) => s?.name !== 'current').map((s: any) => s.name as string)
    if (names.length === 0) return

    setConfirmAction({
      action: 'delete-all-snapshots',
      title: `${t('inventory.deleteAllSnapshots')} (${names.length})`,
      message: t('inventory.deleteAllSnapshotsConfirm', { name: data?.title || `VM ${vmid}` }),
      onConfirm: async () => {
        // Close the dialog straight away: the run reports itself on every row
        // and on the toolbar button, so there is no reason to hold a modal open
        // for what can be several minutes of qcow2 merges. No
        // setSnapshotActionBusy either — that would put the blocking overlay
        // back on the whole tab.
        setConfirmAction(null)
        setConfirmActionLoading(false)
        setDeleteAllBusy(true)
        setDeleteAllProgress({ done: 0, total: names.length })
        setSnapshotTaskCount(n => n + 1)
        setSnapshotRowTasks(prev => ({
          ...prev,
          ...Object.fromEntries(names.map(name => [name, 'delete' as SnapshotRowTask])),
        }))

        try {
          const result = await deleteSnapshotsSequential(vmKey, names, (name, status) => {
            if (status !== 'done') return
            setDeleteAllProgress(p => ({ ...p, done: p.done + 1 }))

            // Each delete goes through the route's ?wait=1, so "done" means PVE
            // really finished: drop the row now and let the list melt away
            // instead of freezing until the whole run ends.
            setSnapshots(prev => prev.filter((s: any) => s?.name !== name))
            setSnapshotRowTasks(prev => {
              if (!(name in prev)) return prev
              const next = { ...prev }
              delete next[name]
              return next
            })
          })

          if (result.ok) {
            toast.success(t('inventory.snapshotsAllDeleted'))
          } else {
            const msg = result.error || t('errors.deleteError')
            setSnapshotsError(msg)
            toast.error(msg)
          }
          await loadSnapshots()
        } catch (e: any) {
          const errorMsg = e.message || t('errors.deleteError')
          setSnapshotsError(errorMsg)
          toast.error(errorMsg)
        } finally {
          setDeleteAllBusy(false)
          setSnapshotTaskCount(n => Math.max(0, n - 1))
          // A halted run leaves the snapshots it never reached flagged.
          setSnapshotRowTasks(prev => {
            const next = { ...prev }
            names.forEach(name => delete next[name])
            return next
          })
        }
      }
    })
  }, [selection, snapshots, loadSnapshots, data?.title, toast, t, setConfirmAction, setConfirmActionLoading])

  const rollbackSnapshot = useCallback(async (snapname: string, hasVmstate?: boolean) => {
    if (selection?.type !== 'vm') return

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
            setConfirmAction(null)
            void followSnapshotTask({
              upid: json.data?.upid,
              connId,
              node,
              snapname,
              rowTask: 'rollback',
              successMessage: t('inventory.snapshotRestored'),
              fallbackError: t('errors.updateError'),
            })
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
  }, [selection, followSnapshotTask, data?.title, toast, t, setConfirmAction, setConfirmActionLoading])

  // Reset snapshot states when selection changes
  const resetSnapshots = useCallback(() => {
    setSnapshotsLoaded(false)
    setSnapshots([])
    setSnapshotsError(null)
    setSnapshotFeatureAvailable(null)
    setSnapshotRowTasks({})
    // Tasks still running on the VM we are leaving must not disable the newly
    // selected one's buttons. Their own decrement clamps at 0.
    setSnapshotTaskCount(0)
    // A load abandoned by the stale-selection guard never clears its own
    // loading flag; release it here so the lazy-load effect can fire again.
    setSnapshotsLoading(false)
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
    deleteAllSnapshots,
    deleteAllBusy,
    deleteAllProgress,
    snapshotRowTasks,
    snapshotTaskBusy: snapshotTaskCount > 0,
    rollbackSnapshot,
    resetSnapshots,
  }
}
