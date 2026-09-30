import { useCallback, useEffect, useState } from 'react'

import type { InventorySelection } from '../types'
import { parseVmId } from '../helpers'

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

  const loadNotes = useCallback(async () => {
    if (!selection || selection.type !== 'vm') return

    const { connId, type, node, vmid } = parseVmId(selection.id)
    const vmKey = `${connId}:${type}:${node}:${vmid}`

    setNotesLoading(true)
    setNotesError(null)

    try {
      const res = await fetch(
        `/api/v1/guests/${encodeURIComponent(vmKey)}/notes`,
        { cache: 'no-store' }
      )

      const json = await res.json()

      if (json.error) {
        setNotesError(json.error)
      } else {
        setVmNotes(json.data?.content || '')
        setNotesLoaded(true)
      }
    } catch (e: any) {
      setNotesError(e.message || t('errors.loadingError'))
    } finally {
      setNotesLoading(false)
    }
  }, [selection])

  const saveNotes = useCallback(async () => {
    if (!selection || selection.type !== 'vm') return

    const { connId, type, node, vmid } = parseVmId(selection.id)
    const vmKey = `${connId}:${type}:${node}:${vmid}`

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

      if (json.error) {
        setNotesError(json.error)
      } else {
        setNotesEditing(false)
      }
    } catch (e: any) {
      setNotesError(e.message || t('errors.updateError'))
    } finally {
      setNotesSaving(false)
    }
  }, [selection, vmNotes])

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
