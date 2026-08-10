'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  InputAdornment, Stack, TextField, Tooltip, Typography
} from '@mui/material'
import ScheduleBuilder from './schedule/ScheduleBuilder'
import { defaultTimezone, type ScheduleBuilderValue } from './schedule/types'
import BandwidthWindowsEditor from './BandwidthWindowsEditor'
import RetentionSlider from './RetentionSlider'
import NumericTextField from '@/components/ui/NumericTextField'
import type { BandwidthWindow, ReplicationJob, UpdateReplicationJobRequest } from '@/lib/orchestrator/site-recovery.types'

interface Connection {
  id: string
  name: string
}

interface Props {
  open: boolean
  job: ReplicationJob | null
  onClose: () => void
  onSubmit: (id: string, req: UpdateReplicationJobRequest) => Promise<void>
  connections?: Connection[]
}

export default function EditJobDialog({ open, job, onClose, onSubmit, connections }: Props) {
  const t = useTranslations()
  const [name, setName] = useState('')
  const [scheduleValue, setScheduleValue] = useState<ScheduleBuilderValue>({
    mode: 'rpo', rpoTargetSeconds: 900, scheduleSpec: null, timezone: defaultTimezone(),
  })
  const [rateLimit, setRateLimit] = useState(0)
  const [bandwidthWindows, setBandwidthWindows] = useState<BandwidthWindow[]>([])
  const [keepSource, setKeepSource] = useState(3)
  const [keepTarget, setKeepTarget] = useState(3)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [is409, setIs409] = useState(false)

  useEffect(() => {
    if (!job) return
    setName(job.name || '')
    setScheduleValue({
      mode: job.schedule_spec ? 'scheduled' : 'rpo',
      rpoTargetSeconds: job.rpo_target || 900,
      scheduleSpec: job.schedule_spec,
      timezone: job.timezone || defaultTimezone(),
    })
    setRateLimit(job.rate_limit_mbps || 0)
    setBandwidthWindows(job.bandwidth_windows || [])
    setKeepSource(job.snapshot_keep_source || 3)
    setKeepTarget(job.snapshot_keep_target || 3)
    setError('')
    setIs409(false)
  }, [job])

  if (!job) return null

  const connName = (id: string) => connections?.find(c => c.id === id)?.name || id

  const handleSave = async () => {
    setSubmitting(true)
    setError('')
    setIs409(false)
    try {
      const req: UpdateReplicationJobRequest = {
        name: name.trim(),
        rate_limit_mbps: rateLimit,
        bandwidth_windows: bandwidthWindows,
        snapshot_keep_source: keepSource,
        snapshot_keep_target: keepTarget,
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
          {/* Job Name */}
          <Box>
            <Typography variant='subtitle2' sx={{ mb: 0.5 }}>{t('siteRecovery.createJob.name')}</Typography>
            <TextField
              value={name}
              onChange={e => setName(e.target.value)}
              size='small'
              fullWidth
              placeholder={t('siteRecovery.createJob.namePlaceholder')}
              helperText={t('siteRecovery.createJob.nameHelp')}
              InputProps={{ startAdornment: <InputAdornment position='start'><i className='ri-bookmark-line' style={{ opacity: 0.5 }} /></InputAdornment> }}
            />
          </Box>

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
                <b>Source → Target:</b> {connName(job.source_cluster)} → {connName(job.target_cluster)}
              </Typography>
              <Typography variant='body2' component='div'>
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
            <NumericTextField
              type='number' size='small' fullWidth
              value={rateLimit}
              onChange={setRateLimit}
              fallback={0}
              min={0}
              helperText={t('siteRecovery.editJob.rateLimitHelp')}
            />
          </Box>

          {/* Snapshot retention */}
          <Box>
            <Typography variant='subtitle2' sx={{ mb: 0.5 }}>{t('siteRecovery.createJob.snapshotRetention')}</Typography>
            <Typography variant='caption' sx={{ color: 'text.secondary', display: 'block', mb: 1 }}>
              {t('siteRecovery.createJob.snapshotRetentionHelp')}
            </Typography>
            <Stack spacing={1}>
              <RetentionSlider
                label={t('siteRecovery.createJob.retentionSource')}
                value={keepSource}
                onChange={setKeepSource}
              />
              <RetentionSlider
                label={t('siteRecovery.createJob.retentionTarget')}
                value={keepTarget}
                onChange={setKeepTarget}
                helperText={t('siteRecovery.createJob.retentionTargetHelp')}
              />
            </Stack>
          </Box>

          <BandwidthWindowsEditor value={bandwidthWindows} onChange={setBandwidthWindows} staticRateMbps={rateLimit} />

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
