'use client'

import { useState } from 'react'

import { useTranslations } from 'next-intl'
import { Box, Chip, IconButton, TextField, Tooltip, Typography } from '@mui/material'

import type { IncidentStatus, IncidentView } from '@/lib/incidents/types'

import { incidentRequest, type RunFn } from './useIncident'

/** The chip color of an incident status, the same in the panel, the list and the alert grid. */
export const STATUS_COLOR: Record<IncidentStatus, 'error' | 'warning' | 'success'> = { open: 'error', resolved: 'warning', closed: 'success' }
const SEVERITIES = ['info', 'warning', 'critical']

interface Props {
  view: IncidentView
  canManage: boolean
  run: RunFn
}

/** Title (edited in place), status and severity of the incident, on one line. */
export default function IncidentHeader({ view, canManage, run }: Readonly<Props>) {
  const t = useTranslations('incidents')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(view.title)

  const canEdit = canManage && view.status !== 'closed'
  const severity = SEVERITIES.includes(view.severity) ? t(`severity.${view.severity}`) : view.severity

  const startEdit = () => {
    setDraft(view.title)
    setEditing(true)
  }

  const save = async () => {
    const title = draft.trim()

    if (!title || title === view.title) {
      setEditing(false)

      return
    }

    const failure = await run(() => incidentRequest(`/api/v1/incidents/${encodeURIComponent(view.id)}`, 'PATCH', { title }))

    if (!failure) setEditing(false)
  }

  const chips = (
    <>
      <Chip size='small' color={STATUS_COLOR[view.status]} label={t(`status.${view.status}`)} />
      <Chip size='small' variant='outlined' label={severity} />
    </>
  )

  if (editing) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
        <TextField
          size='small'
          fullWidth
          autoFocus
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') save()
            if (e.key === 'Escape') setEditing(false)
          }}
          slotProps={{ htmlInput: { 'aria-label': t('header.titleLabel'), maxLength: 200 } }}
        />
        <Tooltip title={t('header.saveTitle')}>
          <IconButton size='small' aria-label={t('header.saveTitle')} onClick={save} disabled={!draft.trim()}>
            <i className='ri-check-line' aria-hidden='true' />
          </IconButton>
        </Tooltip>
        <Tooltip title={t('header.cancel')}>
          <IconButton size='small' aria-label={t('header.cancel')} onClick={() => setEditing(false)}>
            <i className='ri-close-line' aria-hidden='true' />
          </IconButton>
        </Tooltip>
        {chips}
      </Box>
    )
  }

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
      <Tooltip title={view.title}>
        <Typography variant='h6' noWrap sx={{ minWidth: 0 }}>{view.title}</Typography>
      </Tooltip>
      {canEdit && (
        <Tooltip title={t('header.editTitle')}>
          <IconButton size='small' aria-label={t('header.editTitle')} onClick={startEdit}>
            <i className='ri-pencil-line' aria-hidden='true' />
          </IconButton>
        </Tooltip>
      )}
      {chips}
    </Box>
  )
}
