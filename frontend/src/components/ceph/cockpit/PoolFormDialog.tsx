'use client'

import { useId, useState } from 'react'
import { Box, Button, Checkbox, CircularProgress, Dialog, DialogActions, DialogContent, FormControlLabel, Switch, TextField, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import AppDialogTitle from '@/components/ui/AppDialogTitle'
import { useToast } from '@/contexts/ToastContext'
import { isPoolName, POOL_DEFAULTS, POOL_MAX_SIZE, type PoolApplication, type PoolAutoscale } from '@/lib/ceph/poolForm'
import { cephPoolsUrl, cephPoolUrl } from '@/lib/ceph/provisionClient'
import type { CephCrushRule } from '@/lib/ceph/types'
import { useCephTask } from './hooks/useCephTask'
import type { Pool } from './PoolParts'
import { FormRow, NumberRow, SelectRow } from './provisionUi'
import { TaskFailureAlert, TaskFollowing } from './provisionTask'

/*
   Creation and edit of a replicated Ceph pool (ui#1450). One setting per line.
   The server holds the same rules (lib/ceph/poolForm): min. size 1 needs an
   explicit choice, min. size never above the size, a target ratio or a target
   size but not both. A creation starts with 32 PGs and the autoscaler on.
*/

type TargetKind = 'none' | 'ratio' | 'size'

export interface PoolFormDialogProps {
  open: boolean
  mode: 'create' | 'edit'
  connId: string
  /** The pool being edited (mode edit). */
  pool?: Pool
  crushRules: CephCrushRule[]
  onClose: () => void
  /** The task ended well: the cockpit reloads. */
  onDone: () => void
}

const initialAutoscale = (mode: string | undefined): PoolAutoscale => (mode === 'warn' || mode === 'off' ? mode : 'on')

const toInt = (s: string) => (s.trim() === '' ? Number.NaN : Number(s))

export default function PoolFormDialog({ open, mode, connId, pool, crushRules, onClose, onDone }: Readonly<PoolFormDialogProps>) {
  const t = useTranslations('cephCockpit.provision')
  const tc = useTranslations('common')
  const toast = useToast()
  const task = useCephTask(connId)
  const nameId = useId()
  const editPool = mode === 'edit' && pool ? pool : null
  const edit = editPool !== null
  const poolName = editPool?.name ?? ''

  const [name, setName] = useState('')
  const [size, setSize] = useState(String(editPool?.size ?? POOL_DEFAULTS.size))
  const [minSize, setMinSize] = useState(String(editPool?.minSize ?? POOL_DEFAULTS.minSize))
  const [singleCopy, setSingleCopy] = useState(false)
  const [rule, setRule] = useState(editPool?.crushRuleName ?? '')
  const [autoscale, setAutoscale] = useState<PoolAutoscale>(initialAutoscale(editPool?.pgAutoscaleMode))
  const [targetKind, setTargetKind] = useState<TargetKind>('none')
  const [target, setTarget] = useState('')
  const [application, setApplication] = useState<PoolApplication>('rbd')
  const [addStorage, setAddStorage] = useState(true)

  const sizeN = toInt(size)
  const minN = toInt(minSize)
  const targetN = Number(target)
  const sizeOk = Number.isInteger(sizeN) && sizeN >= 1 && sizeN <= POOL_MAX_SIZE
  const minOk = Number.isInteger(minN) && minN >= 1 && sizeOk && minN <= sizeN && (minN > 1 || singleCopy)
  const targetOk = targetKind === 'none'
    || (targetKind === 'ratio' && target !== '' && targetN >= 0 && targetN <= 1)
    || (targetKind === 'size' && Number.isInteger(targetN) && targetN >= 1)
  const nameOk = edit || isPoolName(name)
  const valid = nameOk && sizeOk && minOk && targetOk

  const close = () => {
    task.clear()
    onClose()
  }

  const submit = async () => {
    if (!valid) return
    const shared: Record<string, unknown> = { size: sizeN, minSize: minN, allowSingleCopy: minN === 1 && singleCopy, autoscale }
    if (rule) shared.crushRule = rule
    if (targetKind === 'ratio') shared.targetRatio = targetN
    if (targetKind === 'size') shared.targetSizeGiB = targetN
    const outcome = edit
      ? await task.run(cephPoolUrl(connId, poolName), 'PUT', shared)
      : await task.run(cephPoolsUrl(connId), 'POST', { name, ...shared, application, addStorage: application === 'rbd' ? addStorage : false })
    if (outcome.ok !== true) return
    toast.success(t(edit ? 'pool.updated' : 'pool.created', { name: edit ? poolName : name }))
    onDone()
    onClose()
  }

  const ruleOptions = [{ value: '', label: t('pool.ruleDefault') }, ...crushRules.map(r => ({ value: r.name, label: r.name }))]

  return (
    <Dialog open={open} onClose={close} maxWidth='sm' fullWidth>
      <AppDialogTitle icon={<i className='ri-database-2-line' style={{ fontSize: 20 }} aria-hidden />} onClose={close}>
        {edit ? t('pool.editTitle', { name: poolName }) : t('pool.createTitle')}
      </AppDialogTitle>
      <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
        {!edit && (
          <FormRow label={t('pool.name')} htmlFor={nameId}>
            <TextField
              id={nameId}
              size='small'
              value={name}
              onChange={e => setName(e.target.value.trim())}
              error={name !== '' && !nameOk}
              placeholder='vm-pool'
              sx={{ width: 240 }}
            />
          </FormRow>
        )}
        <NumberRow label={t('pool.size')} value={size} onChange={setSize} min={1} max={POOL_MAX_SIZE} />
        <NumberRow label={t('pool.minSize')} value={minSize} onChange={setMinSize} min={1} max={POOL_MAX_SIZE} />
        {minN === 1 && (
          <FormRow label=''>
            <FormControlLabel
              control={<Checkbox size='small' checked={singleCopy} onChange={e => setSingleCopy(e.target.checked)} />}
              label={<Typography variant='body2'>{t('pool.singleCopy')}</Typography>}
            />
          </FormRow>
        )}
        <SelectRow label={t('pool.rule')} value={rule} options={ruleOptions} onChange={setRule} />
        <SelectRow<PoolAutoscale>
          label={t('pool.autoscale')}
          value={autoscale}
          options={(['on', 'warn', 'off'] as const).map(v => ({ value: v, label: t(`pool.autoscaleModes.${v}`) }))}
          onChange={setAutoscale}
        />
        <SelectRow<TargetKind>
          label={t('pool.target')}
          value={targetKind}
          options={(['none', 'ratio', 'size'] as const).map(v => ({ value: v, label: t(`pool.targetKinds.${v}`) }))}
          onChange={v => { setTargetKind(v); setTarget('') }}
        />
        {targetKind !== 'none' && (
          <NumberRow
            label={t(targetKind === 'ratio' ? 'pool.targetRatio' : 'pool.targetSize')}
            value={target}
            onChange={setTarget}
            min={targetKind === 'ratio' ? 0 : 1}
            max={targetKind === 'ratio' ? 1 : undefined}
            step={targetKind === 'ratio' ? 0.05 : 1}
            suffix={targetKind === 'size' ? <Typography variant='body2' color='text.secondary'>GiB</Typography> : undefined}
          />
        )}
        {!edit && (
          <>
            <SelectRow<PoolApplication>
              label={t('pool.application')}
              value={application}
              options={(['rbd', 'cephfs', 'rgw'] as const).map(v => ({ value: v, label: v }))}
              onChange={setApplication}
              width={140}
            />
            {application === 'rbd' && (
              <FormRow label=''>
                <FormControlLabel
                  control={<Switch size='small' checked={addStorage} onChange={e => setAddStorage(e.target.checked)} />}
                  label={<Typography variant='body2'>{t('pool.addStorage')}</Typography>}
                />
              </FormRow>
            )}
            <Typography variant='caption' color='text.secondary' sx={{ display: 'block', mt: 0.5 }}>{t('pool.pgNote')}</Typography>
          </>
        )}
        <Box sx={{ mt: 1 }}>
          {task.phase === 'following' && <TaskFollowing />}
          {task.failure && <TaskFailureAlert failure={task.failure} />}
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 1.5 }}>
        <Button onClick={close} color='inherit'>{tc('cancel')}</Button>
        <Button
          variant='contained'
          disabled={!valid || task.busy}
          startIcon={task.busy ? <CircularProgress size={16} /> : <i className={edit ? 'ri-save-line' : 'ri-add-line'} />}
          onClick={() => void submit()}
        >
          {tc(edit ? 'save' : 'create')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

