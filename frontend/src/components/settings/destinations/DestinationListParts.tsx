'use client'

// List pieces shared by the delivery destination cards (syslog collectors,
// notification channels): load and save banners, health dot, activity
// caption, row actions and the delete confirmation.

import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'

import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  IconButton,
  Skeleton,
  Stack,
  Switch,
  Tooltip,
  Typography,
} from '@mui/material'

import AppDialogTitle from '@/components/ui/AppDialogTitle'

export type DestinationHealth = 'disabled' | 'idle' | 'ok' | 'error'

export type DestinationMessage = { type: 'success' | 'error'; text: string }

const HEALTH_COLOR: Record<DestinationHealth, string> = {
  disabled: 'text.disabled',
  idle: 'action.disabled',
  ok: 'success.main',
  error: 'error.main',
}

type ListStateProps = {
  loadError?: { message?: string } | null
  loadErrorLabel: string
  message: DestinationMessage | null
  onCloseMessage: () => void
  isLoading: boolean
  empty: boolean
  emptyLabel: string
}

/** Load error, save message, loading skeleton and empty state above the table. */
export function DestinationListState({ loadError, loadErrorLabel, message, onCloseMessage, isLoading, empty, emptyLabel }: ListStateProps) {
  return (
    <>
      {loadError && (
        <Alert severity='error' sx={{ mb: 2 }}>
          {loadErrorLabel} {String(loadError.message || '')}
        </Alert>
      )}

      {message && (
        <Alert severity={message.type} sx={{ mb: 2 }} onClose={onCloseMessage}>
          {message.text}
        </Alert>
      )}

      {isLoading && (
        <Stack spacing={1}>
          <Skeleton variant='rounded' height={40} />
          <Skeleton variant='rounded' height={40} />
        </Stack>
      )}

      {!isLoading && !loadError && empty && (
        <Typography variant='body2' color='text.secondary'>
          {emptyLabel}
        </Typography>
      )}
    </>
  )
}

/** Coloured dot at the head of a row, the activity text as its tooltip. */
export function HealthDot({ health, title }: { health: DestinationHealth; title: string }) {
  return (
    <Tooltip title={title}>
      <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: HEALTH_COLOR[health], mx: 'auto' }} />
    </Tooltip>
  )
}

/** Last delivery state of a row, in red once the latest attempt failed. */
export function ActivityCaption({ health, text }: { health: DestinationHealth; text: string }) {
  return (
    <Typography variant='caption' color={health === 'error' ? 'error.main' : 'text.secondary'} noWrap component='div'>
      {text}
    </Typography>
  )
}

type RowActionsProps = {
  enabled: boolean
  saving: boolean
  onToggle: (enabled: boolean) => void
  onEdit: () => void
  onDelete: () => void
}

/** Enable switch, edit and delete buttons at the end of a row. */
export function DestinationRowActions({ enabled, saving, onToggle, onEdit, onDelete }: RowActionsProps) {
  const tc = useTranslations('common')

  return (
    <>
      <Tooltip title={enabled ? tc('enabled') : tc('disabled')}>
        <Switch size='small' checked={enabled} disabled={saving} onChange={e => onToggle(e.target.checked)} />
      </Tooltip>
      <Tooltip title={tc('edit')}>
        <IconButton size='small' onClick={onEdit}>
          <i className='ri-pencil-line' />
        </IconButton>
      </Tooltip>
      <Tooltip title={tc('delete')}>
        <IconButton size='small' color='error' onClick={onDelete}>
          <i className='ri-delete-bin-line' />
        </IconButton>
      </Tooltip>
    </>
  )
}

type DeleteDialogProps = {
  open: boolean
  title: ReactNode
  body: ReactNode
  saving: boolean
  onCancel: () => void
  onConfirm: () => void
}

/** Confirmation before a destination is removed. */
export function DeleteDestinationDialog({ open, title, body, saving, onCancel, onConfirm }: DeleteDialogProps) {
  const tc = useTranslations('common')

  return (
    <Dialog open={open} onClose={onCancel} maxWidth='xs' fullWidth>
      <AppDialogTitle onClose={onCancel} icon={<i className='ri-delete-bin-line' />}>
        {title}
      </AppDialogTitle>
      <DialogContent>
        <Typography variant='body2'>{body}</Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>{tc('cancel')}</Button>
        <Button color='error' variant='contained' disabled={saving} onClick={onConfirm}>
          {tc('delete')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
