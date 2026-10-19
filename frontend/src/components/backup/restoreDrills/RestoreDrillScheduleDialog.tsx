'use client'

// Create or edit a restore drill schedule (roadmap#35, addendum 4): which
// PBS datastore and namespace, which VMs (a list or all of them), which
// restore point, where and how isolated, how often and how many VMs per pass.

import { useEffect, useMemo, useState } from 'react'

import { useTranslations } from 'next-intl'
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  FormControl,
  FormControlLabel,
  FormHelperText,
  InputLabel,
  MenuItem,
  Radio,
  RadioGroup,
  Select,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'

import BackupSchedulePicker from '@/app/(dashboard)/operations/backups/BackupSchedulePicker'
import AppDialogTitle from '@/components/ui/AppDialogTitle'
import NumericTextField from '@/components/ui/NumericTextField'
import { useToast } from '@/contexts/ToastContext'
import {
  EMPTY_SCHEDULE_FORM,
  scheduleFormErrors,
  scheduleFormToBody,
  scheduleToForm,
  vmOptionsFromSnapshots,
  type ScheduleFormState,
  type ScheduleVmOption,
} from '@/lib/backups/restoreDrills/schedules'
import { SCHEDULE_LIMITS, SCHEDULE_RESTORE_POINTS, type DrillSettings, type Schedule } from '@/lib/backups/restoreDrills/types'

import DrillTargetPicker, { SMALL_SELECT_SX, dataOf, getJson, type DrillTargetFill, type DrillTargetValue } from './DrillTargetPicker'

const P = 'backups.restoreDrills'
const S = `${P}.schedules`
const SCHEDULES_URL = '/api/v1/backups/restore-drills/schedules'

export interface PbsConnection { id: string; name?: string }

interface RestoreDrillScheduleDialogProps {
  /** null: a new schedule. */
  schedule: Schedule | null
  pbsConnections: PbsConnection[]
  onClose: () => void
  onSaved: (schedule: Schedule | null) => void
}

export default function RestoreDrillScheduleDialog({ schedule, pbsConnections, onClose, onSaved }: RestoreDrillScheduleDialogProps) {
  const t = useTranslations()
  const toast = useToast()
  const editing = !!schedule

  const [form, setForm] = useState<ScheduleFormState>(() => (schedule ? scheduleToForm(schedule) : { ...EMPTY_SCHEDULE_FORM, pbsId: pbsConnections[0]?.id || '' }))
  // Each answer is kept with the source it belongs to: a stale one reads as loading.
  const [datastoresOf, setDatastoresOf] = useState<{ pbsId: string; names: string[] } | null>(null)
  const [snapshotsOf, setSnapshotsOf] = useState<{ key: string; namespaces: string[]; vms: ScheduleVmOption[] } | null>(null)
  const snapshotsKey = form.pbsId && form.datastore ? `${form.pbsId}|${form.datastore}` : ''
  const datastores = form.pbsId && datastoresOf?.pbsId === form.pbsId ? datastoresOf.names : null
  const snapshots = snapshotsKey && snapshotsOf?.key === snapshotsKey ? snapshotsOf : null
  const [submitted, setSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const update = (patch: Partial<ScheduleFormState>) => {
    setForm(f => ({ ...f, ...patch }))
    setError(null)
  }
  const fillDefaults = (fill: DrillTargetFill) => setForm(f => {
    const patch = fill(f)
    return patch ? { ...f, ...patch } : f
  })

  // Isolation defaults of a new schedule come from the drill settings.
  useEffect(() => {
    if (editing) return
    let cancelled = false
    void (async () => {
      try {
        const s = await getJson<DrillSettings>('/api/v1/backups/restore-drills/settings')
        if (cancelled || !s) return
        setForm(f => ({
          ...f,
          networkMode: s.default_network_mode === 'bridge' && s.default_bridge ? 'bridge' : 'link_down',
          bridge: s.default_bridge || '',
        }))
      } catch { /* defaults stay */ }
    })()
    return () => { cancelled = true }
  }, [editing])

  // Datastores of the PBS.
  useEffect(() => {
    const pbsId = form.pbsId
    if (!pbsId) return
    let cancelled = false
    void (async () => {
      try {
        const json = await getJson<unknown>(`/api/v1/pbs/${encodeURIComponent(pbsId)}/datastores`)
        if (cancelled) return
        const names = dataOf<{ name?: string; store?: string }>(json)
          .map(d => String(d.name || d.store || ''))
          .filter(Boolean)
          .sort((a, b) => a.localeCompare(b))
        setDatastoresOf({ pbsId, names })
        // A stored datastore is kept even when the PBS does not list it now.
        setForm(f => (f.datastore ? f : { ...f, datastore: names[0] || '', namespace: '' }))
      } catch {
        if (!cancelled) setDatastoresOf({ pbsId, names: [] })
      }
    })()
    return () => { cancelled = true }
  }, [form.pbsId])

  // VM backups of the datastore: its namespaces and the VMs of each.
  useEffect(() => {
    if (!snapshotsKey) return
    const key = snapshotsKey
    let cancelled = false
    void (async () => {
      try {
        const params = new URLSearchParams({ datastore: form.datastore, type: 'vm', slim: '1', page: '1', pageSize: '100000' })
        const json = await getJson<{ data?: { backups?: unknown[] } }>(`/api/v1/pbs/${encodeURIComponent(form.pbsId)}/backups?${params}`)
        if (cancelled) return
        const options = vmOptionsFromSnapshots((json?.data?.backups ?? []) as Parameters<typeof vmOptionsFromSnapshots>[0])
        setSnapshotsOf({ key, ...options })
        // The root namespace by default, else the first one that holds VM backups;
        // a chosen or stored namespace is kept.
        setForm(f => (f.namespace || options.namespaces.length === 0 || options.namespaces.includes('') ? f : { ...f, namespace: options.namespaces[0] }))
      } catch {
        if (!cancelled) setSnapshotsOf({ key, namespaces: [], vms: [] })
      }
    })()
    return () => { cancelled = true }
    // snapshotsKey carries pbsId and datastore.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshotsKey])

  const namespaces = useMemo(() => {
    const list = snapshots?.namespaces ?? []
    return list.includes(form.namespace) ? list : [form.namespace, ...list]
  }, [snapshots, form.namespace])

  // VMs of the namespace, plus any selected VM that has no backup any more.
  const vmOptions = useMemo(() => {
    const own = (snapshots?.vms ?? []).filter(v => v.namespace === form.namespace)
    const known = new Set(own.map(v => v.vmid))
    const missing = form.vmids.filter(id => !known.has(id)).map(vmid => ({ vmid, name: '', namespace: form.namespace }))
    return [...own, ...missing].sort((a, b) => a.vmid - b.vmid)
  }, [snapshots, form.namespace, form.vmids])
  const selectedVms = vmOptions.filter(v => form.vmids.includes(v.vmid))

  const errors = scheduleFormErrors(form)
  const shown = submitted ? errors : {}
  const err = (k: keyof typeof errors) => (shown[k] ? t(shown[k] as string) : undefined)

  const save = async () => {
    setSubmitted(true)
    if (Object.keys(errors).length > 0) return
    setSaving(true)
    setError(null)
    try {
      const url = schedule ? `${SCHEDULES_URL}/${encodeURIComponent(schedule.id)}` : SCHEDULES_URL
      const res = await fetch(url, {
        method: schedule ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(scheduleFormToBody(form)),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(t(`${S}.form.saveError`, { error: json?.error || `HTTP ${res.status}` }))
        return
      }
      toast.success(t(editing ? `${S}.actions.saved` : `${S}.actions.created`))
      onSaved(json?.schedule ?? null)
      onClose()
    } catch (e: any) {
      setError(t(`${S}.form.saveError`, { error: e?.message || 'error' }))
    } finally {
      setSaving(false)
    }
  }

  const target: DrillTargetValue = { connId: form.connId, node: form.node, storage: form.storage, networkMode: form.networkMode, bridge: form.bridge }
  const pbsKnown = pbsConnections.some(p => p.id === form.pbsId)
  const datastoreList = datastores ?? []
  const datastoreOptions = datastoreList.includes(form.datastore) || !form.datastore ? datastoreList : [form.datastore, ...datastoreList]

  return (
    <Dialog open onClose={saving ? undefined : onClose} fullWidth maxWidth='md' aria-labelledby='drill-schedule-title'>
      <AppDialogTitle onClose={saving ? undefined : onClose} icon={<i className='ri-calendar-schedule-line' style={{ fontSize: 20 }} />}>
        <span id='drill-schedule-title'>{schedule ? t(`${S}.form.titleEdit`, { name: schedule.name }) : t(`${S}.form.titleNew`)}</span>
      </AppDialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.5}>
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
            <TextField
              size='small'
              label={t(`${S}.form.name`)}
              value={form.name}
              onChange={e => update({ name: e.target.value })}
              error={!!err('name')}
              helperText={err('name')}
              inputProps={{ maxLength: SCHEDULE_LIMITS.nameMax + 1 }}
              sx={{ flex: 1 }}
            />
            <FormControlLabel
              control={<Switch checked={form.enabled} onChange={(_e, v) => update({ enabled: v })} />}
              label={t(`${S}.form.enabled`)}
              sx={{ mt: 0.5 }}
            />
          </Box>

          <Box>
            <Typography variant='subtitle2' sx={{ mb: 1 }}>{t(`${S}.form.source`)}</Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, minmax(0, 1fr))' }, gap: 1.5 }}>
              <FormControl size='small' fullWidth error={!!err('source') && !form.pbsId}>
                <InputLabel id='drill-schedule-pbs'>{t(`${S}.form.pbs`)}</InputLabel>
                <Select labelId='drill-schedule-pbs' label={t(`${S}.form.pbs`)} value={pbsKnown ? form.pbsId : ''} sx={SMALL_SELECT_SX}
                  onChange={e => update({ pbsId: String(e.target.value), datastore: '', namespace: '', vmids: [] })}>
                  {pbsConnections.map(p => <MenuItem key={p.id} value={p.id}>{p.name || p.id}</MenuItem>)}
                </Select>
              </FormControl>
              <FormControl size='small' fullWidth disabled={!form.pbsId} error={!!err('source') && !form.datastore}>
                <InputLabel id='drill-schedule-datastore'>{t(`${S}.form.datastore`)}</InputLabel>
                <Select labelId='drill-schedule-datastore' label={t(`${S}.form.datastore`)} value={datastoreOptions.includes(form.datastore) ? form.datastore : ''} sx={SMALL_SELECT_SX}
                  onChange={e => update({ datastore: String(e.target.value), namespace: '', vmids: [] })}>
                  {datastoreOptions.map(d => <MenuItem key={d} value={d}>{d}</MenuItem>)}
                </Select>
              </FormControl>
              <FormControl size='small' fullWidth disabled={!form.datastore}>
                <InputLabel id='drill-schedule-namespace' shrink={!!form.datastore}>{t(`${S}.form.namespace`)}</InputLabel>
                {/* The root namespace is '': shown by name, never as an empty field. */}
                <Select labelId='drill-schedule-namespace' label={t(`${S}.form.namespace`)} value={form.namespace} sx={SMALL_SELECT_SX}
                  displayEmpty notched={!!form.datastore}
                  renderValue={v => (form.datastore ? v || t(`${S}.form.rootNamespace`) : '')}
                  onChange={e => update({ namespace: String(e.target.value), vmids: [] })}>
                  {namespaces.map(ns => <MenuItem key={ns || '(root)'} value={ns}>{ns || t(`${S}.form.rootNamespace`)}</MenuItem>)}
                </Select>
              </FormControl>
            </Box>
            {err('source') && <FormHelperText error>{err('source')}</FormHelperText>}
          </Box>

          <Box>
            <Typography variant='subtitle2'>{t(`${S}.form.scope`)}</Typography>
            <RadioGroup row value={form.scopeMode} onChange={e => update({ scopeMode: e.target.value === 'all' ? 'all' : 'vms' })}>
              <FormControlLabel value='vms' control={<Radio size='small' />} label={t(`${S}.form.scopeVms`)} />
              <FormControlLabel value='all' control={<Radio size='small' />} label={t(`${S}.form.scopeAll`)} />
            </RadioGroup>
            {form.scopeMode === 'vms' && (
              <Autocomplete
                multiple
                size='small'
                disableCloseOnSelect
                options={vmOptions}
                value={selectedVms}
                loading={!!form.datastore && snapshots === null}
                isOptionEqualToValue={(a, b) => a.vmid === b.vmid}
                getOptionLabel={o => (o.name ? `${o.vmid} ${o.name}` : String(o.vmid))}
                onChange={(_e, list) => update({ vmids: list.map(v => v.vmid) })}
                noOptionsText={t(`${S}.form.noVms`)}
                renderTags={(list, getTagProps) => list.map((o, index) => {
                  const { key, ...tagProps } = getTagProps({ index })
                  return <Chip key={key} size='small' label={o.name ? `${o.vmid} ${o.name}` : String(o.vmid)} {...tagProps} />
                })}
                renderInput={params => (
                  <TextField
                    {...params}
                    label={t(`${S}.form.vms`)}
                    placeholder={t(`${S}.form.vmsPlaceholder`)}
                    error={!!err('vmids')}
                    helperText={err('vmids')}
                  />
                )}
                sx={{ mt: 1 }}
              />
            )}
          </Box>

          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' }, gap: 1.5 }}>
            <FormControl size='small' fullWidth>
              <InputLabel id='drill-schedule-restore-point'>{t(`${S}.form.restorePoint`)}</InputLabel>
              <Select labelId='drill-schedule-restore-point' label={t(`${S}.form.restorePoint`)} value={form.restorePoint} sx={SMALL_SELECT_SX}
                onChange={e => update({ restorePoint: e.target.value === 'latest_verified' ? 'latest_verified' : 'latest' })}>
                {SCHEDULE_RESTORE_POINTS.map(r => <MenuItem key={r} value={r}>{t(`${S}.restorePoint.${r}`)}</MenuItem>)}
              </Select>
            </FormControl>
            <NumericTextField
              size='small'
              label={t(`${S}.form.vmsPerRun`)}
              value={form.vmsPerRun}
              fallback={1}
              min={SCHEDULE_LIMITS.vmsPerRun[0]}
              max={SCHEDULE_LIMITS.vmsPerRun[1]}
              onChange={v => update({ vmsPerRun: v })}
              error={!!err('vmsPerRun')}
              helperText={err('vmsPerRun') || t(`${S}.form.vmsPerRunHelp`)}
            />
          </Box>

          <DrillTargetPicker
            idPrefix='drill-schedule'
            pbsId={form.pbsId}
            datastore={form.datastore}
            namespace={form.namespace}
            value={target}
            onChange={update}
            onDefaults={fillDefaults}
            targetError={err('target')}
            bridgeError={err('bridge')}
          />

          <Box>
            <Typography variant='subtitle2' sx={{ mb: 1 }}>{t(`${S}.form.recurrence`)}</Typography>
            <BackupSchedulePicker value={form.calendar} onChange={(v: string) => update({ calendar: v })} structuredOnly />
            <Typography variant='caption' color={err('calendar') ? 'error' : 'text.secondary'} sx={{ display: 'block', mt: 0.5 }}>
              {err('calendar') || t(`${S}.form.calendarHint`)}
            </Typography>
          </Box>

          {error && <Alert severity='error'>{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 1.5 }}>
        <Button onClick={onClose} disabled={saving}>{t('common.cancel')}</Button>
        <Button variant='contained' onClick={() => void save()} disabled={saving}
          startIcon={saving ? <CircularProgress size={14} /> : <i className='ri-save-line' />}>
          {editing ? t(`${S}.form.save`) : t(`${S}.form.create`)}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
