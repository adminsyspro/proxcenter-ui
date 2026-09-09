'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Slider,
  Snackbar,
  Switch,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material'

import NumericTextField from '@/components/ui/NumericTextField'

const DEFAULTS = {
  cpu_warning: 80,
  cpu_critical: 90,
  memory_warning: 80,
  memory_critical: 90,
  storage_warning: 80,
  storage_critical: 90,
  snapshot_max_age_days: 7,
  snapshot_exclude_pattern: '',
  recovery_margin: 5,
  recovery_confirmations: 3,
  osd_latency_warning: 0,
  osd_latency_critical: 250,
  disk_latency_warning: 0,
  disk_latency_critical: 100,
  disk_latency_window_minutes: 5,
  disk_latency_retention_days: 7,
  disk_latency_collection: 1,
  metrics_interval_seconds: 60,
  replication_rpo_grace_percent: 25,
  replication_failure_alerts: 1,
}

// The tab grew to eleven cards: one row per family stopped reading as a
// screen. Each family is now a sub-tab; the state and the Save button stay
// above them, so saving always sends every family, seen or not.
const SECTIONS = [
  { id: 'resources', label: 'alerts.resourceUsage', icon: 'ri-bar-chart-box-line' },
  { id: 'performance', label: 'alerts.performanceReplication', icon: 'ri-timer-flash-line' },
  { id: 'snapshots', label: 'alerts.snapshots', icon: 'ri-camera-line' },
  { id: 'collection', label: 'alerts.collectionRecovery', icon: 'ri-timer-line' },
]

export default function AlertThresholdsTab() {
  const t = useTranslations()
  const [thresholds, setThresholds] = useState(DEFAULTS)
  const [section, setSection] = useState(SECTIONS[0].id)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [snackbar, setSnackbar] = useState({ open: false, severity: 'success', message: '' })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const r = await fetch('/api/v1/settings/alerts/thresholds')
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const data = await r.json()
        if (!cancelled) setThresholds({ ...DEFAULTS, ...data })
      } catch (e) {
        if (!cancelled) setSnackbar({ open: true, severity: 'error', message: e.message || 'Failed to load' })
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const handleSave = async () => {
    setSaving(true)
    try {
      const r = await fetch('/api/v1/settings/alerts/thresholds', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(thresholds),
      })
      if (!r.ok) {
        const data = await r.json().catch(() => null)
        throw new Error(data?.error || `HTTP ${r.status}`)
      }
      const saved = await r.json()
      setThresholds({ ...DEFAULTS, ...saved })
      setSnackbar({ open: true, severity: 'success', message: t('settings.alertThresholds.saved') })
    } catch (e) {
      setSnackbar({ open: true, severity: 'error', message: e.message || t('settings.alertThresholds.saveError') })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <Box sx={{ p: 4, display: 'flex', justifyContent: 'center' }}>
        <CircularProgress size={24} />
      </Box>
    )
  }

  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
        <Box>
          <Typography variant='h6' fontWeight={700}>{t('settings.alertThresholds.title')}</Typography>
          <Typography variant='body2' color='text.secondary' sx={{ mt: 0.5 }}>
            {t('settings.alertThresholds.description')}
          </Typography>
        </Box>
        <Button
          variant='contained'
          onClick={handleSave}
          disabled={saving}
          startIcon={saving ? <CircularProgress size={16} /> : <i className='ri-save-line' />}
        >
          {t('common.save')}
        </Button>
      </Box>

      <Tabs
        value={section}
        onChange={(_, v) => setSection(v)}
        variant='scrollable'
        scrollButtons='auto'
        sx={{ borderBottom: 1, borderColor: 'divider', mt: 2, mb: 3 }}
      >
        {SECTIONS.map((sec) => (
          <Tab
            key={sec.id}
            value={sec.id}
            label={t(sec.label)}
            icon={<i className={sec.icon} style={{ fontSize: 16 }} />}
            iconPosition='start'
            sx={{ minHeight: 48, textTransform: 'none' }}
          />
        ))}
      </Tabs>

      {section === 'resources' && (
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr 1fr' }, gap: 2 }}>
        <ThresholdCard
          icon='ri-cpu-line'
          label={t('alerts.cpu')}
          warning={thresholds.cpu_warning}
          critical={thresholds.cpu_critical}
          onChange={(w, c) => setThresholds(th => ({ ...th, cpu_warning: w, cpu_critical: c }))}
          tWarning={t('alerts.warning')}
          tCritical={t('alerts.critical')}
        />
        <ThresholdCard
          icon='ri-ram-line'
          label={t('alerts.memory')}
          warning={thresholds.memory_warning}
          critical={thresholds.memory_critical}
          onChange={(w, c) => setThresholds(th => ({ ...th, memory_warning: w, memory_critical: c }))}
          tWarning={t('alerts.warning')}
          tCritical={t('alerts.critical')}
        />
        <ThresholdCard
          icon='ri-hard-drive-2-line'
          label={t('alerts.storage')}
          warning={thresholds.storage_warning}
          critical={thresholds.storage_critical}
          onChange={(w, c) => setThresholds(th => ({ ...th, storage_warning: w, storage_critical: c }))}
          tWarning={t('alerts.warning')}
          tCritical={t('alerts.critical')}
        />
      </Box>
      )}

      {section === 'performance' && (
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr', xl: 'repeat(4, 1fr)' }, gap: 2 }}>
        <ThresholdCard
          icon='ri-speed-line'
          label={t('alerts.osdLatency')}
          description={t('alerts.osdLatencyDesc')}
          warning={thresholds.osd_latency_warning || 100}
          critical={thresholds.osd_latency_critical}
          onChange={(w, c) => setThresholds(th => ({ ...th, osd_latency_warning: w, osd_latency_critical: c }))}
          tWarning={t('alerts.warning')}
          tCritical={t('alerts.critical')}
          min={10}
          max={Math.max(500, thresholds.osd_latency_critical || 0)}
          step={5}
          unit=' ms'
          enabled={thresholds.osd_latency_warning > 0}
          onToggle={(checked) => setThresholds(th => (checked
            ? { ...th, osd_latency_warning: 100, osd_latency_critical: Math.max(100, th.osd_latency_critical) }
            : { ...th, osd_latency_warning: 0 }
          ))}
          tDisabled={t('alerts.snapshotDisabled')}
        />

        <ThresholdCard
          icon='ri-timer-flash-line'
          label={t('alerts.diskLatency')}
          description={t('alerts.diskLatencyDesc')}
          warning={thresholds.disk_latency_warning || 30}
          critical={thresholds.disk_latency_critical}
          onChange={(w, c) => setThresholds(th => ({ ...th, disk_latency_warning: w, disk_latency_critical: c }))}
          tWarning={t('alerts.warning')}
          tCritical={t('alerts.critical')}
          min={1}
          max={Math.max(300, thresholds.disk_latency_critical || 0)}
          step={1}
          unit=' ms'
          enabled={thresholds.disk_latency_warning > 0}
          onToggle={(checked) => setThresholds(th => (checked
            ? { ...th, disk_latency_warning: 30, disk_latency_critical: Math.max(30, th.disk_latency_critical || 100) }
            : { ...th, disk_latency_warning: 0 }
          ))}
          tDisabled={t('alerts.snapshotDisabled')}
          footer={(
            <Box sx={{ mt: 2, pt: 1.5, borderTop: '1px solid', borderColor: 'divider' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
                <Typography variant='caption' color='text.secondary'>{t('alerts.diskLatencyCollection')}</Typography>
                <Switch
                  size='small'
                  checked={thresholds.disk_latency_collection > 0}
                  onChange={(_, checked) => setThresholds(th => ({ ...th, disk_latency_collection: checked ? 1 : 0 }))}
                  // slotProps.input replaces MUI's own input props, role included.
                  slotProps={{ input: { role: 'switch', 'aria-label': t('alerts.diskLatencyCollection') } }}
                />
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 1 }}>
                <NumericTextField
                  type='number'
                  size='small'
                  value={thresholds.disk_latency_retention_days}
                  onChange={(days) => setThresholds(th => ({ ...th, disk_latency_retention_days: Math.min(365, Math.max(1, Math.trunc(days))) }))}
                  fallback={7}
                  min={1}
                  slotProps={{ htmlInput: { min: 1, max: 365 } }}
                  sx={{ width: 80 }}
                  disabled={!(thresholds.disk_latency_collection > 0)}
                />
                <Typography variant='body2' color={thresholds.disk_latency_collection > 0 ? 'text.secondary' : 'text.disabled'}>{t('alerts.diskLatencyRetention')}</Typography>
              </Box>
            </Box>
          )}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 1 }}>
            <NumericTextField
              type='number'
              size='small'
              value={thresholds.disk_latency_window_minutes}
              onChange={(minutes) => setThresholds(th => ({ ...th, disk_latency_window_minutes: Math.min(60, Math.max(1, Math.trunc(minutes))) }))}
              fallback={5}
              min={1}
              slotProps={{ htmlInput: { min: 1, max: 60 } }}
              sx={{ width: 80 }}
            />
            <Typography variant='body2' color='text.secondary'>{t('alerts.diskLatencyWindow')}</Typography>
          </Box>
        </ThresholdCard>

        <SingleThresholdCard
          icon='ri-timer-flash-line'
          label={t('alerts.replicationRpo')}
          description={t('alerts.replicationRpoDesc')}
          value={thresholds.replication_rpo_grace_percent || 25}
          onChange={(pct) => setThresholds(th => ({ ...th, replication_rpo_grace_percent: pct }))}
          min={5}
          max={Math.max(200, thresholds.replication_rpo_grace_percent || 0)}
          step={5}
          enabled={thresholds.replication_rpo_grace_percent > 0}
          onToggle={(checked) => setThresholds(th => ({ ...th, replication_rpo_grace_percent: checked ? 25 : 0 }))}
          tDisabled={t('alerts.snapshotDisabled')}
        />

        <ToggleCard
          icon='ri-file-copy-2-line'
          label={t('alerts.replicationFailures')}
          description={t('alerts.replicationFailuresDesc')}
          detail={t('alerts.replicationFailuresEscalation')}
          enabled={thresholds.replication_failure_alerts > 0}
          onToggle={(checked) => setThresholds(th => ({ ...th, replication_failure_alerts: checked ? 1 : 0 }))}
          tDisabled={t('alerts.snapshotDisabled')}
        />
      </Box>
      )}

      {section === 'snapshots' && (
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr 1fr' }, gap: 2 }}>
        <SingleThresholdCard
          icon='ri-camera-line'
          label={t('alerts.snapshotAge')}
          description={t('alerts.snapshotAgeDesc')}
          value={thresholds.snapshot_max_age_days || 7}
          onChange={(days) => setThresholds(th => ({ ...th, snapshot_max_age_days: days }))}
          min={1}
          step={1}
          /* The ceiling follows any value already stored above it: the field
             used to accept up to 365 days, and a fixed max would let MUI clamp
             such a setting down the first time the card rendered. */
          max={Math.max(90, thresholds.snapshot_max_age_days || 0)}
          formatValue={(v) => `${v} ${t('alerts.snapshotDays')}`}
          markFormat={(v) => `${v}`}
          enabled={thresholds.snapshot_max_age_days > 0}
          onToggle={(checked) => setThresholds(th => ({ ...th, snapshot_max_age_days: checked ? 7 : 0 }))}
          tDisabled={t('alerts.snapshotDisabled')}
        >
          {/* Veeam keeps a replica's restore points as PVE snapshots on a VM
              suffixed "-replica" (discussion #875): the operator cannot act on
              them, so they can be left out by name. RE2 on the Go side, hence
              the (?i) example rather than a case-insensitive toggle. */}
          <TextField
            size='small'
            fullWidth
            label={t('alerts.snapshotExclude')}
            placeholder='(?i)replica'
            value={thresholds.snapshot_exclude_pattern || ''}
            onChange={(e) => setThresholds(th => ({ ...th, snapshot_exclude_pattern: e.target.value }))}
            helperText={t('alerts.snapshotExcludeDesc')}
            slotProps={{ inputLabel: { shrink: true }, input: { sx: { fontFamily: 'monospace' } } }}
            sx={{ mt: 1.5 }}
          />
        </SingleThresholdCard>
      </Box>
      )}

      {section === 'collection' && (
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr 1fr' }, gap: 2 }}>
        <MetricsIntervalCard
          seconds={thresholds.metrics_interval_seconds}
          confirmations={thresholds.recovery_confirmations}
          onChange={(seconds) => setThresholds(th => ({ ...th, metrics_interval_seconds: seconds }))}
          t={t}
        />

        <Card variant='outlined' sx={{ borderRadius: 2 }}>
          <CardContent sx={{ p: 2.5, '&:last-child': { pb: 2.5 } }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
              <i className='ri-heart-pulse-line' style={{ fontSize: 18, opacity: 0.6 }} />
              <Typography variant='subtitle2' fontWeight={700}>{t('alerts.recoveryTitle')}</Typography>
            </Box>
            <Typography variant='caption' color='text.secondary'>{t('alerts.recoveryDesc')}</Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 2 }}>
              <NumericTextField
                type='number'
                size='small'
                value={thresholds.recovery_margin}
                onChange={(points) => setThresholds(th => ({ ...th, recovery_margin: Math.min(50, Math.max(0, points)) }))}
                fallback={0}
                min={0}
                slotProps={{ htmlInput: { min: 0, max: 50 } }}
                sx={{ width: 80 }}
              />
              <Typography variant='body2' color='text.secondary'>{t('alerts.recoveryMargin')}</Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 1.5 }}>
              <NumericTextField
                type='number'
                size='small'
                value={thresholds.recovery_confirmations}
                onChange={(checks) => setThresholds(th => ({ ...th, recovery_confirmations: Math.min(10, Math.max(1, Math.trunc(checks))) }))}
                fallback={1}
                min={1}
                slotProps={{ htmlInput: { min: 1, max: 10 } }}
                sx={{ width: 80 }}
              />
              <Typography variant='body2' color='text.secondary'>{t('alerts.recoveryConfirmations')}</Typography>
            </Box>
          </CardContent>
        </Card>
      </Box>
      )}

      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar(s => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert severity={snackbar.severity} onClose={() => setSnackbar(s => ({ ...s, open: false }))}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  )
}

// Edge marks would otherwise be centred on the thumb and clipped by the card.
const edgeMarkSx = {
  mt: 2,
  '& .MuiSlider-markLabel[data-index="0"]': { left: '6% !important' },
  '& .MuiSlider-markLabel[data-index="2"]': { left: '94% !important' },
}

// The orchestrator accepts 30 s to 10 min (alerts.MetricsInterval on the Go
// side). A slider rather than a free field: the bounds are the control itself,
// nothing to type outside them, and the 30-second step matches what the
// cadence can meaningfully be.
const MIN_INTERVAL_SECONDS = 30
const MAX_INTERVAL_SECONDS = 600
const INTERVAL_STEP_SECONDS = 30
const INTERVAL_MARKS = [MIN_INTERVAL_SECONDS, 300, MAX_INTERVAL_SECONDS]

/** "30 s", "2 min", "2 min 30 s": a duration the way an operator says it. */
export function formatSeconds(seconds) {
  if (seconds < 60) return `${seconds} s`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60

  return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} s`
}

/** How long the recovery confirmations take at a cadence, e.g. "3 min" or "90 s". */
export function formatCalm(seconds, confirmations) {
  return formatSeconds(Math.max(1, confirmations || 1) * seconds)
}

/**
 * The collection cadence of the orchestrator. The caption below the slider
 * translates it into what the operator feels, the calm required before an
 * alert resolves, since the recovery confirmations count collections.
 */
function MetricsIntervalCard({ seconds, confirmations, onChange, t }) {
  return (
    <SingleThresholdCard
      icon='ri-timer-line'
      label={t('alerts.metricsInterval')}
      description={t('alerts.metricsIntervalDesc')}
      value={seconds}
      onChange={onChange}
      min={MIN_INTERVAL_SECONDS}
      max={MAX_INTERVAL_SECONDS}
      step={INTERVAL_STEP_SECONDS}
      marks={INTERVAL_MARKS}
      formatValue={formatSeconds}
      ariaLabel={t('alerts.metricsInterval')}
      enabled
    >
      <Typography variant='caption' color='text.secondary' display='block' sx={{ mt: 1 }}>
        {t('alerts.metricsIntervalHelp', { count: confirmations, duration: formatCalm(seconds, confirmations) })}
      </Typography>
    </SingleThresholdCard>
  )
}

function CardShell({ icon, label, enabled, onToggle, children }) {
  return (
    <Card variant='outlined' sx={{ borderRadius: 2 }}>
      <CardContent sx={{ p: 2.5, '&:last-child': { pb: 2.5 } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <i className={icon} style={{ fontSize: 18, opacity: 0.6 }} />
            <Typography variant='subtitle2' fontWeight={700}>{label}</Typography>
          </Box>
          {onToggle ? <Switch size='small' checked={enabled} onChange={(_, checked) => onToggle(checked)} /> : null}
        </Box>
        {children}
      </CardContent>
    </Card>
  )
}

/**
 * Two-thumb warning/critical card. Defaults to the percentage scale the
 * resource cards have always used; the Ceph latency card passes a millisecond
 * scale so every threshold on the tab is set the same way, by dragging.
 *
 * `onToggle` is optional: a card that can be switched off renders the disabled
 * caption in place of its slider, exactly like the stale-snapshot card.
 * `children` render under the slider while the card is enabled, for a setting
 * that qualifies the two thresholds (the disk latency window, #881). `footer`
 * renders whatever the toggle says, for settings that outlive the alert (the
 * latency collection switch and its history retention).
 */
function ThresholdCard({
  icon, label, description, warning, critical, onChange, tWarning, tCritical,
  min = 50, max = 100, step = 1, unit = '%', marks,
  enabled = true, onToggle, tDisabled, children, footer,
}) {
  const format = (v) => `${v}${unit}`
  const scale = marks || [
    { value: min, label: format(min) },
    { value: Math.round((min + max) / 2), label: format(Math.round((min + max) / 2)) },
    { value: max, label: format(max) },
  ]

  return (
    <CardShell icon={icon} label={label} enabled={enabled} onToggle={onToggle}>
      <CardDescription text={description} enabled={enabled} />
      {enabled ? (
        <>
          <Typography variant='caption' color='text.secondary' display='block' sx={{ mt: description ? 0.5 : 0 }}>
            {tWarning}: {format(warning)} · {tCritical}: {format(critical)}
          </Typography>
          <Slider
            value={[warning, critical]}
            onChange={(_, v) => { const [w, c] = v; onChange(w, c) }}
            valueLabelDisplay='auto'
            valueLabelFormat={format}
            min={min}
            max={max}
            step={step}
            marks={scale}
            disableSwap
            sx={edgeMarkSx}
          />
          {children}
        </>
      ) : (
        <DisabledCaption text={tDisabled} />
      )}
      {footer}
    </CardShell>
  )
}

/**
 * What a card measures, in one line. Kept visible when the card is switched
 * off, in the disabled colour: the operator deciding whether to enable a check
 * needs to know what it does, and a card reduced to "Disabled" reads as broken
 * next to its enabled neighbours.
 */
function CardDescription({ text, enabled }) {
  if (!text) return null

  return (
    <Typography variant='caption' color={enabled ? 'text.secondary' : 'text.disabled'} display='block'>
      {text}
    </Typography>
  )
}

function DisabledCaption({ text }) {
  return <Typography variant='body2' color='text.disabled' sx={{ mt: 1.5 }}>{text}</Typography>
}

/**
 * Single-thumb variant, for a setting that has no critical tier of its own.
 *
 * `markFormat` exists because a long unit reads well on the value line but
 * overflows the three mark labels under the track: "7 days" above, bare
 * numbers below.
 */
function SingleThresholdCard({
  icon, label, description, value, onChange,
  min, max, step = 1, unit = '%', formatValue, markFormat, marks, ariaLabel,
  enabled, onToggle, tDisabled, children,
}) {
  const format = formatValue || ((v) => `${v}${unit}`)
  const mark = markFormat || format
  const mid = Math.round((min + max) / 2)
  // `marks` names the values worth a label when the midpoint is not one of them
  // (315 s on a 30 s..10 min scale); the default keeps the three-mark scale.
  const scale = (marks || [min, mid, max]).map((v) => ({ value: v, label: mark(v) }))

  return (
    <CardShell icon={icon} label={label} enabled={enabled} onToggle={onToggle}>
      <CardDescription text={description} enabled={enabled} />
      {enabled ? (
        <>
          <Typography variant='caption' color='text.secondary' display='block' sx={{ mt: 0.5 }}>
            {format(value)}
          </Typography>
          <Slider
            value={value}
            onChange={(_, v) => onChange(v)}
            valueLabelDisplay='auto'
            valueLabelFormat={format}
            min={min}
            max={max}
            step={step}
            marks={scale}
            aria-label={ariaLabel}
            sx={edgeMarkSx}
          />
          {children}
        </>
      ) : (
        <DisabledCaption text={tDisabled} />
      )}
    </CardShell>
  )
}

/** On/off only, for a condition that is binary and has nothing to tune. */
function ToggleCard({ icon, label, description, detail, enabled, onToggle, tDisabled }) {
  return (
    <CardShell icon={icon} label={label} enabled={enabled} onToggle={onToggle}>
      <CardDescription text={description} enabled={enabled} />
      <Typography variant='body2' color={enabled ? 'text.secondary' : 'text.disabled'} sx={{ mt: 1.5 }}>
        {enabled ? detail : tDisabled}
      </Typography>
    </CardShell>
  )
}
