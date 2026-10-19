'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'

import { useRouter } from 'next/navigation'

import { useTranslations } from 'next-intl'
import { Alert, Box, Button, CircularProgress, MenuItem, Popover, TextField, Typography, useTheme } from '@mui/material'

import { useLicense } from '@/contexts/LicenseContext'
import PagedRows from '@/components/ui/PagedRows'
import { formatBandwidth } from '@/lib/metrics/diskIo'

import ConnectionFilter from './ConnectionFilter'
import { widgetColors } from './themeColors'
import { mapTimeRange } from './timeRangeUtils'

// ─── Settings ────────────────────────────────────────────────────────────────
// The widget ranks guests either from the live dashboard payload (CPU / RAM,
// what it has always done) or from the orchestrator's stored collections over
// a window (#1129): the four IO counters, the dashboard's range or a custom
// one. Its choices live in the widget settings; the pre-#1129 localStorage
// key only seeds the metric of a widget that has none yet.
export const METRICS = ['cpu', 'ram', 'diskread', 'diskwrite', 'netin', 'netout']
const PERIODS = ['live', 'dashboard', 'custom']
const AGGS = ['avg', 'max']
const LIMITS = [10, 20, 50]
const STORAGE_KEY = 'dashboard-top-consumers-mode'
const LIVE_WINDOW_MS = 5 * 60 * 1000
const REFRESH_MS = 60 * 1000

// The blue of the other widgets' neutral figures: an IO rate has no threshold
// to be judged against, so every IO bar wears it.
const IO_ACCENT = '#3b82f6'
const STATUS_COLORS = { running: '#4caf50', stopped: '#f44336', paused: '#ff9800', suspended: '#ff9800' }
const getStatusColor = (status) => STATUS_COLORS[status] || '#616161'
const SMALL_SELECT_SX = { '& .MuiInputBase-input.MuiSelect-select': { minHeight: '1.4375em', lineHeight: '1.4375em' } }

const isPercentMetric = (metric) => metric === 'cpu' || metric === 'ram'

function getBarColor(value) {
  if (value >= 80) return '#ef4444'
  if (value >= 50) return '#f59e0b'

  return '#22c55e'
}

/** The widget settings with every field validated, `storage` being the localStorage to read the pre-#1129 metric from. */
export function resolveSettings(config, storage) {
  const s = config?.settings || {}
  let metric = METRICS.includes(s.metric) ? s.metric : null

  if (!metric) {
    let stored = null

    try {
      stored = storage?.getItem(STORAGE_KEY) ?? null
    } catch {
      stored = null
    }
    metric = stored === 'ram' ? 'ram' : 'cpu'
  }
  const limit = Number(s.limit)

  return {
    metric,
    period: PERIODS.includes(s.period) ? s.period : 'live',
    agg: AGGS.includes(s.agg) ? s.agg : 'avg',
    limit: LIMITS.includes(limit) ? limit : 10,
    customFrom: typeof s.customFrom === 'string' ? s.customFrom : null,
    customTo: typeof s.customTo === 'string' ? s.customTo : null,
    selectedConnections: Array.isArray(s.selectedConnections) ? s.selectedConnections.filter(id => typeof id === 'string') : [],
  }
}

/**
 * Whether these settings call the history route at all: live CPU / RAM read
 * the dashboard payload instead, and a custom period needs a valid range.
 */
export function hasUsableWindow({ metric, period, customFrom, customTo }) {
  if (period === 'live') return !isPercentMetric(metric)
  if (period !== 'custom') return true
  if (!customFrom || !customTo) return false
  const from = new Date(customFrom)
  const to = new Date(customTo)

  return !Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime()) && from < to
}

/**
 * The query string of the history route for these settings, or null when the
 * widget has no window to ask for (see hasUsableWindow). Live IO rates are the
 * last five minutes averaged; the dashboard period follows the global range
 * picker.
 */
export function buildTopConsumersQuery(settings, timeRange, now = Date.now()) {
  const { metric, period, agg, limit, customFrom, customTo, selectedConnections = [] } = settings

  if (!hasUsableWindow(settings)) return null
  let from
  let to
  let effectiveAgg = agg

  if (period === 'live') {
    to = new Date(now)
    from = new Date(now - LIVE_WINDOW_MS)
    effectiveAgg = 'avg'
  } else if (period === 'custom') {
    from = new Date(customFrom)
    to = new Date(customTo)
  } else {
    to = new Date(now)
    from = new Date(now - mapTimeRange(timeRange).hours * 3600 * 1000)
  }

  const params = new URLSearchParams({ metric, agg: effectiveAgg, from: from.toISOString(), to: to.toISOString(), limit: String(limit) })

  if (selectedConnections.length > 0) params.set('connections', selectedConnections.join(','))

  return params.toString()
}

/** A ranked value for the row: one decimal percent, or a human readable byte rate. */
export function formatTopValue(value, unit) {
  const n = Number(value)

  if (!Number.isFinite(n)) return '-'
  if (unit === 'bytes_per_second') return formatBandwidth(n)

  return `${Math.round(Math.min(n, 100) * 10) / 10}%`
}

const pad2 = (n) => String(n).padStart(2, '0')
const dayPart = (d) => `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}`
const timePart = (d) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`

/** The custom window as the header shows it: "19/10 07:00 → 09:00", the second date only when it differs. */
export function formatCustomRange(from, to) {
  const a = new Date(from)
  const b = new Date(to)

  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return ''
  const sameDay = a.toDateString() === b.toDateString()

  return `${dayPart(a)} ${timePart(a)} → ${sameDay ? '' : `${dayPart(b)} `}${timePart(b)}`
}

/** Connections the dashboard payload lets this user see (`nodes` is RBAC-filtered, `clusters` only lends names). */
export function listConnections(data) {
  const names = new Map()

  for (const n of data?.nodes || []) {
    const id = n.connectionId || n.connId

    if (id && !names.has(id)) names.set(id, n.connection || n.connName || id)
  }
  for (const cl of data?.clusters || []) {
    if (names.has(cl.id) && names.get(cl.id) === cl.id && cl.name) names.set(cl.id, cl.name)
  }

  return [...names].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
}

// A datetime-local field is read by the browser as local time, so its value
// is built from the local getters (same trap as MetricsRangeSelector).
const toInputValue = (iso) => {
  const d = new Date(iso)

  if (Number.isNaN(d.getTime())) return ''

  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${timePart(d)}`
}

const fromInputValue = (value) => {
  const ms = Date.parse(value || '')

  return Number.isNaN(ms) ? null : new Date(ms).toISOString()
}

const formatSince = (iso) => new Date(iso).toLocaleString([], { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

// ─── Pieces ──────────────────────────────────────────────────────────────────
function ToggleGroup({ options, value, onChange, c }) {
  return (
    <Box sx={{ display: 'flex', gap: 0.5 }}>
      {options.map(o => (
        <Box
          key={o.value}
          onClick={() => onChange(o.value)}
          sx={{
            px: 1.5,
            py: 0.5,
            borderRadius: 1,
            cursor: 'pointer',
            fontSize: '0.7857rem',
            fontWeight: 600,
            letterSpacing: 0.5,
            textTransform: 'uppercase',
            userSelect: 'none',
            whiteSpace: 'nowrap',
            transition: 'all 0.15s',
            color: value === o.value ? c.textPrimary : c.textMuted,
            bgcolor: value === o.value ? c.surfaceActive : 'transparent',
            '&:hover': {
              color: c.textPrimary,
              bgcolor: value === o.value ? c.surfaceHighlight : c.borderLight
            }
          }}
        >
          {o.label}
        </Box>
      ))}
    </Box>
  )
}

function ConsumerRow({ vm, unit, scale, c, onOpen }) {
  const value = Number(vm.value) || 0
  const percent = unit === 'percent'
  const width = percent ? Math.max(0, Math.min(100, value)) : (scale > 0 ? Math.max(2, Math.round((value / scale) * 100)) : 0)
  const color = percent ? getBarColor(value) : IO_ACCENT

  return (
    <Box
      data-testid='top-consumers-row'
      onClick={() => vm.connId && onOpen(vm)}
      sx={{
        display: 'flex', alignItems: 'center', gap: 1, px: 0.5, py: 0.5, borderRadius: 1,
        cursor: vm.connId ? 'pointer' : 'default', transition: 'background 0.15s',
        '&:hover': vm.connId ? { bgcolor: c.surfaceHover } : {}
      }}
    >
      <Box sx={{ position: 'relative', width: 16, height: 16, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <i className={vm.type === 'lxc' ? 'ri-instance-line' : 'ri-computer-line'} style={{ fontSize: '0.9286rem', color: c.textSecondary }} />
        <Box sx={{ position: 'absolute', bottom: -1, right: -2, width: 6, height: 6, borderRadius: '50%', bgcolor: getStatusColor(vm.status), border: `1px solid ${c.dotBorder}` }} />
      </Box>
      <Box sx={{ minWidth: 0, flex: '0 1 40%', display: 'flex', alignItems: 'baseline', gap: 0.5, overflow: 'hidden' }}>
        <Typography noWrap sx={{ minWidth: 0, fontSize: '0.7857rem', fontWeight: 600, color: c.textPrimary }}>
          {vm.name || `VM ${vm.vmid}`}
        </Typography>
        <Typography sx={{ fontSize: '0.6429rem', color: c.textFaint, flexShrink: 0 }}>#{vm.vmid}</Typography>
      </Box>
      <Box sx={{ flex: 1, height: 4, borderRadius: 2, bgcolor: c.surfaceSubtle, overflow: 'hidden' }}>
        <Box sx={{ width: `${width}%`, height: '100%', borderRadius: 2, bgcolor: color, transition: 'width 0.4s ease' }} />
      </Box>
      <Typography sx={{ fontSize: '0.7857rem', fontWeight: 600, color: percent ? color : c.textPrimary, minWidth: 56, textAlign: 'right', flexShrink: 0 }}>
        {formatTopValue(value, unit)}
      </Typography>
    </Box>
  )
}

function Caption({ children }) {
  return (
    <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', px: 1 }}>
      <Typography variant='caption' sx={{ opacity: 0.65, textAlign: 'center' }}>{children}</Typography>
    </Box>
  )
}

/** The from / to fields of the custom period, applied as one window. */
function CustomRangePopover({ anchorEl, draft, onDraftChange, onApply, onClose, t }) {
  const fromIso = fromInputValue(draft.from)
  const toIso = fromInputValue(draft.to)
  const valid = Boolean(fromIso && toIso && fromIso < toIso)

  return (
    <Popover
      open={Boolean(anchorEl)}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      transformOrigin={{ vertical: 'top', horizontal: 'left' }}
    >
      <Box sx={{ p: 1.5, display: 'flex', flexDirection: 'column', gap: 1.25, width: 250 }}>
        <TextField
          size='small'
          type='datetime-local'
          label={t('dashboard.widgetTopConsumers.from')}
          value={draft.from}
          onChange={e => onDraftChange({ ...draft, from: e.target.value })}
          slotProps={{ inputLabel: { shrink: true } }}
        />
        <TextField
          size='small'
          type='datetime-local'
          label={t('dashboard.widgetTopConsumers.to')}
          value={draft.to}
          onChange={e => onDraftChange({ ...draft, to: e.target.value })}
          slotProps={{ inputLabel: { shrink: true } }}
        />
        {!valid && draft.from && draft.to && (
          <Typography variant='caption' color='error'>{t('dashboard.widgetTopConsumers.invalidRange')}</Typography>
        )}
        <Button size='small' variant='contained' disabled={!valid} onClick={() => onApply(fromIso, toIso)}>
          {t('common.apply')}
        </Button>
      </Box>
    </Popover>
  )
}

// ─── Main Widget ─────────────────────────────────────────────────────────────
function TopConsumersWidget({ data, loading, config, onUpdateSettings, timeRange }) {
  const t = useTranslations()
  const theme = useTheme()
  const router = useRouter()
  const isDark = theme.palette.mode === 'dark'
  const c = widgetColors(isDark)
  const { isEnterprise } = useLicense()

  const [settings, setSettings] = useState(() => resolveSettings(config, typeof window === 'undefined' ? null : window.localStorage))
  const [history, setHistory] = useState({ key: null, data: null, error: null })
  const [tick, setTick] = useState(0)
  const [rangeAnchor, setRangeAnchor] = useState(null)
  const [draft, setDraft] = useState({ from: '', to: '' })
  const periodRef = useRef(null)

  const update = (patch) => {
    setSettings(s => ({ ...s, ...patch }))
    if (onUpdateSettings) onUpdateSettings(patch)
  }

  // Community keeps the live CPU / RAM ranking it has always had, whatever a
  // previous Enterprise licence left in the settings.
  const metric = isEnterprise || isPercentMetric(settings.metric) ? settings.metric : 'cpu'
  const period = isEnterprise ? settings.period : 'live'
  const usesPayload = period === 'live' && isPercentMetric(metric)
  const connectionsKey = settings.selectedConnections.join(',')

  const handleMetricChange = (m) => {
    if (isPercentMetric(m)) {
      try {
        localStorage.setItem(STORAGE_KEY, m)
      } catch {
        // Storage unavailable: the widget settings still carry the choice.
      }
    }
    update({ metric: m })
  }

  const openRangePopover = () => {
    const hours = mapTimeRange(timeRange).hours
    const now = Date.now()

    setDraft({
      from: toInputValue(settings.customFrom || new Date(now - hours * 3600 * 1000).toISOString()),
      to: toInputValue(settings.customTo || new Date(now).toISOString()),
    })
    setRangeAnchor(periodRef.current)
  }

  const handlePeriodChange = (p) => {
    update({ period: p })
    if (p === 'custom' && !(settings.customFrom && settings.customTo)) openRangePopover()
  }

  const applyRange = (customFrom, customTo) => {
    update({ period: 'custom', customFrom, customTo })
    setRangeAnchor(null)
  }

  // What the history is asked for, as one key: null while the widget reads the
  // payload or has no usable window yet (custom period without a range). Each
  // `tick` is a new key, hence a new request whose window ends now.
  const { agg, limit, customFrom, customTo } = settings
  const requestKey = hasUsableWindow({ metric, period, customFrom, customTo })
    ? [metric, period, agg, limit, customFrom, customTo, connectionsKey, timeRange, tick].join('|')
    : null

  // One request per key, aborted when the key changes again.
  useEffect(() => {
    if (!requestKey) return undefined
    const query = buildTopConsumersQuery({
      metric, period, agg, limit, customFrom, customTo, selectedConnections: connectionsKey ? connectionsKey.split(',') : [],
    }, timeRange, Date.now())
    const controller = new AbortController()

    fetch(`/api/v1/dashboard/top-consumers?${query}`, { signal: controller.signal })
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)

        return res.json()
      })
      .then(body => setHistory({ key: requestKey, data: body, error: null }))
      .catch(err => {
        if (err?.name !== 'AbortError') setHistory({ key: requestKey, data: null, error: err })
      })

    return () => controller.abort()
  }, [requestKey, metric, period, agg, limit, customFrom, customTo, connectionsKey, timeRange])

  // The minute refresh, for the windows that follow the clock.
  useEffect(() => {
    if (usesPayload || period === 'custom') return undefined
    const id = setInterval(() => setTick(n => n + 1), REFRESH_MS)

    return () => clearInterval(id)
  }, [usesPayload, period])

  // The rows of the previous answer stay on screen while the next one loads
  // (the minute refresh must not blink); an error only counts once answered.
  const answered = Boolean(requestKey) && history.key === requestKey
  const historyData = requestKey ? history.data : null
  const historyLoading = Boolean(requestKey) && !answered
  const historyError = answered ? history.error : null

  const connections = useMemo(() => listConnections(data), [data])

  const payloadRows = useMemo(() => {
    const list = (metric === 'ram' ? data?.topRam : data?.topCpu) || []
    const wanted = new Set(settings.selectedConnections)

    // The payload only lists running guests: a row without a status is one.
    return list
      .filter(vm => wanted.size === 0 || wanted.has(vm.connId))
      .map(vm => ({ ...vm, status: vm.status || 'running' }))
  }, [data, metric, settings.selectedConnections])

  const rows = useMemo(() => (usesPayload ? payloadRows : (historyData?.items || [])), [usesPayload, payloadRows, historyData])
  const unit = usesPayload || !historyData?.unit ? (isPercentMetric(metric) ? 'percent' : 'bytes_per_second') : historyData.unit
  const scale = useMemo(() => rows.reduce((m, r) => Math.max(m, Number(r.value) || 0), 0), [rows])

  const openGuest = (vm) => {
    router.push(`/infrastructure/inventory?vmid=${vm.vmid}&connId=${vm.connId}&node=${vm.node}&type=${vm.type || 'qemu'}`)
  }

  const historySince = !usesPayload && historyData?.firstSampleAt && historyData?.from
    && new Date(historyData.firstSampleAt).getTime() > new Date(historyData.from).getTime()
    ? historyData.firstSampleAt
    : null

  if (!isEnterprise && (data?.topCpu || []).length === 0 && (data?.topRam || []).length === 0) {
    return (
      <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2 }}>
        <Alert severity='info' sx={{ width: '100%' }}>{t('common.noData')}</Alert>
      </Box>
    )
  }

  const renderBody = () => {
    if (!usesPayload && historyLoading && !historyData) {
      return (
        <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <CircularProgress size={20} />
        </Box>
      )
    }
    if (!usesPayload && historyData?.available === false) return <Caption>{t('dashboard.widgetTopConsumers.needsOrchestrator')}</Caption>
    if (!usesPayload && historyError) return <Caption>{t('dashboard.widgetTopConsumers.loadFailed')}</Caption>
    if (rows.length === 0) {
      if (usesPayload && loading) {
        return (
          <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <CircularProgress size={20} />
          </Box>
        )
      }

      return <Caption>{t('common.noData')}</Caption>
    }

    return (
      <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 0.25 }}>
        <PagedRows items={rows} testId='top-consumers-pager'>
          {(vm) => <ConsumerRow key={`${vm.connId || ''}:${vm.node || ''}:${vm.vmid}`} vm={vm} unit={unit} scale={scale} c={c} onOpen={openGuest} />}
        </PagedRows>
      </Box>
    )
  }

  return (
    <Box
      sx={{
        bgcolor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)',
        border: '1px solid',
        borderColor: c.borderLight,
        borderRadius: 'var(--proxcenter-card-radius)',
        p: 1.5,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        transition: 'border-color 0.2s, box-shadow 0.2s',
        '&:hover': {
          borderColor: c.borderHover,
          boxShadow: isDark ? '0 4px 24px rgba(0,0,0,0.2)' : '0 4px 24px rgba(0,0,0,0.06)'
        }
      }}
    >
      {isEnterprise ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 1, flexWrap: 'wrap' }}>
          <TextField
            select
            size='small'
            value={metric}
            onChange={e => handleMetricChange(e.target.value)}
            sx={{ minWidth: 124, ...SMALL_SELECT_SX }}
            slotProps={{ htmlInput: { 'aria-label': t('dashboard.widgetTopConsumers.metric') } }}
          >
            {METRICS.map(m => <MenuItem key={m} value={m} dense>{t(`dashboard.widgetTopConsumers.metrics.${m}`)}</MenuItem>)}
          </TextField>
          <TextField
            select
            size='small'
            ref={periodRef}
            value={period}
            onChange={e => handlePeriodChange(e.target.value)}
            sx={{ minWidth: 124, ...SMALL_SELECT_SX }}
            slotProps={{ htmlInput: { 'aria-label': t('dashboard.widgetTopConsumers.period') } }}
          >
            <MenuItem value='live' dense>{t('dashboard.widgetTopConsumers.live')}</MenuItem>
            <MenuItem value='dashboard' dense>{t('dashboard.widgetTopConsumers.dashboardRange', { range: mapTimeRange(timeRange).label })}</MenuItem>
            <MenuItem value='custom' dense>{t('dashboard.widgetTopConsumers.custom')}</MenuItem>
          </TextField>
          {period === 'custom' && (
            <Box
              onClick={openRangePopover}
              data-testid='top-consumers-range'
              sx={{
                px: 1, py: 0.5, borderRadius: 1, cursor: 'pointer', fontSize: '0.7857rem', fontWeight: 600, whiteSpace: 'nowrap',
                color: c.textPrimary, bgcolor: c.surfaceActive, '&:hover': { bgcolor: c.surfaceHighlight }
              }}
            >
              {settings.customFrom && settings.customTo ? formatCustomRange(settings.customFrom, settings.customTo) : t('dashboard.widgetTopConsumers.custom')}
            </Box>
          )}
          {period !== 'live' && (
            <ToggleGroup
              options={[{ value: 'avg', label: t('dashboard.widgetTopConsumers.avg') }, { value: 'max', label: t('dashboard.widgetTopConsumers.peak') }]}
              value={settings.agg}
              onChange={agg => update({ agg })}
              c={c}
            />
          )}
          {/* The payload only ever carries ten guests: the size is a history choice. */}
          {!usesPayload && (
            <ToggleGroup options={LIMITS.map(n => ({ value: n, label: String(n) }))} value={settings.limit} onChange={limit => update({ limit })} c={c} />
          )}
          {connections.length > 1 && (
            <Box sx={{ ml: 'auto' }}>
              <ConnectionFilter connections={connections} selected={settings.selectedConnections} onChange={next => update({ selectedConnections: next })} t={t} />
            </Box>
          )}
          <CustomRangePopover anchorEl={rangeAnchor} draft={draft} onDraftChange={setDraft} onApply={applyRange} onClose={() => setRangeAnchor(null)} t={t} />
        </Box>
      ) : (
        <Box sx={{ mb: 1.5 }}>
          <ToggleGroup
            options={[{ value: 'cpu', label: t('monitoring.cpu') }, { value: 'ram', label: t('monitoring.memory') }]}
            value={metric}
            onChange={handleMetricChange}
            c={c}
          />
        </Box>
      )}

      {historySince && (
        <Typography variant='caption' sx={{ display: 'block', fontSize: '0.6786rem', color: c.textMuted, mb: 0.5 }}>
          {t('dashboard.widgetTopConsumers.historySince', { date: formatSince(historySince) })}
        </Typography>
      )}

      {renderBody()}
    </Box>
  )
}

export default React.memo(TopConsumersWidget)
