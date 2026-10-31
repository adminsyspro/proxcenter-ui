'use client'

import { useState } from 'react'

import { useFormatter, useNow, useTranslations } from 'next-intl'
import { Box, Button, Checkbox, Chip, FormControlLabel, IconButton, TextField, Tooltip, Typography } from '@mui/material'

import { useAvailabilityFormat } from '@/app/(dashboard)/operations/availability/components/availabilityFormat'
import DeleteConfirmDialog from '@/app/(dashboard)/operations/availability/components/DeleteConfirmDialog'
import type { IncidentComment } from '@/lib/incidents/types'

import IncidentSection from './IncidentSection'
import { incidentRequest, type RunFn } from './useIncident'

const MAX_BODY = 4000

interface Props {
  incidentId: string
  comments: IncidentComment[]
  canManage: boolean
  currentUserId: string
  /** Holds admin.settings: may delete the comment of another author. */
  isAdmin: boolean
  run: RunFn
}

/** The chronological journal of the incident, with the box to add a comment or an internal note. */
export default function IncidentJournal({ incidentId, comments, canManage, currentUserId, isAdmin, run }: Readonly<Props>) {
  const t = useTranslations('incidents')
  const format = useFormatter()
  const fmt = useAvailabilityFormat()
  const now = useNow({ updateInterval: 60_000 })
  const [body, setBody] = useState('')
  const [internal, setInternal] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [toDelete, setToDelete] = useState<IncidentComment | null>(null)
  const [busy, setBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const base = `/api/v1/incidents/${encodeURIComponent(incidentId)}/comments`

  const add = async () => {
    const failure = await run(() => incidentRequest(base, 'POST', { body: body.trim(), internal }))

    if (!failure) {
      setBody('')
      setInternal(false)
    }
  }

  const startEdit = (c: IncidentComment) => {
    setEditingId(c.id)
    setDraft(c.body)
  }

  const saveEdit = async (c: IncidentComment) => {
    const failure = await run(() => incidentRequest(`${base}/${encodeURIComponent(c.id)}`, 'PATCH', { body: draft.trim() }))

    if (!failure) setEditingId(null)
  }

  const confirmDelete = async () => {
    if (!toDelete) return
    setBusy(true)
    const failure = await run(() => incidentRequest(`${base}/${encodeURIComponent(toDelete.id)}`, 'DELETE'), true)

    setBusy(false)
    setDeleteError(failure)
    if (!failure) setToDelete(null)
  }

  return (
    <IncidentSection icon='ri-chat-history-line' title={t('journal.title')} description={t('journal.description')}>
      {comments.length === 0 && <Typography variant='body2' color='text.secondary'>{t('journal.empty')}</Typography>}
      {comments.map(c => {
        const own = c.author_id === currentUserId
        const canEditThis = canManage && own
        const canDeleteThis = canManage && (own || isAdmin)

        return (
          <Box key={c.id} sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
              <Typography variant='body2' sx={{ fontWeight: 500 }}>{c.author_name}</Typography>
              <Tooltip title={fmt.dateTime(c.created_at)}>
                <Typography variant='caption' color='text.secondary'>{format.relativeTime(new Date(c.created_at), now)}</Typography>
              </Tooltip>
              {c.edited_at && (
                <Tooltip title={fmt.dateTime(c.edited_at)}>
                  <Typography variant='caption' color='text.secondary'>{t('journal.edited')}</Typography>
                </Tooltip>
              )}
              {c.internal && (
                <Chip size='small' variant='outlined' icon={<i className='ri-lock-line' aria-hidden='true' />} label={t('journal.internal')} />
              )}
              <Box sx={{ flex: 1 }} />
              {canEditThis && editingId !== c.id && (
                <Tooltip title={t('journal.edit')}>
                  <IconButton size='small' aria-label={t('journal.edit')} onClick={() => startEdit(c)}>
                    <i className='ri-pencil-line' aria-hidden='true' />
                  </IconButton>
                </Tooltip>
              )}
              {canDeleteThis && (
                <Tooltip title={t('journal.delete')}>
                  <IconButton size='small' aria-label={t('journal.delete')} onClick={() => { setDeleteError(null); setToDelete(c) }}>
                    <i className='ri-delete-bin-line' aria-hidden='true' />
                  </IconButton>
                </Tooltip>
              )}
            </Box>
            {editingId === c.id ? (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <TextField
                  multiline
                  minRows={2}
                  size='small'
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  slotProps={{ htmlInput: { 'aria-label': t('journal.edit'), maxLength: MAX_BODY } }}
                />
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <Button size='small' variant='contained' disabled={!draft.trim()} onClick={() => saveEdit(c)}>{t('journal.save')}</Button>
                  <Button size='small' onClick={() => setEditingId(null)}>{t('journal.cancel')}</Button>
                </Box>
              </Box>
            ) : (
              <Typography variant='body2' sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{c.body}</Typography>
            )}
          </Box>
        )
      })}
      {canManage && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <TextField
            multiline
            minRows={2}
            size='small'
            value={body}
            onChange={e => setBody(e.target.value)}
            placeholder={t('journal.placeholder')}
            slotProps={{ htmlInput: { 'aria-label': t('journal.placeholder'), maxLength: MAX_BODY } }}
          />
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <FormControlLabel
              label={t('journal.internalNote')}
              control={<Checkbox size='small' checked={internal} onChange={e => setInternal(e.target.checked)} />}
            />
            <Button size='small' variant='contained' disabled={!body.trim()} onClick={add}>{t('journal.add')}</Button>
          </Box>
        </Box>
      )}
      <DeleteConfirmDialog
        open={toDelete !== null}
        title={t('journal.deleteTitle')}
        message={t('journal.deleteMessage')}
        busy={busy}
        error={deleteError}
        onConfirm={confirmDelete}
        onClose={() => setToDelete(null)}
      />
    </IncidentSection>
  )
}
