'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

import { useLocale, useTranslations } from 'next-intl'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  FormControl,
  FormControlLabel,
  IconButton,
  InputAdornment,
  InputLabel,
  MenuItem,
  Radio,
  RadioGroup,
  Select,
  Switch,
  TablePagination,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { useTheme } from '@mui/material/styles'

import AppDialogTitle from '@/components/ui/AppDialogTitle'
import NumericTextField from '@/components/ui/NumericTextField'
import { useToast } from '@/contexts/ToastContext'
import { formatDateTime } from '@/lib/i18n/date'
import {
  COVERAGE_ALERTS_KEY,
  COVERAGE_GRACE_KEY,
  COVERAGE_TAG_KEY,
  MAX_GRACE_HOURS,
  normalizeExcludeTag,
  planAddGuestToJob,
} from '@/lib/backups/coverage'

const ALL = '__all__'
const PAGE_SIZES = [20, 50, 100]
const REASONS = ['no_job', 'not_selected', 'excluded', 'other_node', 'disabled_job']

// Guest, cluster, node, reason (takes what is left), action.
const ROW_COLUMNS = '260px 160px 140px minmax(0, 1fr) 32px'

// Same toolbar metrics as the rest of the page: a small Select is 38px and a
// small input 35.86px, so the filter row would not line up otherwise.
const SMALL_SELECT_SX = { '& .MuiInputBase-input.MuiSelect-select': { minHeight: '1.4375em', lineHeight: '1.4375em' } }

const GUEST_STATUS_COLORS = { running: '#4caf50', stopped: '#f44336', paused: '#ff9800', suspended: '#ff9800' }
const NODE_STATUS_COLORS = { online: '#4caf50', unknown: '#9e9e9e', maintenance: '#ff9800' }

const guestStatusColor = status => GUEST_STATUS_COLORS[status || ''] || '#616161'
const nodeStatusColor = status => (status ? NODE_STATUS_COLORS[status] || '#f44336' : '#9e9e9e')

/** Guest glyph: type icon with the status dot, as in every guest list of the product. */
function GuestGlyph({ type, status, dotBorder }) {
  return (
    <Box sx={{ position: 'relative', width: 16, height: 16, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <i className={type === 'lxc' ? 'ri-instance-line' : 'ri-computer-line'} style={{ fontSize: '0.9286rem', opacity: 0.8 }} />
      <Box sx={{ position: 'absolute', bottom: -1, right: -2, width: 6, height: 6, borderRadius: '50%', bgcolor: guestStatusColor(status), border: `1px solid ${dotBorder}` }} />
    </Box>
  )
}

/** Node glyph: the Proxmox logo with the status dot, as on every node row of the product. */
function NodeGlyph({ status, dark, dotBorder }) {
  return (
    <Box component='span' sx={{ position: 'relative', display: 'inline-flex', alignItems: 'center', width: 14, height: 14, flexShrink: 0 }}>
      <img src={dark ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'} alt='' width={14} height={14} style={{ opacity: 0.8 }} />
      <Box component='span' sx={{ position: 'absolute', bottom: -1, right: -2, width: 6, height: 6, borderRadius: '50%', bgcolor: nodeStatusColor(status), border: `1px solid ${dotBorder}` }} />
    </Box>
  )
}

/**
 * Settings of the coverage list: the grace period and the opt-out tag. They
 * live in the alert thresholds (the orchestrator reads them from there), so
 * the save re-sends the whole threshold set with only these two keys changed.
 */
function CoverageSettingsDialog({ onClose, onSaved }) {
  const t = useTranslations()
  const { showToast } = useToast()
  const [thresholds, setThresholds] = useState(null)
  const [grace, setGrace] = useState(24)
  const [tag, setTag] = useState('')
  const [alerts, setAlerts] = useState(false)
  const [saving, setSaving] = useState(false)

  // Mounted only while open, so every opening starts from a fresh read.
  useEffect(() => {
    let cancelled = false
    fetch('/api/v1/settings/alerts/thresholds')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(data => {
        if (cancelled) return
        setThresholds(data)
        setGrace(Number(data?.[COVERAGE_GRACE_KEY] ?? 24))
        setTag(String(data?.[COVERAGE_TAG_KEY] ?? ''))
        setAlerts(Number(data?.[COVERAGE_ALERTS_KEY]) > 0)
      })
      .catch(() => {
        if (!cancelled) {
          showToast(t('backups.coverage.saveError'), 'error')
          onClose()
        }
      })
    return () => { cancelled = true }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const tagValid = normalizeExcludeTag(tag) !== null

  const handleSave = async () => {
    setSaving(true)
    try {
      const r = await fetch('/api/v1/settings/alerts/thresholds', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...thresholds, [COVERAGE_GRACE_KEY]: grace, [COVERAGE_TAG_KEY]: tag.trim().toLowerCase(), [COVERAGE_ALERTS_KEY]: alerts ? 1 : 0 }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      // Run a coverage pass right away so the alerts follow the new settings
      // without waiting for the hourly task. Best effort: the settings are
      // saved either way, a failure here is only logged.
      fetch('/api/v1/orchestrator/alerts/backup-coverage/check', { method: 'POST' })
        .then(res => { if (!res.ok) console.warn('[backup coverage] immediate check not started:', res.status) })
        .catch(err => console.warn('[backup coverage] immediate check not started:', err))
      showToast(t('backups.coverage.saved'), 'success')
      onSaved()
      onClose()
    } catch {
      showToast(t('backups.coverage.saveError'), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onClose={onClose} maxWidth='sm' fullWidth>
      <AppDialogTitle onClose={onClose} icon={<i className='ri-settings-3-line' style={{ fontSize: 20 }} />}>
        {t('backups.coverage.settings')}
      </AppDialogTitle>
      <DialogContent>
        {!thresholds ? (
          <Box sx={{ py: 4, display: 'flex', justifyContent: 'center' }}><CircularProgress size={24} /></Box>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, pt: 2 }}>
            <NumericTextField
              size='small'
              type='number'
              label={t('backups.coverage.graceLabel')}
              value={grace}
              onChange={v => setGrace(Math.min(MAX_GRACE_HOURS, Math.max(0, Math.trunc(v))))}
              fallback={0}
              min={0}
              max={MAX_GRACE_HOURS}
              helperText={t('backups.coverage.graceHelp')}
              slotProps={{ htmlInput: { min: 0, max: MAX_GRACE_HOURS } }}
            />
            <TextField
              size='small'
              label={t('backups.coverage.tagLabel')}
              placeholder='no-backup'
              value={tag}
              onChange={e => setTag(e.target.value)}
              error={!tagValid}
              helperText={tagValid ? t('backups.coverage.tagHelp') : t('backups.coverage.tagInvalid')}
              slotProps={{ inputLabel: { shrink: true }, input: { sx: { fontFamily: 'monospace' } } }}
            />
            <Box>
              <FormControlLabel
                control={<Switch checked={alerts} onChange={e => setAlerts(e.target.checked)} />}
                label={t('backups.coverage.alertsLabel')}
              />
              <Typography variant='caption' color='text.secondary' sx={{ display: 'block', ml: 6.5 }}>
                {t('backups.coverage.alertsHelp')}
              </Typography>
            </Box>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button
          variant='contained'
          onClick={handleSave}
          disabled={!thresholds || !tagValid || saving}
          startIcon={saving ? <CircularProgress size={16} /> : <i className='ri-save-line' />}
        >
          {t('common.save')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

/** The /backup-jobs list entry back to the PVE fields planAddGuestToJob reads. */
function toVzdumpJob(job) {
  return {
    id: job.id,
    enabled: job.enabled ? 1 : 0,
    all: job.selectionMode === 'all' ? 1 : 0,
    exclude: (job.excludedVmids || []).join(','),
    vmid: (job.vmids || []).join(','),
    pool: job.pool || '',
    node: job.node || '',
  }
}

/**
 * Adds one uncovered guest to a backup job of its own cluster. Every job is
 * listed; the ones that cannot take the guest say why (pool, other node,
 * already selected), a disabled one warns that the guest stays uncovered
 * until it is enabled. Without any job, offers the page's job creation.
 */
function AddToJobDialog({ guest, onClose, onAdded, onCreateJob }) {
  const t = useTranslations()
  const { showToast } = useToast()
  const [jobs, setJobs] = useState(null)
  const [failed, setFailed] = useState(false)
  const [selected, setSelected] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/v1/connections/${encodeURIComponent(guest.connId)}/backup-jobs`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(json => {
        if (cancelled) return
        const list = (json?.data?.jobs || []).map(job => ({ job, plan: planAddGuestToJob(toVzdumpJob(job), guest) }))
        setJobs(list)
        const first = list.find(j => j.plan.ok && !j.plan.disabled) || list.find(j => j.plan.ok)
        if (first) setSelected(first.job.id)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => { cancelled = true }
  }, [guest])

  const chosen = jobs?.find(j => j.job.id === selected)

  const handleAdd = async () => {
    setSaving(true)
    try {
      const r = await fetch(
        `/api/v1/connections/${encodeURIComponent(guest.connId)}/backup-jobs/${encodeURIComponent(selected)}/guests`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vmid: guest.vmid }) }
      )
      const json = await r.json().catch(() => null)
      if (!r.ok) throw new Error(json?.error || `HTTP ${r.status}`)
      showToast(
        json?.data?.disabled
          ? t('backups.coverage.addedToDisabledJob', { name: guest.name, job: selected })
          : t('backups.coverage.addedToJob', { name: guest.name, job: selected }),
        json?.data?.disabled ? 'warning' : 'success'
      )
      onAdded()
      onClose()
    } catch (e) {
      showToast(t('backups.coverage.addError', { error: e?.message || '' }), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onClose={() => !saving && onClose()} maxWidth='sm' fullWidth>
      <AppDialogTitle onClose={() => !saving && onClose()} icon={<i className='ri-calendar-check-line' style={{ fontSize: 20 }} />}>
        {t('backups.coverage.addTitle', { name: guest.name, vmid: guest.vmid })}
      </AppDialogTitle>
      <DialogContent>
        {failed ? (
          <Alert severity='error'>{t('backups.coverage.jobsLoadError')}</Alert>
        ) : !jobs ? (
          <Box sx={{ py: 4, display: 'flex', justifyContent: 'center' }}><CircularProgress size={24} /></Box>
        ) : jobs.length === 0 ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-start', pt: 1 }}>
            <Typography variant='body2'>{t('backups.coverage.noJobOnCluster', { cluster: guest.connectionName || guest.connId })}</Typography>
            {onCreateJob && (
              <Button
                variant='outlined'
                startIcon={<i className='ri-add-line' />}
                onClick={() => { onCreateJob(guest); onClose() }}
              >
                {t('backups.coverage.createJob')}
              </Button>
            )}
          </Box>
        ) : (
          <RadioGroup value={selected} onChange={e => setSelected(e.target.value)} sx={{ gap: 1, pt: 1 }}>
            {jobs.map(({ job, plan }) => (
              <Box
                key={job.id}
                sx={{ border: '1px solid', borderColor: selected === job.id ? 'primary.main' : 'divider', borderRadius: 1, px: 1.5, py: 0.75, opacity: plan.ok ? 1 : 0.6 }}
              >
                <FormControlLabel
                  value={job.id}
                  disabled={!plan.ok}
                  control={<Radio size='small' />}
                  sx={{ m: 0, width: '100%', alignItems: 'flex-start', '& .MuiFormControlLabel-label': { minWidth: 0, flex: 1, pt: 0.75 } }}
                  label={
                    <Box sx={{ minWidth: 0 }}>
                      {/* PVE names jobs created without an id by a UUID: lead with the
                          comment, else what the job does, and keep the id as a tooltip. */}
                      <Typography variant='body2' title={job.id} sx={{ fontWeight: 600 }}>
                        {job.comment || `${job.storage} · ${job.schedule}`}
                        <Typography component='span' variant='caption' color='text.secondary' sx={{ ml: 1 }}>
                          {[job.comment ? `${job.schedule} · ${job.storage}` : '', job.node].filter(Boolean).join(' · ')}
                        </Typography>
                      </Typography>
                      <Typography variant='caption' color='text.secondary' sx={{ display: 'block' }}>
                        {plan.ok
                          ? t(job.selectionMode === 'all' ? 'backups.coverage.addWillUnexclude' : 'backups.coverage.addWillAppend')
                          : t(`backups.coverage.addRefused.${plan.reason}`, { node: job.node || '', pool: job.pool || '' })}
                      </Typography>
                      {plan.ok && plan.disabled && (
                        <Typography variant='caption' sx={{ display: 'block', color: 'warning.main' }}>
                          {t('backups.coverage.addDisabledWarning')}
                        </Typography>
                      )}
                    </Box>
                  }
                />
              </Box>
            ))}
          </RadioGroup>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>{t('common.cancel')}</Button>
        {jobs?.length > 0 && (
          <Button
            variant='contained'
            onClick={handleAdd}
            disabled={!chosen?.plan.ok || saving}
            startIcon={saving ? <CircularProgress size={16} /> : <i className='ri-add-line' />}
          >
            {t('backups.coverage.addConfirm')}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  )
}

/** Everything the row does not show, in the reason's tooltip. */
function ReasonDetails({ guest, t, locale }) {
  const line = (label, value) => (
    <Box sx={{ display: 'flex', gap: 1 }}>
      <Box component='span' sx={{ opacity: 0.7, width: 70, flexShrink: 0 }}>{label}</Box>
      <Box component='span' sx={{ wordBreak: 'break-word' }}>{value}</Box>
    </Box>
  )

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, py: 0.5 }}>
      <Box>{t(`backups.coverage.hints.${guest.reason}`)}</Box>
      {guest.jobIds?.length > 0 && line(t('backups.coverage.detailJobs'), guest.jobIds.join(', '))}
      {line(t('backups.coverage.detailPool'), guest.pool || t('backups.coverage.detailNone'))}
      {line(t('backups.coverage.detailTags'), guest.tags?.length ? guest.tags.join(', ') : t('backups.coverage.detailNone'))}
      {line(t('backups.coverage.detailCreated'), guest.createdAt ? formatDateTime(new Date(guest.createdAt * 1000), locale) : t('backups.coverage.detailUnknown'))}
    </Box>
  )
}

/**
 * Guests covered by no PVE backup job (roadmap#48): one line per guest with
 * the reason (its tooltip carries the hint and the guest's details) and, for
 * a user who may edit backup jobs, an action that adds it to a job.
 */
export default function BackupCoverageCard({ canEditSettings = false, canAddToJob = false, onCreateJob, refreshKey = 0 }) {
  const t = useTranslations()
  const locale = useLocale()
  const theme = useTheme()
  const dark = theme.palette.mode === 'dark'
  const dotBorder = theme.palette.background.paper

  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [expandedCard, setExpandedCard] = useState(false)
  const [addingGuest, setAddingGuest] = useState(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [cluster, setCluster] = useState(ALL)
  const [reason, setReason] = useState(ALL)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(PAGE_SIZES[0])

  const [reloadKey, setReloadKey] = useState(0)

  const reload = useCallback(() => {
    setLoading(true)
    setError(null)
    setReloadKey(k => k + 1)
  }, [])

  useEffect(() => {
    let cancelled = false
    fetch('/api/v1/backups/coverage')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(json => {
        if (!cancelled) setData(json?.data && !Array.isArray(json.data) ? json.data : { guests: [], summary: null, errors: [] })
      })
      .catch(e => {
        if (!cancelled) setError(e?.message || 'error')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [reloadKey, refreshKey])

  const guests = useMemo(() => data?.guests || [], [data])
  const summary = data?.summary
  const settings = data?.settings
  const errors = data?.errors || []

  const clusters = useMemo(() => {
    const m = new Map()
    for (const g of guests) if (!m.has(g.connId)) m.set(g.connId, g.connectionName || g.connId)
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [guests])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return guests.filter(g =>
      (cluster === ALL || g.connId === cluster) &&
      (reason === ALL || g.reason === reason) &&
      (!q || `${g.name} ${g.vmid} ${g.node}`.toLowerCase().includes(q))
    )
  }, [guests, cluster, reason, search])

  const pageCount = Math.max(1, Math.ceil(filtered.length / rowsPerPage))
  const safePage = Math.min(page, pageCount - 1)
  const visible = filtered.slice(safePage * rowsPerPage, (safePage + 1) * rowsPerPage)

  const resetPage = setter => v => {
    setter(v)
    setPage(0)
  }

  const ignoredParts = []
  if (summary?.ignored?.template) ignoredParts.push(t('backups.coverage.ignoredTemplates', { count: summary.ignored.template }))
  if (summary?.ignored?.tag) ignoredParts.push(t('backups.coverage.ignoredTag', { count: summary.ignored.tag, tag: settings?.excludeTag || '' }))
  if (summary?.ignored?.grace) ignoredParts.push(t('backups.coverage.ignoredGrace', { count: summary.ignored.grace, hours: settings?.graceHours ?? 0 }))

  const uncoveredCount = summary?.uncovered ?? guests.length

  return (
    <Card variant='outlined'>
      <CardContent sx={{ '&:last-child': { pb: expandedCard ? 2 : 1 } }}>
        <Box
          sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', gap: 1 }}
          onClick={() => setExpandedCard(v => !v)}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
            <i className='ri-shield-check-line' style={{ fontSize: 22, color: theme.palette.primary.main }} />
            <Typography variant='h6'>{t('backups.coverage.title')}</Typography>
            {!loading && summary && (
              <Typography variant='caption' color='text.secondary' sx={{ whiteSpace: 'nowrap' }}>
                {t('backups.coverage.coveredOf', { covered: summary.covered, total: summary.total })}
              </Typography>
            )}
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }} onClick={e => e.stopPropagation()}>
            {!loading && summary && (
              <Chip
                size='small'
                color={uncoveredCount > 0 ? 'warning' : 'success'}
                label={uncoveredCount > 0 ? t('backups.coverage.uncoveredCount', { count: uncoveredCount }) : t('backups.coverage.allCoveredShort')}
                sx={{ height: 22, fontWeight: 600, mr: 0.5 }}
              />
            )}
            <Tooltip title={t('common.refresh')}>
              <span>
                <IconButton size='small' onClick={reload} disabled={loading} aria-label={t('common.refresh')}>
                  {loading ? <CircularProgress size={16} /> : <i className='ri-refresh-line' style={{ fontSize: 18 }} />}
                </IconButton>
              </span>
            </Tooltip>
            {canEditSettings && (
              <Tooltip title={t('backups.coverage.settings')}>
                <IconButton size='small' onClick={() => setSettingsOpen(true)} aria-label={t('backups.coverage.settings')}>
                  <i className='ri-settings-3-line' style={{ fontSize: 18 }} />
                </IconButton>
              </Tooltip>
            )}
            <IconButton size='small' onClick={() => setExpandedCard(v => !v)}>
              <i className={expandedCard ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} style={{ fontSize: 20 }} />
            </IconButton>
          </Box>
        </Box>

        <Collapse in={expandedCard}>
          <Box sx={{ mt: 2 }}>
            {error && <Alert severity='error' sx={{ mb: 2 }}>{t('backups.coverage.loadError')}</Alert>}

            {errors.length > 0 && (
              <Alert severity='warning' sx={{ mb: 2 }}>
                {t('backups.coverage.errorsTitle', { clusters: errors.map(e => e.connectionName || e.connId).join(', ') })}
              </Alert>
            )}

            {loading && !data ? (
              <Box sx={{ py: 3, display: 'flex', justifyContent: 'center' }}><CircularProgress size={24} /></Box>
            ) : guests.length === 0 ? (
              !error && (
                <Box sx={{ py: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1 }}>
                  <i className='ri-checkbox-circle-line' style={{ fontSize: 18, color: theme.palette.success.main }} />
                  <Typography variant='body2' color='text.secondary'>{t('backups.coverage.allCovered')}</Typography>
                </Box>
              )
            ) : (
              <>
                <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', mb: 2 }}>
                  {clusters.length > 1 && (
                    <FormControl size='small' sx={{ minWidth: 180 }}>
                      <InputLabel>{t('backups.coverage.colCluster')}</InputLabel>
                      <Select value={cluster} label={t('backups.coverage.colCluster')} onChange={e => resetPage(setCluster)(e.target.value)} sx={SMALL_SELECT_SX}>
                        <MenuItem value={ALL}>{t('backups.coverage.allClusters')}</MenuItem>
                        {clusters.map(([id, name]) => <MenuItem key={id} value={id}>{name}</MenuItem>)}
                      </Select>
                    </FormControl>
                  )}
                  <FormControl size='small' sx={{ minWidth: 220 }}>
                    <InputLabel>{t('backups.coverage.colReason')}</InputLabel>
                    <Select value={reason} label={t('backups.coverage.colReason')} onChange={e => resetPage(setReason)(e.target.value)} sx={SMALL_SELECT_SX}>
                      <MenuItem value={ALL}>{t('backups.coverage.allReasons')}</MenuItem>
                      {REASONS.map(r => <MenuItem key={r} value={r}>{t(`backups.coverage.reasons.${r}`)}</MenuItem>)}
                    </Select>
                  </FormControl>
                  <TextField
                    size='small'
                    value={search}
                    onChange={e => resetPage(setSearch)(e.target.value)}
                    placeholder={t('backups.coverage.search')}
                    sx={{ minWidth: 220, flex: 1 }}
                    slotProps={{
                      htmlInput: { 'aria-label': t('backups.coverage.search') },
                      input: {
                        startAdornment: (
                          <InputAdornment position='start'>
                            <i className='ri-search-line' style={{ fontSize: 18, opacity: 0.6 }} />
                          </InputAdornment>
                        ),
                      },
                    }}
                  />
                </Box>

                <Box sx={{ display: 'grid', gridTemplateColumns: ROW_COLUMNS, columnGap: 2, px: 2, pb: 0.5 }}>
                  {['colGuest', 'colCluster', 'colNode', 'colReason'].map(k => (
                    <Typography key={k} variant='caption' color='text.secondary' sx={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                      {t(`backups.coverage.${k}`)}
                    </Typography>
                  ))}
                  <span />
                </Box>

                {filtered.length === 0 ? (
                  <Typography variant='body2' color='text.secondary' sx={{ py: 2, textAlign: 'center' }}>
                    {t('backups.coverage.noMatch')}
                  </Typography>
                ) : (
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    {visible.map(g => {
                      const key = `${g.connId}:${g.vmid}`
                      return (
                        <Box
                          key={key}
                          sx={{
                            display: 'grid',
                            gridTemplateColumns: ROW_COLUMNS,
                            columnGap: 2,
                            alignItems: 'center',
                            py: 0.75,
                            px: 2,
                            borderRadius: 1,
                            whiteSpace: 'nowrap',
                            '&:hover': { bgcolor: 'action.hover' },
                          }}
                        >
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
                            <GuestGlyph type={g.type} status={g.status} dotBorder={dotBorder} />
                            <Typography title={g.name} sx={{ fontWeight: 600, fontSize: '0.875rem', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {g.name}
                            </Typography>
                            <Typography variant='caption' color='text.secondary' sx={{ flexShrink: 0 }}>({g.vmid})</Typography>
                          </Box>

                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
                            <i className='ri-server-line' style={{ fontSize: '0.9286rem', flexShrink: 0 }} />
                            <Typography variant='body2' title={g.connectionName} sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {g.connectionName || g.connId}
                            </Typography>
                          </Box>

                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
                            <NodeGlyph status={g.nodeStatus} dark={dark} dotBorder={dotBorder} />
                            <Typography variant='body2' title={g.node} sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {g.node}
                            </Typography>
                          </Box>

                          <Tooltip title={<ReasonDetails guest={g} t={t} locale={locale} />} placement='bottom-start'>
                            <Typography variant='body2' sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'help' }}>
                              {t(`backups.coverage.reasons.${g.reason}`)}
                            </Typography>
                          </Tooltip>

                          <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                            {canAddToJob && (
                              <Tooltip title={t('backups.coverage.addToJob')}>
                                <IconButton size='small' onClick={() => setAddingGuest(g)} aria-label={t('backups.coverage.addToJob')}>
                                  <i className='ri-calendar-check-line' style={{ fontSize: 18 }} />
                                </IconButton>
                              </Tooltip>
                            )}
                          </Box>
                        </Box>
                      )
                    })}
                  </Box>
                )}

                {filtered.length > PAGE_SIZES[0] && (
                  <TablePagination
                    component='div'
                    count={filtered.length}
                    page={safePage}
                    onPageChange={(_, p) => setPage(p)}
                    rowsPerPage={rowsPerPage}
                    onRowsPerPageChange={e => {
                      setRowsPerPage(Number.parseInt(e.target.value, 10))
                      setPage(0)
                    }}
                    rowsPerPageOptions={PAGE_SIZES}
                    labelRowsPerPage={t('common.rowsPerPage')}
                    labelDisplayedRows={({ from, to, count }) => t('backups.coverage.displayedRows', { from, to, count })}
                  />
                )}
              </>
            )}

            {ignoredParts.length > 0 && (
              <Typography variant='caption' color='text.secondary' sx={{ display: 'block', mt: 1.5 }}>
                {t('backups.coverage.notListed', { items: ignoredParts.join(' · ') })}
              </Typography>
            )}
          </Box>
        </Collapse>
      </CardContent>

      {canEditSettings && settingsOpen && (
        <CoverageSettingsDialog onClose={() => setSettingsOpen(false)} onSaved={reload} />
      )}

      {canAddToJob && addingGuest && (
        <AddToJobDialog guest={addingGuest} onClose={() => setAddingGuest(null)} onAdded={reload} onCreateJob={onCreateJob} />
      )}
    </Card>
  )
}
