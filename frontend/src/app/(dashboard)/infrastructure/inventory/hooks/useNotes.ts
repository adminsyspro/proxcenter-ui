import { useCallback, useEffect, useState } from 'react'

import type { InventorySelection } from '../types'
import { parseVmId } from '../helpers'
import { useSelectionGuard } from '@/hooks/useSelectionGuard'

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

interface UseNotesParams {
  selection: InventorySelection | null
  detailTab: number
  t: (key: string) => string
}

/* ------------------------------------------------------------------ */
/* Hook                                                                */
/* ------------------------------------------------------------------ */

export function useNotes({ selection, detailTab, t }: UseNotesParams) {
  const [vmNotes, setVmNotes] = useState('')
  const [notesLoading, setNotesLoading] = useState(false)
  const [notesSaving, setNotesSaving] = useState(false)
  const [notesError, setNotesError] = useState<string | null>(null)
  const [notesEditing, setNotesEditing] = useState(false)
  const [notesLoaded, setNotesLoaded] = useState(false)

  // Requests are bound to the guest they were started for (see resetNotes).
  const guard = useSelectionGuard(selection?.id)

  const loadNotes = useCallback(async () => {
    if (!selection || selection.type !== 'vm') return

    const req = guard.begin(selection.id)

    if (!req.isCurrent()) return

    const { connId, type, node, vmid } = parseVmId(selection.id)
    const vmKey = `${connId}:${type}:${node}:${vmid}`

    setNotesLoading(true)
    setNotesError(null)

    try {
      const res = await fetch(
        `/api/v1/guests/${encodeURIComponent(vmKey)}/notes`,
        { cache: 'no-store', signal: req.signal }
      )

      const json = await res.json()

      if (!req.isCurrent()) return

      if (json.error) {
        setNotesError(json.error)
      } else {
        setVmNotes(json.data?.content || '')
        setNotesLoaded(true)
      }
    } catch (e: any) {
      if (req.isCurrent()) setNotesError(e.message || t('errors.loadingError'))
    } finally {
      if (req.isCurrent()) setNotesLoading(false)
    }
  }, [selection, guard])

  const saveNotes = useCallback(async () => {
    if (!selection || selection.type !== 'vm') return

    const { connId, type, node, vmid } = parseVmId(selection.id)
    const vmKey = `${connId}:${type}:${node}:${vmid}`

    // The save itself always goes through; only its outcome is dropped when
    // the user already moved to another guest.
    const req = guard.begin(selection.id)

    setNotesSaving(true)
    setNotesError(null)

    try {
      const res = await fetch(
        `/api/v1/guests/${encodeURIComponent(vmKey)}/notes`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: vmNotes }),
        }
      )

      const json = await res.json()

      if (!req.isCurrent()) return

      if (json.error) {
        setNotesError(json.error)
      } else {
        setNotesEditing(false)
      }
    } catch (e: any) {
      if (req.isCurrent()) setNotesError(e.message || t('errors.updateError'))
    } finally {
      if (req.isCurrent()) setNotesSaving(false)
    }
  }, [selection, vmNotes, guard])

  // Charger les notes quand on sélectionne l'onglet Résumé (0) ou Notes (6)
  useEffect(() => {
    if ((detailTab === 0 || detailTab === 6) && selection?.type === 'vm' && !notesLoaded && !notesLoading) {
      void loadNotes()
    }
  }, [detailTab, selection?.type, selection?.id, notesLoaded, notesLoading, loadNotes])

  const resetNotes = useCallback(() => {
    setNotesLoaded(false)
    setVmNotes('')
    setNotesError(null)
    setNotesEditing(false)
    // The previous guest's load (if any) is abandoned by the guard and never
    // clears its own flags: without this, the lazy-load effect would wait for
    // it forever and the new guest's notes would never be fetched.
    setNotesLoading(false)
    setNotesSaving(false)
  }, [])

  return {
    vmNotes,
    setVmNotes,
    notesLoading,
    notesSaving,
    notesError,
    notesEditing,
    setNotesEditing,
    loadNotes,
    saveNotes,
    resetNotes,
  }
}
