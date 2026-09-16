'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import useSWR from 'swr'
import {
  Alert, Box, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  InputAdornment, MenuItem, Select, Stack, Tab, Tabs, TextField, Tooltip, Typography
} from '@mui/material'
import ScheduleBuilder from './schedule/ScheduleBuilder'
import { defaultTimezone, type ScheduleBuilderValue } from './schedule/types'
import { cadenceSeconds, formatWindow, retentionWindowSeconds } from './schedule/retentionWindow'
import BandwidthWindowsEditor from './BandwidthWindowsEditor'
import RetentionSlider from './RetentionSlider'
import EngineGlyph from './EngineGlyph'
import NumericTextField from '@/components/ui/NumericTextField'
import { MAX_VM_NAME_AFFIX, replicaName, vmNameAffixError } from '@/lib/orchestrator/replicaName'
import type { BandwidthWindow, ReplicableVM, ReplicationJob, UpdateReplicationJobRequest } from '@/lib/orchestrator/site-recovery.types'

const fetcher = (url: string) => fetch(url).then(res => {
  if (!res.ok) throw new Error('Failed to fetch')

  return res.json()
})

interface Connection {
  id: string
  name: string
}

/** Same shape as the vDC dialog of Settings, so a long form reads the same way. */
function TabPanel({ value, index, children }: { value: number; index: number; children: ReactNode }) {
  return (
    <Box role='tabpanel' hidden={value !== index} sx={{ display: value === index ? 'flex' : 'none', flexDirection: 'column', gap: 2.5, mt: 1 }}>
      {children}
    </Box>
  )
}

interface InventoryVM {
  vmid: number
  name: string
  connId: string
  type: string
  tags: string[]
}

interface Props {
  open: boolean
  job: ReplicationJob | null
  onClose: () => void
  onSubmit: (id: string, req: UpdateReplicationJobRequest) => Promise<void>
  connections?: Connection[]
  /** Source-cluster inventory, to pick the guests the job carries. */
  allVMs?: InventoryVM[]
  /** Every job, to grey out a guest another one already replicates. */
  jobs?: ReplicationJob[]
}

export default function EditJobDialog({ open, job, onClose, onSubmit, connections, allVMs = [], jobs = [] }: Props) {
  const t = useTranslations()
  const [name, setName] = useState('')
  const [scheduleValue, setScheduleValue] = useState<ScheduleBuilderValue>({
    mode: 'rpo', rpoTargetSeconds: 900, scheduleSpec: null, timezone: defaultTimezone(),
  })
  const [rateLimit, setRateLimit] = useState(0)
  const [bandwidthWindows, setBandwidthWindows] = useState<BandwidthWindow[]>([])
  const [keepSource, setKeepSource] = useState(3)
  const [keepTarget, setKeepTarget] = useState(3)
  const [namePrefix, setNamePrefix] = useState('')
  const [nameSuffix, setNameSuffix] = useState('')
  const [vmIds, setVmIds] = useState<number[]>([])
  const [tags, setTags] = useState<string[]>([])
  const [guestSearch, setGuestSearch] = useState('')
  const [tab, setTab] = useState(0)

  // Which guests of the source cluster this job's storage can actually
  // replicate. A guest with no disk on that storage syncs to nothing and the
  // run just logs "has no RBD disks, skipping", so it is not offered here.
  const { data: replicableVMs, isLoading: replicableLoading } = useSWR<ReplicableVM[]>(
    open && job ? `/api/v1/connections/${job.source_cluster}/replicable-vms?engine=${job.storage_engine || 'rbd'}` : null,
    fetcher
  )

  const replicable = useMemo(
    () => new Map((replicableVMs || []).map(vm => [vm.vmid, vm])),
    [replicableVMs]
  )
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [is409, setIs409] = useState(false)

  // Same caption as the create dialog: the cadence the schedule really produces
  // and how far back the kept points reach. See schedule/retentionWindow.ts.
  const retentionCaption = useMemo(() => {
    const cadence = cadenceSeconds(scheduleValue)
    const covered = retentionWindowSeconds(cadence, keepTarget)

    if (!cadence || !covered) return t('siteRecovery.createJob.retentionTargetHelp')

    return t('siteRecovery.createJob.retentionCoverage', {
      cadence: formatWindow(cadence),
      window: formatWindow(covered),
    })
  }, [scheduleValue, keepTarget, t])

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
    setNamePrefix(job.vm_name_prefix || '')
    setNameSuffix(job.vm_name_suffix || '')
    setVmIds(job.vm_ids || [])
    setTags(job.tags || [])
    setGuestSearch('')
    setTab(0)
    setError('')
    setIs409(false)
  }, [job])

  if (!job) return null

  const tagBased = (job.tags || []).length > 0

  // Guests of the job's SOURCE cluster, with the job that already replicates
  // each one: a guest belongs to one job at a time, the orchestrator refuses
  // the rest, so they are shown greyed rather than hidden.
  const heldByJob = new Map<number, string>()
  for (const other of jobs) {
    if (other.id === job.id || other.source_cluster !== job.source_cluster) continue
    for (const vmid of other.vm_ids || []) heldByJob.set(vmid, other.name || other.id)
  }

  const engine = job.storage_engine || 'rbd'
  const search = guestSearch.trim().toLowerCase()
  const selectableGuests = allVMs
    .filter(vm => vm.connId === job.source_cluster && vm.type === 'qemu')
    // A guest the storage cannot replicate is hidden, unless the job already
    // carries it: then it stays visible so it can be taken back out.
    .filter(vm => replicable.has(vm.vmid) || vmIds.includes(vm.vmid))
    .filter(vm => !search || vm.name?.toLowerCase().includes(search) || String(vm.vmid).includes(search))
    .map(vm => {
      const entry = replicable.get(vm.vmid)
      const blocked = !entry
        ? 'noDisk'
        : entry.unsupported
          ? 'unsupported'
          : engine === 'zfs' && entry.mixed
            ? 'mixed'
            : ''

      return { vmid: vm.vmid, name: vm.name || `VM ${vm.vmid}`, heldBy: heldByJob.get(vm.vmid), blocked }
    })
    .sort((a, b) => a.vmid - b.vmid)

  const availableTags = Array.from(
    new Set(allVMs.filter(vm => vm.connId === job.source_cluster).flatMap(vm => vm.tags || []).map(tag => tag.trim()).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b))

  const connName = (id: string) => connections?.find(c => c.id === id)?.name || id
  const namePrefixError = vmNameAffixError(namePrefix, 'prefix')
  const nameSuffixError = vmNameAffixError(nameSuffix, 'suffix')
  const replicaNameSample = job.vm_names?.find(Boolean) || ''

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
        vm_name_prefix: namePrefix,
        vm_name_suffix: nameSuffix,
      }

      if (tagBased) req.tags = tags
      else req.vm_ids = vmIds
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
        <Tabs
          value={tab}
          onChange={(_, value) => setTab(value)}
          variant='scrollable'
          allowScrollButtonsMobile
          sx={{ borderBottom: 1, borderColor: 'divider', mb: 1, minHeight: 44, '& .MuiTab-root': { minHeight: 44 } }}
        >
          <Tab icon={<i className='ri-information-line' />} iconPosition='start' label={t('siteRecovery.editJob.tabGeneral')} />
          <Tab icon={<i className='ri-time-line' />} iconPosition='start' label={t('siteRecovery.editJob.tabSchedule')} />
          <Tab icon={<i className='ri-history-line' />} iconPosition='start' label={t('siteRecovery.editJob.tabRetention')} />
        </Tabs>

        <TabPanel value={tab} index={0}>
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

          {/* Guests: editable, unlike the cluster pair and the storage below */}
          <Box>
            <Typography variant='subtitle2' sx={{ mb: 0.5 }}>
              {tagBased ? t('siteRecovery.editJob.guestTags') : t('siteRecovery.editJob.guests')}
            </Typography>

            {tagBased ? (
              <Stack spacing={1}>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                  {tags.map(tag => (
                    <Chip key={tag} label={tag} size='small' onDelete={() => setTags(prev => prev.filter(x => x !== tag))} />
                  ))}
                  {tags.length === 0 && (
                    <Typography variant='body2' color='text.secondary'>{t('siteRecovery.editJob.noTag')}</Typography>
                  )}
                </Box>
                <Select
                  size='small'
                  displayEmpty
                  value=''
                  onChange={e => {
                    const tag = String(e.target.value)

                    if (tag) setTags(prev => (prev.includes(tag) ? prev : [...prev, tag]))
                  }}
                >
                  <MenuItem value=''>{t('siteRecovery.editJob.addTag')}</MenuItem>
                  {availableTags.filter(tag => !tags.includes(tag)).map(tag => (
                    <MenuItem key={tag} value={tag}>{tag}</MenuItem>
                  ))}
                </Select>
              </Stack>
            ) : (
              <Stack spacing={1}>
                <TextField
                  size='small'
                  placeholder={t('siteRecovery.editJob.searchGuest')}
                  value={guestSearch}
                  onChange={e => setGuestSearch(e.target.value)}
                  InputProps={{ startAdornment: <InputAdornment position='start'><i className='ri-search-line' /></InputAdornment> }}
                />
                <Box sx={{ maxHeight: 200, overflowY: 'auto', border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 0.5 }}>
                  {replicableLoading && (
                    <Typography variant='body2' color='text.secondary' sx={{ p: 1 }}>
                      {t('siteRecovery.editJob.loadingGuests')}
                    </Typography>
                  )}
                  {!replicableLoading && selectableGuests.length === 0 && (
                    <Typography variant='body2' color='text.secondary' sx={{ p: 1 }}>
                      {t('siteRecovery.editJob.noGuestFound')}
                    </Typography>
                  )}
                  {selectableGuests.map(guest => {
                    const heldBy = guest.heldBy
                    const checked = vmIds.includes(guest.vmid)
                    // Blocked guests are only shown when the job already
                    // carries them, and then the only move left is to remove
                    // them, so the row stays clickable while checked.
                    const disabled = !!heldBy || (!!guest.blocked && !checked)
                    const note = heldBy
                      ? t('siteRecovery.editJob.heldByJob', { job: heldBy })
                      : guest.blocked
                        ? t(`siteRecovery.editJob.blocked.${guest.blocked}`, { engine: t(`siteRecovery.engine.${engine}`) })
                        : ''

                    return (
                      <Box
                        key={guest.vmid}
                        onClick={() => {
                          if (disabled) return
                          setVmIds(prev => (prev.includes(guest.vmid) ? prev.filter(id => id !== guest.vmid) : [...prev, guest.vmid]))
                        }}
                        sx={{
                          display: 'flex', alignItems: 'center', gap: 0.5, px: 0.5, borderRadius: 1,
                          cursor: disabled ? 'default' : 'pointer',
                          opacity: disabled ? 0.45 : 1,
                          '&:hover': disabled ? {} : { bgcolor: 'action.hover' },
                        }}
                      >
                        {/* The row owns the click: a controlled checkbox without its
                            own onChange swallows a click landing exactly on the box,
                            which makes the tick look dead. */}
                        <Checkbox
                          size='small'
                          checked={checked}
                          disabled={disabled}
                          readOnly
                          inputProps={{ 'aria-label': guest.name }}
                          sx={{ p: 0.5, pointerEvents: 'none' }}
                        />
                        <i className='ri-computer-line' style={{ fontSize: 14, opacity: 0.7 }} />
                        <Typography variant='body2' noWrap>{guest.name}</Typography>
                        <Typography variant='caption' sx={{ color: 'text.disabled', ml: 0.5 }}>({guest.vmid})</Typography>
                        {note && (
                          <Typography variant='caption' noWrap sx={{ ml: 'auto', color: 'text.disabled' }}>
                            {note}
                          </Typography>
                        )}
                      </Box>
                    )
                  })}
                </Box>
                <Typography variant='caption' color='text.secondary'>
                  {t('siteRecovery.editJob.guestsHelp')}
                </Typography>
              </Stack>
            )}
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
                <b>Source → Target:</b> {connName(job.source_cluster)} → {connName(job.target_cluster)}
              </Typography>
              <Typography variant='body2' component='div'>
                <b>{t('siteRecovery.createJob.engine')}:</b> <EngineGlyph engine={job.storage_engine} /> {t(`siteRecovery.engine.${job.storage_engine || 'rbd'}`)}
              </Typography>
              <Typography variant='body2' component='div'>
                <b>{t(job.storage_engine === 'zfs' ? 'siteRecovery.createJob.targetStorage' : 'siteRecovery.createJob.targetPool')}:</b> <Chip label={job.target_pool} size='small' variant='outlined' />
              </Typography>
              {job.storage_engine === 'zfs' && <Typography variant='body2'><b>{t('siteRecovery.createJob.targetNode')}:</b> {job.target_node}</Typography>}
              {job.vmid_prefix > 0 && (
                <Typography variant='body2'><b>VMID prefix:</b> {job.vmid_prefix}</Typography>
              )}
            </Stack>
          </Box>
        </TabPanel>

        <TabPanel value={tab} index={1}>
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
          <BandwidthWindowsEditor value={bandwidthWindows} onChange={setBandwidthWindows} staticRateMbps={rateLimit} />
        </TabPanel>

        <TabPanel value={tab} index={2}>
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
                helperText={retentionCaption}
              />
            </Stack>
          </Box>

          {/* Replica name: editable, unlike the VMID prefix, because the
              replica's config is rewritten from the source at every sync. */}
          <Box>
            <Typography variant='subtitle2' sx={{ mb: 0.5 }}>{t('siteRecovery.createJob.replicaName')}</Typography>
            <Typography variant='caption' sx={{ color: 'text.secondary', display: 'block', mb: 1 }}>
              {t('siteRecovery.editJob.replicaNameHelp')}
            </Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
              <TextField
                label={t('siteRecovery.createJob.replicaNamePrefix')}
                value={namePrefix}
                onChange={e => setNamePrefix(e.target.value)}
                size='small'
                fullWidth
                placeholder='DR-'
                error={!!namePrefixError}
                helperText={namePrefixError ? t(`siteRecovery.createJob.replicaNameError.${namePrefixError}`, { max: MAX_VM_NAME_AFFIX }) : ' '}
              />
              <TextField
                label={t('siteRecovery.createJob.replicaNameSuffix')}
                value={nameSuffix}
                onChange={e => setNameSuffix(e.target.value)}
                size='small'
                fullWidth
                placeholder='-DR'
                error={!!nameSuffixError}
                helperText={nameSuffixError ? t(`siteRecovery.createJob.replicaNameError.${nameSuffixError}`, { max: MAX_VM_NAME_AFFIX }) : ' '}
              />
            </Stack>
            {replicaNameSample && (namePrefix || nameSuffix) && !namePrefixError && !nameSuffixError && (
              <Typography variant='caption' sx={{ color: 'text.secondary', display: 'block' }}>
                {replicaNameSample}
                {' → '}
                <Box component='span' sx={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 600, color: 'text.primary' }}>
                  {replicaName(replicaNameSample, namePrefix, nameSuffix)}
                </Box>
              </Typography>
            )}
          </Box>
        </TabPanel>

          {is409 && <Alert severity='warning'>{t('siteRecovery.editJob.syncingAlert')}</Alert>}
          {error && <Alert severity='error'>{error}</Alert>}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={submitting}>{t('common.cancel')}</Button>
        <Button variant='contained' onClick={handleSave} disabled={submitting || !!namePrefixError || !!nameSuffixError}>
          {t('siteRecovery.editJob.save')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
