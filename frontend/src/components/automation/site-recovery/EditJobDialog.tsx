'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  Stack, TextField, Tooltip, Typography
} from '@mui/material'
import ScheduleBuilder from './schedule/ScheduleBuilder'
import { defaultTimezone, type ScheduleBuilderValue } from './schedule/types'
import type { ReplicationJob, UpdateReplicationJobRequest } from '@/lib/orchestrator/site-recovery.types'

interface Props {
  open: boolean
  job: ReplicationJob | null
  onClose: () => void
  onSubmit: (id: string, req: UpdateReplicationJobRequest) => Promise<void>
}

export default function EditJobDialog({ open, job, onClose, onSubmit }: Props) {
  const t = useTranslations()
  const [scheduleValue, setScheduleValue] = useState<ScheduleBuilderValue>({
    mode: 'rpo', rpoTargetSeconds: 900, scheduleSpec: null, timezone: defaultTimezone(),
  })
  const [rateLimit, setRateLimit] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [is409, setIs409] = useState(false)

  useEffect(() => {
    if (!job) return
    setScheduleValue({
      mode: job.schedule_spec ? 'scheduled' : 'rpo',
      rpoTargetSeconds: job.rpo_target || 900,
      scheduleSpec: job.schedule_spec,
      timezone: job.timezone || defaultTimezone(),
    })
    setRateLimit(job.rate_limit_mbps || 0)
    setError('')
    setIs409(false)
  }, [job])

  if (!job) return null

  const handleSave = async () => {
    setSubmitting(true)
    setError('')
    setIs409(false)
    try {
      const req: UpdateReplicationJobRequest = {
        rate_limit_mbps: rateLimit,
      }
      if (scheduleValue.mode === 'scheduled' && scheduleValue.scheduleSpec) {
        req.schedule_spec = scheduleValue.scheduleSpec
        req.timezone = scheduleValue.timezone
      } else {
        req.clear_schedule_spec = true
        req.rpo_target = scheduleValue.rpoTargetSeconds
      }
      await onSubmit(job.id, req)
      onClose()
    } catch (e) {
      const err = e as Error & { status?: number }
      if (err.status === 409) setIs409(true)
      else setError(err.message || 'Unknown error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth='sm' fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>{t('siteRecovery.editJob.title')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2.5} sx={{ mt: 1 }}>
          {/* Immutable block */}
          <Box sx={{ border: '1px dashed', borderColor: 'divider', borderRadius: 1, p: 2, bgcolor: 'action.hover' }}>
            <Tooltip title={t('siteRecovery.editJob.immutableTooltip')} placement='top-start'>
              <Typography variant='caption' sx={{ color: 'text.secondary', mb: 1, display: 'block' }}>
                <i className='ri-lock-line' style={{ verticalAlign: 'middle', marginRight: 4 }} />
                {t('siteRecovery.editJob.immutableTooltip')}
              </Typography>
            </Tooltip>
            <Stack spacing={0.5}>
              <Typography variant='body2'>
                <b>VMs:</b> {(job.vm_names || []).join(', ') || `(${job.vm_ids.length} VMs)`}
              </Typography>
              <Typography variant='body2'>
                <b>Source → Target:</b> {job.source_cluster} → {job.target_cluster}
              </Typography>
              <Typography variant='body2'>
                <b>Pool:</b> <Chip label={job.target_pool} size='small' variant='outlined' />
              </Typography>
              {job.vmid_prefix > 0 && (
                <Typography variant='body2'><b>VMID prefix:</b> {job.vmid_prefix}</Typography>
              )}
            </Stack>
          </Box>

          {/* Schedule builder */}
          <ScheduleBuilder value={scheduleValue} onChange={setScheduleValue} />

          {/* Rate limit */}
          <Box>
            <Typography variant='subtitle2' sx={{ mb: 0.5 }}>
              {t('siteRecovery.createJob.rateLimit')}
            </Typography>
            <TextField
              type='number' size='small' fullWidth
              value={rateLimit}
              onChange={e => setRateLimit(Math.max(0, Number(e.target.value) || 0))}
              helperText={t('siteRecovery.editJob.rateLimitHelp')}
            />
          </Box>

          {is409 && <Alert severity='warning'>{t('siteRecovery.editJob.syncingAlert')}</Alert>}
          {error && <Alert severity='error'>{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={submitting}>{t('common.cancel')}</Button>
        <Button variant='contained' onClick={handleSave} disabled={submitting}>
          {t('siteRecovery.editJob.save')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
