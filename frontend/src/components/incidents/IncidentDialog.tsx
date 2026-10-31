'use client'

import { useEffect, useState } from 'react'

import { useTranslations } from 'next-intl'
import { useSession } from 'next-auth/react'
import { Alert, Box, Button, CircularProgress, Dialog, DialogContent, DialogTitle, Divider, IconButton, Tooltip, Typography, useMediaQuery } from '@mui/material'
import { alpha, useTheme } from '@mui/material/styles'

import { useRBAC } from '@/contexts/RBACContext'
import DeleteConfirmDialog from '@/app/(dashboard)/operations/availability/components/DeleteConfirmDialog'

import IncidentAlerts from './IncidentAlerts'
import IncidentFacts from './IncidentFacts'
import IncidentHeader, { STATUS_COLOR } from './IncidentHeader'
import IncidentJournal from './IncidentJournal'
import IncidentPostmortem from './IncidentPostmortem'
import IncidentReportCard from './IncidentReportCard'
import { incidentErrorKey, incidentRequest, useIncident, useIncidentCoverage, type RunFn } from './useIncident'

interface Props {
  open: boolean
  incidentId: string | null
  /** An alert to open an incident from, when it has none yet. */
  seedAlertId?: string
  onClose: () => void
  /** Called after every write, so the page behind refreshes its own lists. */
  onChanged?: () => void
}

/** The columns follow the window's one scroll: the title and the key facts stay on top. */
const COLUMN_SX = { display: 'flex', flexDirection: 'column', gap: 4, p: 6, minWidth: 0 } as const

/** The incident window: its key facts on top, alerts and journal on the left, post-mortem and PDF report on the right. */
export default function IncidentDialog({ open, incidentId, seedAlertId, onClose, onChanged }: Readonly<Props>) {
  const t = useTranslations('incidents')
  const { hasPermission } = useRBAC()
  const { data: session } = useSession()
  const [createdId, setCreatedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const id = incidentId ?? createdId
  const { data: view, error: loadError, isLoading, mutate } = useIncident(open ? id : null)
  const { data: coverage } = useIncidentCoverage(view)
  const canManage = hasPermission('alerts.manage')
  const isAdmin = hasPermission('admin.settings')
  const currentUserId = (session?.user as { id?: string } | undefined)?.id ?? ''
  const narrow = useMediaQuery(useTheme().breakpoints.down('md'))
  const statusColor = view ? STATUS_COLOR[view.status] : 'error'

  useEffect(() => {
    setCreatedId(null)
    setError(null)
    setConfirmingDelete(false)
    setDeleteError(null)
  }, [incidentId, seedAlertId, open])

  const run: RunFn = async (fn, silent) => {
    setError(null)

    try {
      await fn()
      await mutate()
      onChanged?.()

      return null
    } catch (e) {
      const message = t(`errors.${incidentErrorKey(e)}`)

      if (!silent) setError(message)
      await mutate()

      return message
    }
  }

  const deleteIncident = async () => {
    if (!view) return
    setDeleting(true)
    setDeleteError(null)

    try {
      await incidentRequest(`/api/v1/incidents/${encodeURIComponent(view.id)}`, 'DELETE')
      setConfirmingDelete(false)
      onClose()
      onChanged?.()
    } catch (e) {
      setDeleteError(t(`errors.${incidentErrorKey(e)}`))
    } finally {
      setDeleting(false)
    }
  }

  const openIncident = async () => {
    setError(null)

    try {
      const created = await incidentRequest<{ id: string }>('/api/v1/incidents', 'POST', { alert_id: seedAlertId })

      setCreatedId(created.id)
      onChanged?.()
    } catch (e) {
      setError(t(`errors.${incidentErrorKey(e)}`))
    }
  }

  let body
  if (view) {
    body = (
      <Box sx={{ display: 'grid', alignItems: 'start', gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 7fr) minmax(0, 5fr)' } }}>
        <Box sx={COLUMN_SX}>
          <IncidentAlerts view={view} canManage={canManage} run={run} outOfSla={coverage?.uncovered} />
          <IncidentJournal incidentId={view.id} comments={view.comments} canManage={canManage} currentUserId={currentUserId} isAdmin={isAdmin} run={run} />
        </Box>
        <Box sx={{ ...COLUMN_SX, pl: { md: 0 }, pt: { xs: 0, md: 6 } }}>
          <IncidentPostmortem view={view} canManage={canManage} run={run} inReport={coverage?.report} />
          <IncidentReportCard view={view} />
        </Box>
      </Box>
    )
  } else if (id) {
    body = (
      <Box sx={{ p: 6, display: 'flex', justifyContent: 'center' }}>
        {loadError ? <Alert severity='error' sx={{ flex: 1 }}>{t('errors.generic')}</Alert> : isLoading && <CircularProgress size={24} />}
      </Box>
    )
  } else {
    body = (
      <Box sx={{ p: 6, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
        <Typography variant='body2' color='text.secondary'>{t('empty.none')}</Typography>
        {canManage && seedAlertId && <Button variant='contained' onClick={openIncident}>{t('empty.open')}</Button>}
      </Box>
    )
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth='lg'
      fullScreen={narrow}
      aria-labelledby='incident-dialog-title'
    >
      <DialogTitle component='div' id='incident-dialog-title' sx={{ display: 'flex', alignItems: 'center', gap: 3, px: 6, py: 4 }}>
        <Box
          aria-hidden='true'
          sx={{ width: 36, height: 36, flexShrink: 0, borderRadius: 1, display: 'grid', placeItems: 'center', fontSize: 20, color: `${statusColor}.main`, bgcolor: theme => alpha(theme.palette[statusColor].main, 0.14) }}
        >
          <i className='ri-alarm-warning-line' />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {view ? <IncidentHeader view={view} canManage={canManage} run={run} /> : <Typography variant='h6'>{t('title')}</Typography>}
        </Box>
        {view && isAdmin && view.status !== 'closed' && (
          <Tooltip title={t('delete.action')}>
            <IconButton size='small' color='error' aria-label={t('delete.action')} onClick={() => { setDeleteError(null); setConfirmingDelete(true) }}>
              <i className='ri-delete-bin-line' aria-hidden='true' />
            </IconButton>
          </Tooltip>
        )}
        <IconButton size='small' aria-label={t('header.cancel')} onClick={onClose}>
          <i className='ri-close-line' aria-hidden='true' />
        </IconButton>
      </DialogTitle>
      <Divider />
      {view && <IncidentFacts view={view} inReport={coverage?.report} />}
      {view && <Divider />}
      <DialogContent sx={{ p: 0 }}>
        {error && <Alert severity='error' onClose={() => setError(null)} sx={{ mx: 6, mt: 4 }}>{error}</Alert>}
        {body}
      </DialogContent>
      <DeleteConfirmDialog
        open={confirmingDelete}
        title={t('delete.title')}
        message={t('delete.message')}
        busy={deleting}
        error={deleteError}
        onConfirm={deleteIncident}
        onClose={() => setConfirmingDelete(false)}
      />
    </Dialog>
  )
}
