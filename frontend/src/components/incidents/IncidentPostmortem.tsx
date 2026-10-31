'use client'

import { useEffect, useState } from 'react'

import { useTranslations } from 'next-intl'
import { Alert, Box, Button, Checkbox, FormControlLabel, IconButton, TextField, Tooltip, Typography } from '@mui/material'

import type { IncidentView } from '@/lib/incidents/types'

import IncidentSection from './IncidentSection'
import { incidentRequest, type RunFn } from './useIncident'

const MAX_FIELD = 4000
const MAX_ACTION = 500

interface Props {
  view: IncidentView
  canManage: boolean
  run: RunFn
  /** Whether the incident enters the SLA report: the notice on what it carries shows only then. */
  inReport?: boolean
}

/** Root cause, impact and corrective actions, and the validation that closes the incident. */
export default function IncidentPostmortem({ view, canManage, run, inReport }: Readonly<Props>) {
  const t = useTranslations('incidents')
  const [rootCause, setRootCause] = useState(view.root_cause)
  const [impact, setImpact] = useState(view.impact)
  const [action, setAction] = useState('')

  useEffect(() => setRootCause(view.root_cause), [view.id, view.root_cause])
  useEffect(() => setImpact(view.impact), [view.id, view.impact])

  const closed = view.status === 'closed'
  const base = `/api/v1/incidents/${encodeURIComponent(view.id)}`
  const filled = rootCause.trim() !== '' && impact.trim() !== ''

  let blocker = ''
  if (view.status === 'open') blocker = t('postmortem.needResolved')
  else if (!filled) blocker = t('postmortem.needFields')

  const saveField = (field: 'root_cause' | 'impact', value: string) => {
    if (value === view[field]) return

    return run(() => incidentRequest(base, 'PATCH', { [field]: value }))
  }

  const validate = async () => {
    await run(async () => {
      if (rootCause !== view.root_cause || impact !== view.impact) await incidentRequest(base, 'PATCH', { root_cause: rootCause, impact })
      await incidentRequest(`${base}/close`, 'POST')
    })
  }

  const addAction = async () => {
    const failure = await run(() => incidentRequest(`${base}/actions`, 'POST', { text: action.trim() }))

    if (!failure) setAction('')
  }

  const field = (label: string, value: string, set: (v: string) => void, name: 'root_cause' | 'impact') => (
    <TextField
      label={label}
      multiline
      minRows={2}
      size='small'
      value={value}
      disabled={closed || !canManage}
      onChange={e => set(e.target.value)}
      onBlur={() => saveField(name, value)}
      slotProps={{ htmlInput: { maxLength: MAX_FIELD } }}
    />
  )

  return (
    <IncidentSection icon='ri-file-search-line' title={t('postmortem.title')} description={t('postmortem.description')}>
      {field(t('postmortem.rootCause'), rootCause, setRootCause, 'root_cause')}
      {field(t('postmortem.impact'), impact, setImpact, 'impact')}
      <Typography variant='subtitle2'>{t('postmortem.actions')}</Typography>
      {view.actions.length === 0 && <Typography variant='body2' color='text.secondary'>{t('postmortem.noActions')}</Typography>}
      {view.actions.map(a => (
        <Box key={a.id} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <FormControlLabel
            sx={{ flex: 1, mr: 0 }}
            label={<Typography variant='body2' sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', textDecoration: a.done ? 'line-through' : 'none' }}>{a.text}</Typography>}
            control={
              <Checkbox
                size='small'
                checked={a.done}
                disabled={!canManage}
                onChange={e => run(() => incidentRequest(`${base}/actions/${encodeURIComponent(a.id)}`, 'PATCH', { done: e.target.checked }))}
              />
            }
          />
          {canManage && (
            <Tooltip title={t('postmortem.deleteAction')}>
              <IconButton size='small' aria-label={t('postmortem.deleteAction')} onClick={() => run(() => incidentRequest(`${base}/actions/${encodeURIComponent(a.id)}`, 'DELETE'))}>
                <i className='ri-delete-bin-line' aria-hidden='true' />
              </IconButton>
            </Tooltip>
          )}
        </Box>
      ))}
      {canManage && (
        <Box sx={{ display: 'flex', gap: 1 }}>
          <TextField
            size='small'
            fullWidth
            label={t('postmortem.actionPlaceholder')}
            value={action}
            onChange={e => setAction(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && action.trim()) void addAction()
            }}
            slotProps={{ htmlInput: { maxLength: MAX_ACTION } }}
          />
          <Button size='small' variant='outlined' disabled={!action.trim()} onClick={addAction} sx={{ whiteSpace: 'nowrap', flexShrink: 0 }}>
            {t('postmortem.addAction')}
          </Button>
        </Box>
      )}
      {inReport && (
        <Alert severity='info' icon={<i className='ri-file-chart-line' aria-hidden='true' />}>{t('postmortem.slaNotice')}</Alert>
      )}
      {closed && view.postmortem_by && (
        <Typography variant='caption' color='text.secondary'>{t('postmortem.validatedBy', { by: view.postmortem_by })}</Typography>
      )}
      {canManage && closed && (
        <Box>
          <Button variant='outlined' onClick={() => run(() => incidentRequest(`${base}/reopen`, 'POST'))}>{t('postmortem.reopen')}</Button>
        </Box>
      )}
      {canManage && !closed && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 3, flexWrap: 'wrap' }}>
          <Button variant='contained' disabled={blocker !== ''} onClick={validate} aria-describedby={blocker ? 'postmortem-blocker' : undefined}>
            {t('postmortem.validate')}
          </Button>
          {blocker && (
            <Typography id='postmortem-blocker' variant='caption' color='text.secondary' sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1, minWidth: 200 }}>
              <i className='ri-information-line' aria-hidden='true' />
              {blocker}
            </Typography>
          )}
        </Box>
      )}
    </IncidentSection>
  )
}
