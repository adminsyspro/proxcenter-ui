'use client'

import { useId, useState } from 'react'
import { Alert, Box, Button, Checkbox, CircularProgress, Dialog, DialogActions, DialogContent, FormControlLabel, TextField, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import AppDialogTitle from '@/components/ui/AppDialogTitle'
import { useToast } from '@/contexts/ToastContext'
import { cephOsdUrl } from '@/lib/ceph/provisionClient'
import type { CephOsd } from '@/lib/ceph/types'
import { useCephTask } from './hooks/useCephTask'
import { FormRow } from './provisionUi'
import { ProvisionFailureAlert, TaskFollowing } from './provisionTask'

/*
   Destruction of an OSD already out and stopped (ui#1450). The OSD name is
   typed to confirm; the disk is wiped by default (pveceph --cleanup). The
   server asks Ceph first (cmd-safety action=destroy) and refuses while
   placement groups still need the OSD.
*/

export interface OsdDestroyDialogProps {
  open: boolean
  connId: string
  /** The PVE node hosting the OSD. */
  node: string
  osd: CephOsd
  onClose: () => void
  onDone: () => void
}

export default function OsdDestroyDialog({ open, connId, node, osd, onClose, onDone }: Readonly<OsdDestroyDialogProps>) {
  const t = useTranslations('cephCockpit.provision.osd')
  const toast = useToast()
  const task = useCephTask(connId)
  const confirmId = useId()
  const [cleanup, setCleanup] = useState(true)
  const [typed, setTyped] = useState('')
  const name = `osd.${osd.id}`
  const refusal = task.failure?.result?.code === 'OSD_NOT_SAFE' ? task.failure.result : null

  const close = () => {
    task.clear()
    onClose()
  }

  const submit = async () => {
    if (typed !== name) return
    const outcome = await task.run(cephOsdUrl(connId, node, osd.id, { cleanup }), 'DELETE')
    if (!('result' in outcome)) return
    if (outcome.result.pending) toast.info(t('destroyPending', { name }))
    else toast.success(t('destroyed', { name }))
    onDone()
    onClose()
  }

  return (
    <Dialog open={open} onClose={close} maxWidth='sm' fullWidth>
      <AppDialogTitle icon={<i className='ri-delete-bin-line' style={{ fontSize: 20 }} aria-hidden />} onClose={close}>
        {t('destroyTitle', { name, node })}
      </AppDialogTitle>
      <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
        <Typography variant='body2' color='text.secondary' sx={{ mb: 0.5 }}>{t('destroyHelp')}</Typography>
        <FormRow label=''>
          <FormControlLabel
            control={<Checkbox size='small' checked={cleanup} onChange={e => setCleanup(e.target.checked)} />}
            label={<Typography variant='body2'>{t('cleanup')}</Typography>}
          />
        </FormRow>
        <FormRow label={t('destroyConfirm', { name })} htmlFor={confirmId}>
          <TextField id={confirmId} size='small' value={typed} onChange={e => setTyped(e.target.value)} autoComplete='off' sx={{ width: 200 }} />
        </FormRow>
        <Box sx={{ mt: 1 }}>
          {task.phase === 'following' && <TaskFollowing />}
          {refusal && (
            <Alert severity='error' data-testid='osd-not-safe'>
              {typeof refusal.numNotOkPgs === 'number' && refusal.numNotOkPgs > 0
                ? t('notSafe', { name, count: refusal.numNotOkPgs })
                : t('notSafeBare', { name })}
            </Alert>
          )}
          {task.failure && !refusal && <ProvisionFailureAlert failure={task.failure} />}
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 1.5 }}>
        <Button onClick={close} color='inherit'>{t('cancel')}</Button>
        <Button
          variant='contained'
          color='error'
          disabled={typed !== name || task.busy}
          startIcon={task.busy ? <CircularProgress size={16} /> : <i className='ri-delete-bin-line' />}
          onClick={() => void submit()}
        >
          {t('destroy')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
