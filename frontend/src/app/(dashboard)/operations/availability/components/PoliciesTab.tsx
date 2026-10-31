'use client'

import { useState } from 'react'

import { useTranslations } from 'next-intl'
import {
  Alert,
  Box,
  Button,
  Card,
  CircularProgress,
  Pagination,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'

import EmptyState from '@/components/EmptyState'
import { useRBAC } from '@/contexts/RBACContext'

import { availabilityErrorKind } from '../hooks/errorKind'
import { usePolicies } from '../hooks/useSlaLists'

import DeleteConfirmDialog from './DeleteConfirmDialog'
import PolicyDialog from './PolicyDialog'
import PolicyRow from './PolicyRow'
import { errorCodeOf, slaRequest, type PolicyItem } from './slaApi'

interface Props {
  /** Opens the measured connections; unset for whoever may not change them. */
  onConfigure?: () => void
}

export default function PoliciesTab({ onConfigure }: Readonly<Props>) {
  const t = useTranslations('availability')
  const { hasPermission } = useRBAC()
  const canManage = hasPermission('alerts.manage')
  const [page, setPage] = useState(1)
  const { data, error, isLoading, mutate } = usePolicies(page)

  const [editing, setEditing] = useState<PolicyItem | null>(null)
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<PolicyItem | null>(null)
  const [busy, setBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1

  const confirmDelete = async () => {
    if (!deleting) return

    setBusy(true)
    setDeleteError(null)

    try {
      await slaRequest(`/api/v1/sla/policies/${deleting.id}`, 'DELETE')
      setDeleting(null)
      // The last row of the last page is gone: step back to the page before.
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
        icon='ri-shield-check-line'
        title={t('policies.empty')}
        description={t('policies.emptyDescription')}
        action={canManage ? { label: t('policies.new'), onClick: create, icon: 'ri-add-line' } : undefined}
      />
    )
  } else {
    body = (
      <>
        <TableContainer>
          <Table size='small' aria-label={t('tabs.policies')}>
            <TableHead>
              <TableRow>
                <TableCell padding='checkbox' />
                {(['policy', 'scope', 'status', 'target', 'availability', 'budget', 'guests'] as const).map(c => (
                  <TableCell key={c} sx={{ whiteSpace: 'nowrap' }}>{t(`policies.columns.${c}`)}</TableCell>
                ))}
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {data.data.map(p => (
                <PolicyRow key={p.id} policy={p} canManage={canManage} onEdit={setEditing} onDelete={p2 => { setDeleteError(null); setDeleting(p2) }} onConfigure={onConfigure} />
              ))}
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
          <Typography variant='body2' color='text.secondary' sx={{ flex: 1 }}>{t('policies.intro')}</Typography>
          {canManage && (
            <Button variant='contained' size='small' startIcon={<i className='ri-add-line' />} onClick={create} disabled={!data}>
              {t('policies.new')}
            </Button>
          )}
        </Box>
        {body}
      </Card>
      <PolicyDialog
        open={creating || editing !== null}
        policy={editing}
        defaultTarget={data?.defaultTarget ?? 99.9}
        onClose={() => { setCreating(false); setEditing(null) }}
        onSaved={() => { setCreating(false); setEditing(null); void mutate() }}
      />
      <DeleteConfirmDialog
        open={deleting !== null}
        title={t('policies.deleteTitle')}
        message={t('policies.deleteMessage', { name: deleting?.name ?? '' })}
        busy={busy}
        error={deleteError}
        onConfirm={confirmDelete}
        onClose={() => setDeleting(null)}
      />
    </Box>
  )
}
