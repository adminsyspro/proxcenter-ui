import { useCallback, useEffect, useState } from 'react'

import type { InventorySelection } from '../types'
import { parseVmId } from '../helpers'
import { useSelectionGuard } from '@/hooks/useSelectionGuard'

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

type ConfirmAction = {
  action: string
  title: string
  message: string
  vmName?: string
  onConfirm: () => Promise<void>
} | null

interface UseHAParams {
  selection: InventorySelection | null
  detailTab: number
  t: (key: string) => string
  data: any
  setConfirmAction: (action: ConfirmAction) => void
  setConfirmActionLoading: (loading: boolean) => void
}

/* ------------------------------------------------------------------ */
/* Hook                                                                */
/* ------------------------------------------------------------------ */

export function useHA({
  selection,
  detailTab,
  t,
  data,
  setConfirmAction,
  setConfirmActionLoading,
}: UseHAParams) {
  const [haConfig, setHaConfig] = useState<any>(null)
  const [haGroups, setHaGroups] = useState<any[]>([])
  const [haLoading, setHaLoading] = useState(false)
  const [haSaving, setHaSaving] = useState(false)
  const [haError, setHaError] = useState<string | null>(null)
  const [haLoaded, setHaLoaded] = useState(false)
  const [haEditing, setHaEditing] = useState(false)

  // Formulaire HA
  const [haState, setHaState] = useState<string>('started')
  const [haGroup, setHaGroup] = useState<string>('')
  const [haMaxRestart, setHaMaxRestart] = useState<number>(1)
  const [haMaxRelocate, setHaMaxRelocate] = useState<number>(1)
  // PVE 9+ per-resource flag. Default true (PVE's own default) so we don't
  // accidentally disable failback for users coming from older clusters.
  const [haFailback, setHaFailback] = useState<boolean>(true)
  const [haComment, setHaComment] = useState<string>('')

  // Requests are bound to the guest they were started for (see resetHA).
  const guard = useSelectionGuard(selection?.id)

  const loadHaConfig = useCallback(async () => {
    if (!selection || selection.type !== 'vm') return

    const req = guard.begin(selection.id)

    if (!req.isCurrent()) return

    const { connId, type, vmid } = parseVmId(selection.id)
    const haSid = `${type === 'lxc' ? 'ct' : 'vm'}:${vmid}`

    setHaLoading(true)
    setHaError(null)

    try {
      // Charger la config HA et les groupes en parallèle
      const [configRes, groupsRes] = await Promise.all([
        fetch(`/api/v1/connections/${encodeURIComponent(connId)}/ha/${encodeURIComponent(haSid)}`, { cache: 'no-store', signal: req.signal }),
        fetch(`/api/v1/connections/${encodeURIComponent(connId)}/ha`, { cache: 'no-store', signal: req.signal })
      ])

      const configJson = await configRes.json()
      const groupsJson = await groupsRes.json()

      if (!req.isCurrent()) return

      if (configJson.error) {
        setHaError(configJson.error)
      } else {
        setHaConfig(configJson.data)


        // Remplir le formulaire si la config existe
        if (configJson.data) {
          setHaState(configJson.data.state || 'started')
          setHaGroup(configJson.data.group || '')
          setHaMaxRestart(configJson.data.max_restart ?? 1)
          setHaMaxRelocate(configJson.data.max_relocate ?? 1)
          // PVE returns failback as 0/1; treat undefined as enabled (PVE default).
          setHaFailback(configJson.data.failback === undefined ? true : Boolean(Number(configJson.data.failback)))
          setHaComment(configJson.data.comment || '')
        } else {
          // Reset le formulaire si pas de config
          setHaState('started')
          setHaGroup('')
          setHaMaxRestart(1)
          setHaMaxRelocate(1)
          setHaFailback(true)
          setHaComment('')
        }
      }

      if (groupsJson.data?.groups) {
        setHaGroups(groupsJson.data.groups)
      }

      setHaLoaded(true)
    } catch (e: any) {
      if (req.isCurrent()) setHaError(e.message || t('errors.loadingError'))
    } finally {
      if (req.isCurrent()) setHaLoading(false)
    }
  }, [selection, guard])

  const saveHaConfig = useCallback(async () => {
    if (!selection || selection.type !== 'vm') return

    const { connId, type, vmid } = parseVmId(selection.id)
    const haSid = `${type === 'lxc' ? 'ct' : 'vm'}:${vmid}`

    // The write always goes through; only its outcome is dropped when the user
    // already moved to another guest.
    const req = guard.begin(selection.id)

    setHaSaving(true)
    setHaError(null)

    try {
      const res = await fetch(
        `/api/v1/connections/${encodeURIComponent(connId)}/ha/${encodeURIComponent(haSid)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            state: haState,
            group: haGroup || undefined,
            max_restart: haMaxRestart,
            max_relocate: haMaxRelocate,
            failback: haFailback,
            comment: haComment || undefined,
          }),
        }
      )

      const json = await res.json()

      if (!req.isCurrent()) return

      if (json.error) {
        setHaError(json.error)
      } else {
        setHaEditing(false)

        // Recharger la config
        void loadHaConfig()
      }
    } catch (e: any) {
      if (req.isCurrent()) setHaError(e.message || t('errors.updateError'))
    } finally {
      if (req.isCurrent()) setHaSaving(false)
    }
  }, [selection, haState, haGroup, haMaxRestart, haMaxRelocate, haFailback, haComment, loadHaConfig, guard])

  const removeHaConfig = useCallback(() => {
    if (!selection || selection.type !== 'vm') return

    const { connId, type, vmid } = parseVmId(selection.id)
    const haSid = `${type === 'lxc' ? 'ct' : 'vm'}:${vmid}`

    setConfirmAction({
      action: 'disable-ha',
      title: t('audit.actions.disable'),
      message: t('common.deleteConfirmation'),
      vmName: data?.title || `VM ${vmid}`,
      onConfirm: async () => {
        // The confirm dialog is shared by the whole panel and is always
        // closed; the HA state is only touched while this guest is current.
        const req = guard.begin(selection.id)

        setConfirmActionLoading(true)
        setHaSaving(true)
        setHaError(null)

        try {
          const res = await fetch(
            `/api/v1/connections/${encodeURIComponent(connId)}/ha/${encodeURIComponent(haSid)}`,
            { method: 'DELETE' }
          )

          const json = await res.json()

          if (req.isCurrent() && json.error) {
            setHaError(json.error)
          } else if (req.isCurrent()) {
            setHaConfig(null)
            setHaEditing(false)

            // Reset formulaire
            setHaState('started')
            setHaGroup('')
            setHaMaxRestart(1)
            setHaMaxRelocate(1)
            setHaFailback(true)
            setHaComment('')
          }

          setConfirmAction(null)
        } catch (e: any) {
          if (req.isCurrent()) setHaError(e.message || t('errors.deleteError'))
        } finally {
          if (req.isCurrent()) setHaSaving(false)
          setConfirmActionLoading(false)
        }
      }
    })
  }, [selection, data?.title, guard])

  // Charger la config HA quand on sélectionne l'onglet HA (index 9)
  useEffect(() => {
    if (detailTab === 9 && selection?.type === 'vm' && !haLoaded && !haLoading) {
      void loadHaConfig()
    }
  }, [detailTab, selection?.type, selection?.id, haLoaded, haLoading, loadHaConfig])

  const resetHA = useCallback(() => {
    setHaLoaded(false)
    setHaConfig(null)
    setHaGroups([])
    setHaError(null)
    setHaEditing(false)
    // The previous guest's load or save is abandoned by the guard and never
    // clears its own flags: release them so the new guest's load can start.
    setHaLoading(false)
    setHaSaving(false)
  }, [])

  return {
    haConfig,
    haGroups,
    haLoading,
    haSaving,
    haError,
    haLoaded,
    haEditing,
    setHaEditing,
    haState,
    setHaState,
    haGroup,
    setHaGroup,
    haMaxRestart,
    setHaMaxRestart,
    haMaxRelocate,
    setHaMaxRelocate,
    haFailback,
    setHaFailback,
    haComment,
    setHaComment,
    loadHaConfig,
    saveHaConfig,
    removeHaConfig,
    resetHA,
  }
}
