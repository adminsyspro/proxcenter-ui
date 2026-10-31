'use client'

import { useMemo, useState } from 'react'

import { useTranslations } from 'next-intl'
import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  CircularProgress,
  IconButton,
  Pagination,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material'

import EmptyState from '@/components/EmptyState'
import { useRBAC } from '@/contexts/RBACContext'

import { availabilityErrorKind } from '../hooks/errorKind'
import { useAllPolicies, useInventoryOptions, useMaintenanceWindows } from '../hooks/useSlaLists'

import { useAvailabilityFormat } from './availabilityFormat'
import DeleteConfirmDialog from './DeleteConfirmDialog'
import MaintenanceDialog from './MaintenanceDialog'
import { GlyphIcon, PROXMOX } from './RowGlyph'
import { errorCodeOf, slaRequest, type WindowItem } from './slaApi'

const SCOPE_ICON: Record<WindowItem['scope'], string> = {
  connection: 'ri-server-line',
  node: PROXMOX,
  guest: 'ri-computer-line',
  policy: 'ri-shield-check-line',
}

type WindowStatus = 'ongoing' | 'upcoming' | 'past'

/** Where a window stands at `now`: the end is exclusive, the start inclusive. */
export function windowStatus(w: Pick<WindowItem, 'startsAt' | 'endsAt'>, now: number): WindowStatus {
  if (now < Date.parse(w.startsAt)) return 'upcoming'

  return now < Date.parse(w.endsAt) ? 'ongoing' : 'past'
}

const STATUS_COLOR = { ongoing: 'info', upcoming: 'default', past: 'default' } as const

export default function MaintenanceTab() {
  const t = useTranslations('availability')
  const { dateTime, duration } = useAvailabilityFormat()
  const { hasPermission } = useRBAC()
  const canManage = hasPermission('alerts.manage')
  const [page, setPage] = useState(1)
  const { data, error, isLoading, mutate } = useMaintenanceWindows(page)
  const { options } = useInventoryOptions(true)
  const policies = useAllPolicies(true).data?.items

  const [editing, setEditing] = useState<WindowItem | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<WindowItem | null>(null)
  const [busy, setBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1
  const now = Date.now()

  const targetLabel = useMemo(() => (w: WindowItem): string => {
    const connection = options.connections.find(c => c.id === w.connectionId)?.name ?? w.connectionId ?? ''

    switch (w.scope) {
      case 'connection': return connection
      case 'node': return `${connection} / ${w.node}`
      case 'guest': {
        const g = options.guests.find(x => x.connectionId === w.connectionId && x.vmid === w.vmid)

        return g?.name ?? t(g?.type === 'lxc' ? 'policies.guestFallbackCt' : 'policies.guestFallbackVm', { vmid: w.vmid ?? 0 })
      }
      default: return policies?.find(p => p.id === w.policyId)?.name ?? t('maintenance.unknownPolicy')
    }
  }, [options, policies, t])

  const confirmDelete = async () => {
    if (!deleting) return

    setBusy(true)
    setDeleteError(null)

    try {
      await slaRequest(`/api/v1/sla/maintenance-windows/${deleting.id}`, 'DELETE')
      setDeleting(null)
      if (data && data.data.length === 1 && page > 1) setPage(page - 1)
      await mutate()
    } catch (e) {
      setDeleteError(t(`errors.${errorCodeOf(e)}`))
    } finally {
      setBusy(false)
    }
  }

  const create = () => setCreating(true)

  let body
  if (error) body = <Alert severity='warning' sx={{ m: 2 }}>{t(`error.${availabilityErrorKind(error)}`)}</Alert>
  else if (isLoading || !data) body = <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress aria-label={t('loading')} /></Box>
  else if (data.data.length === 0) {
    body = (
      <EmptyState
        icon='ri-tools-line'
        title={t('maintenance.empty')}
        description={t('maintenance.emptyDescription')}
        action={canManage ? { label: t('maintenance.new'), onClick: create, icon: 'ri-add-line' } : undefined}
      />
    )
  } else {
    body = (
      <>
        <TableContainer>
          <Table size='small' aria-label={t('tabs.maintenance')}>
            <TableHead>
              <TableRow>
                {(['status', 'target', 'start', 'end', 'duration', 'reason', 'author'] as const).map(c => (
                  <TableCell key={c} sx={{ whiteSpace: 'nowrap' }}>{t(`maintenance.columns.${c}`)}</TableCell>
                ))}
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {data.data.map(w => {
                const status = windowStatus(w, now)
                const label = targetLabel(w)

                return (
                  <TableRow key={w.id} hover>
                    <TableCell>
                      <Chip size='small' color={STATUS_COLOR[status]} variant={status === 'past' ? 'outlined' : 'filled'} label={t(`maintenance.status.${status}`)} />
                    </TableCell>
                    <TableCell sx={{ maxWidth: 240 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                        <GlyphIcon icon={SCOPE_ICON[w.scope]} />
                        <Typography variant='body2' noWrap sx={{ fontWeight: 500 }}>{label}</Typography>
                      </Box>
                    </TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}><Typography variant='body2'>{dateTime(w.startsAt)}</Typography></TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}><Typography variant='body2'>{dateTime(w.endsAt)}</Typography></TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}><Typography variant='body2'>{duration(w.startsAt, w.endsAt)}</Typography></TableCell>
                    <TableCell sx={{ maxWidth: 320 }}>
                      <Tooltip title={w.reason} placement='top-start'>
                        <Typography variant='body2' color='text.secondary' noWrap>{w.reason}</Typography>
                      </Tooltip>
                    </TableCell>
                    <TableCell sx={{ maxWidth: 180 }}><Typography variant='body2' color='text.secondary' noWrap>{w.createdBy}</Typography></TableCell>
                    <TableCell align='right' sx={{ whiteSpace: 'nowrap' }}>
                      {canManage && (
                        <>
                          <Tooltip title={t('common.edit')}>
                            <IconButton size='small' aria-label={`${t('common.edit')} ${label}`} onClick={() => setEditing(w)}>
                              <i className='ri-edit-line' />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title={t('common.delete')}>
                            <IconButton size='small' aria-label={`${t('common.delete')} ${label}`} onClick={() => { setDeleteError(null); setDeleting(w) }}>
                              <i className='ri-delete-bin-line' />
                            </IconButton>
                          </Tooltip>
                        </>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </TableContainer>
        {pages > 1 && (
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', p: 1.5 }}>
            <Pagination count={pages} page={page} onChange={(_, p) => setPage(p)} size='small' />
          </Box>
        )}
      </>
    )
  }

  return (
    <Box>
      <Card variant='outlined'>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, p: 2, borderBottom: 1, borderColor: 'divider' }}>
          <Typography variant='body2' color='text.secondary' sx={{ flex: 1 }}>{t('maintenance.intro')}</Typography>
          {canManage && (
            <Button variant='contained' size='small' startIcon={<i className='ri-add-line' />} onClick={create}>
              {t('maintenance.new')}
            </Button>
          )}
        </Box>
        {body}
      </Card>
      <MaintenanceDialog
        open={creating || editing !== null}
        window={editing}
        onClose={() => { setCreating(false); setEditing(null) }}
        onSaved={() => { setCreating(false); setEditing(null); void mutate() }}
      />
      <DeleteConfirmDialog
        open={deleting !== null}
        title={t('maintenance.deleteTitle')}
        message={t('maintenance.deleteMessage')}
        busy={busy}
        error={deleteError}
        onConfirm={confirmDelete}
        onClose={() => setDeleting(null)}
      />
    </Box>
  )
}
