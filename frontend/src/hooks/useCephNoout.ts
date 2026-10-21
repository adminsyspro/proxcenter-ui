'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'

import { useToast } from '@/contexts/ToastContext'
import { notifyCephFlagsChanged, useCephFlagsChanged } from '@/lib/ceph/flagsEvents'

/*
   Per-host Ceph noout around a node maintenance (ui#1164).

   One hook for every dialog that enters or leaves maintenance: it reads what
   Ceph knows about the node when the dialog opens (CRUSH host, OSDs, flags,
   health, the ok-to-stop precheck), holds the operator's choice, and sets or
   removes the flag when the dialog confirms. The dialogs only render
   CephNooutOption with this state and call setFlag / removeAfterExit.
*/

export interface CephNooutOsd {
  id: number
  status: string
  in: boolean
}

export interface CephNooutOkToStop {
  ok: boolean
  osds?: number[]
  numOkPgs?: number
  numNotOkPgs?: number
  /** Why no verdict could be obtained (SSH failure); null when it was. */
  message?: string | null
}

export interface CephNooutInfo {
  hasCeph: boolean
  crushHost?: string | null
  osds?: CephNooutOsd[]
  /** The host flag is set on this node's CRUSH host. */
  noout?: boolean
  /** Every flag of this node's CRUSH host (noout, noin, noup, nodown). */
  hostFlags?: string[]
  /** The cluster-wide noout is set. */
  globalNoout?: boolean
  health?: { status: string; checks: { code: string; severity: string; message: string }[] } | null
  otherHostsWithNoout?: string[]
  okToStop?: CephNooutOkToStop | null
}

export type CephNooutMode = 'enter' | 'exit'

export interface CephNooutRemoveResult {
  ok: boolean
  code?: string
  osds?: number[]
  error?: string
}

export interface CephNooutState {
  mode: CephNooutMode
  connId: string
  node: string
  info: CephNooutInfo | null
  loading: boolean
  /** The node's OSDs, none without Ceph. */
  osds: CephNooutOsd[]
  /** The option is worth showing: OSDs on the node and, when leaving, the host flag set. */
  available: boolean
  /** The operator's choice, on by default. */
  wanted: boolean
  setWanted: (wanted: boolean) => void
  /** "I understand, proceed anyway" when the precheck says stopping is unsafe. */
  acknowledged: boolean
  setAcknowledged: (acknowledged: boolean) => void
  /** Entering: the precheck refused and the operator did not acknowledge it yet. */
  blocked: boolean
  /** The flag is to be set (entering) or removed (leaving) when the dialog confirms. */
  active: boolean
  refresh: () => Promise<void>
  /** Entering: set the flag, forced when acknowledged. Throws with the server's message on failure. */
  setFlag: () => Promise<void>
  /** Leaving: remove the flag; never throws, a 409 osds_down comes back with its OSD ids. */
  remove: (opts?: { force?: boolean }) => Promise<CephNooutRemoveResult>
  /** Remove another flag of the node's CRUSH host (noin, noup, nodown); never throws. */
  removeHostFlag: (flag: string) => Promise<boolean>
  /** Leaving, once maintenance is left: remove the flag when wanted and say what happened in a toast. */
  removeAfterExit: () => Promise<void>
  /**
   * Entering, when the action fails before the node is in maintenance: remove
   * the flag setFlag() just set, so it does not outlive an aborted action. A
   * flag that was already there before the dialog is left alone. Never throws.
   */
  rollback: () => Promise<void>
}

export function cephNooutUrl(connId: string, node: string, query = ''): string {
  return `/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/ceph/noout${query}`
}

/** The payload as the hook keeps it: an object with hasCeph, or no Ceph at all (demo mode answers a list). */
function normalizeInfo(data: unknown): CephNooutInfo {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { hasCeph: false }
  const d = data as CephNooutInfo
  return d.hasCeph ? { ...d, osds: Array.isArray(d.osds) ? d.osds : [] } : { hasCeph: false }
}

export const osdNames = (ids: number[]) => ids.map(id => `osd.${id}`).join(', ')

export function useCephNoout(opts: {
  connId: string | null | undefined
  node: string | null | undefined
  /** Read when it turns true (the dialog opened); the choice starts over each time. */
  open: boolean
  mode: CephNooutMode
  /** Any change rereads, e.g. the node's maintenance state for a chip that stays mounted. */
  refreshKey?: unknown
}): CephNooutState {
  const { open, mode, refreshKey } = opts
  const connId = opts.connId || ''
  const node = opts.node || ''
  const t = useTranslations()
  const toast = useToast()

  const [info, setInfo] = useState<CephNooutInfo | null>(null)
  const [loading, setLoading] = useState(false)
  const [wanted, setWanted] = useState(true)
  const [acknowledged, setAcknowledged] = useState(false)
  // setFlag() set the flag in this dialog session (it was not there before).
  const setHere = useRef(false)

  const load = useCallback(async (): Promise<CephNooutInfo> => {
    try {
      const res = await fetch(cephNooutUrl(connId, node, mode === 'enter' ? '?precheck=1' : ''))
      const json = await res.json().catch(() => ({}))
      return res.ok ? normalizeInfo(json?.data) : { hasCeph: false }
    } catch {
      return { hasCeph: false }
    }
  }, [connId, node, mode])

  useEffect(() => {
    if (!open || !connId || !node) return
    let cancelled = false
    // The state writes live in this function, not in the effect body
    // (react-hooks/set-state-in-effect).
    const run = async () => {
      setWanted(true)
      setHere.current = false
      setAcknowledged(false)
      setLoading(true)
      const next = await load()
      if (cancelled) return
      setInfo(next)
      setLoading(false)
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [open, connId, node, load, refreshKey])

  const refresh = useCallback(async () => {
    if (!connId || !node) return
    setInfo(await load())
  }, [connId, node, load])

  // The node view's other readers (Flags OSD panel, OSD table) may change the
  // host's flags: the banner rereads. Dialogs (enter) read once on open.
  const source = useCephFlagsChanged(connId, () => { void refresh() }, mode === 'exit' && open)

  const osds = info?.hasCeph ? info.osds || [] : []
  const available = osds.length > 0 && (mode === 'enter' || !!info?.noout)
  const unsafe = mode === 'enter' && info?.okToStop?.ok === false
  const active = available && wanted
  const blocked = active && unsafe && !acknowledged
  const host = info?.crushHost || node

  const setFlag = useCallback(async () => {
    const res = await fetch(cephNooutUrl(connId, node), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force: acknowledged }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`)
    setHere.current = setHere.current || !info?.noout
    setInfo(prev => (prev ? { ...prev, noout: true, hostFlags: [...new Set([...(prev.hostFlags || []), 'noout'])] } : prev))
    notifyCephFlagsChanged(connId, source)
  }, [connId, node, acknowledged, info?.noout, source])

  const remove = useCallback(async (removeOpts?: { force?: boolean }): Promise<CephNooutRemoveResult> => {
    try {
      const res = await fetch(cephNooutUrl(connId, node, removeOpts?.force ? '?force=1' : ''), { method: 'DELETE' })
      const json = await res.json().catch(() => ({}))
      if (res.ok) {
        setInfo(prev => (prev ? { ...prev, noout: false, hostFlags: (prev.hostFlags || []).filter(f => f !== 'noout') } : prev))
        notifyCephFlagsChanged(connId, source)
        return { ok: true }
      }
      return { ok: false, code: json?.code, osds: Array.isArray(json?.osds) ? json.osds : undefined, error: json?.error || `HTTP ${res.status}` }
    } catch (e: any) {
      return { ok: false, error: e?.message || 'network error' }
    }
  }, [connId, node, source])

  const crushHost = info?.crushHost || node
  const removeHostFlag = useCallback(async (flag: string): Promise<boolean> => {
    try {
      const res = await fetch(`/api/v1/connections/${encodeURIComponent(connId)}/ceph/flags`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ flag, host: crushHost }),
      })
      if (!res.ok) return false
      setInfo(prev => (prev ? { ...prev, hostFlags: (prev.hostFlags || []).filter(f => f !== flag) } : prev))
      notifyCephFlagsChanged(connId, source)
      return true
    } catch {
      return false
    }
  }, [connId, crushHost, source])

  const removeAfterExit = useCallback(async () => {
    if (!active) return
    const result = await remove()
    if (result.ok) {
      toast.success(t('cephNoout.removed', { host }))
    } else if (result.code === 'osds_down') {
      // Leaving maintenance succeeded: the flag only waits for the OSDs.
      toast.warning(t('cephNoout.keptOsdsDown', { osds: osdNames(result.osds || []), count: result.osds?.length ?? 0 }), 10_000)
    } else {
      toast.error(t('cephNoout.removeFailed', { error: result.error || '' }))
    }
  }, [active, remove, toast, t, host])

  const rollback = useCallback(async () => {
    if (!setHere.current) return
    setHere.current = false
    // The node never went down: its OSDs are up and the removal goes through.
    await remove()
  }, [remove])

  return {
    mode, connId, node, info, loading, osds, available,
    wanted, setWanted, acknowledged, setAcknowledged,
    blocked, active, refresh, setFlag, remove, removeHostFlag, removeAfterExit, rollback,
  }
}
