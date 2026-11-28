'use client'

import { useId, useState } from 'react'
import { Alert, Box, Button, Checkbox, CircularProgress, Dialog, DialogActions, DialogContent, FormControlLabel, TextField, Typography } from '@mui/material'
import { useFormatter, useTranslations } from 'next-intl'

import AppDialogTitle from '@/components/ui/AppDialogTitle'
import { useToast } from '@/contexts/ToastContext'
import { cephPoolUrl, type CephProvisionResult } from '@/lib/ceph/provisionClient'
import { useCephTask } from './hooks/useCephTask'
import type { Pool } from './PoolParts'
import { FormRow } from './provisionUi'
import { TaskFailureAlert, TaskFollowing } from './provisionTask'

/*
   Deletion of a Ceph pool (ui#1450). A pool holding data asks for its name.
   The server refuses a pool whose PVE storages still hold guest disks, or
   whose storages it could not read: the dialog lists what it found. Only this
   cluster's storages are read, and the dialog says so.
*/

export interface PoolDeleteDialogProps {
  open: boolean
  connId: string
  pool: Pool
  /** The PVE storages of the cluster on this pool. */
  storages: string[]
  onClose: () => void
  onDone: () => void
}

/** What the server found when it refused: the guest disks, or the storages it could not read. */
function refusedItems(result: CephProvisionResult | undefined): string[] {
  if (result?.code === 'POOL_HAS_GUEST_DISKS') return result.disks ?? []
  if (result?.code === 'POOL_GUESTS_UNKNOWN') return result.storages ?? []
  return []
}

export default function PoolDeleteDialog({ open, connId, pool, storages, onClose, onDone }: Readonly<PoolDeleteDialogProps>) {
  const t = useTranslations('cephCockpit.provision.pool')
  const tc = useTranslations('common')
  const format = useFormatter()
  const toast = useToast()
  const task = useCephTask(connId)
  const confirmId = useId()
  const [removeStorages, setRemoveStorages] = useState(true)
  const [typed, setTyped] = useState('')

  const holdsData = pool.bytesUsed > 0 || pool.objects > 0
  const confirmed = !holdsData || typed === pool.name
  const code = task.failure?.result?.code
  const listed = refusedItems(task.failure?.result)

  const close = () => {
    task.clear()
    onClose()
  }

  const submit = async () => {
    if (!confirmed) return
    const outcome = await task.run(cephPoolUrl(connId, pool.name, { removeStorages: removeStorages && storages.length > 0 }), 'DELETE')
    if (outcome.ok !== true) return
    toast.success(t('deleted', { name: pool.name }))
    onDone()
    onClose()
  }

  return (
    <Dialog open={open} onClose={close} maxWidth='sm' fullWidth>
      <AppDialogTitle icon={<i className='ri-delete-bin-line' style={{ fontSize: 20 }} aria-hidden />} onClose={close}>
        {t('deleteTitle', { name: pool.name })}
      </AppDialogTitle>
      <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
        <FormRow label={t('deleteData')}>
          <Typography variant='body2'>{t('deleteDataValue', { used: pool.bytesUsedFormatted, objects: format.number(pool.objects) })}</Typography>
        </FormRow>
        <FormRow label={t('deleteStorages')}>
          <Typography variant='body2' color={storages.length > 0 ? 'text.primary' : 'text.secondary'} noWrap title={storages.join(', ')}>
            {storages.length > 0 ? storages.join(', ') : t('deleteNoStorage')}
          </Typography>
        </FormRow>
        {storages.length > 0 && (
          <FormRow label=''>
            <FormControlLabel
              control={<Checkbox size='small' checked={removeStorages} onChange={e => setRemoveStorages(e.target.checked)} />}
              label={<Typography variant='body2'>{t('deleteRemoveStorages')}</Typography>}
            />
          </FormRow>
        )}
        {holdsData && (
          <FormRow label={t('deleteConfirm', { name: pool.name })} htmlFor={confirmId}>
            <TextField id={confirmId} size='small' value={typed} onChange={e => setTyped(e.target.value)} autoComplete='off' sx={{ width: 240 }} />
          </FormRow>
        )}
        <Typography variant='caption' color='text.secondary' sx={{ display: 'block', mt: 0.5 }}>{t('deleteExternal')}</Typography>
        <Box sx={{ mt: 1 }}>
          {task.phase === 'following' && <TaskFollowing />}
          {task.failure && listed.length > 0 && (
            <Alert severity='error' data-testid='pool-delete-refused'>
              {t(code === 'POOL_HAS_GUEST_DISKS' ? 'hasGuests' : 'guestsUnknown')}
              <Box component='ul' sx={{ m: 0, mt: 0.5, pl: 2.5 }}>
                {listed.map(item => <li key={item}><Typography variant='body2' component='span'>{item}</Typography></li>)}
              </Box>
            </Alert>
          )}
          {task.failure && listed.length === 0 && <TaskFailureAlert failure={task.failure} />}
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 1.5 }}>
        <Button onClick={close} color='inherit'>{tc('cancel')}</Button>
        <Button
          variant='contained'
          color='error'
          disabled={!confirmed || task.busy}
          startIcon={task.busy ? <CircularProgress size={16} /> : <i className='ri-delete-bin-line' />}
          onClick={() => void submit()}
        >
          {tc('delete')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
