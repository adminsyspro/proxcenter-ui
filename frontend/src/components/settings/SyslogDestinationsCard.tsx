'use client'

// Syslog / SIEM destinations of the audit log (issue #184), the body of the
// Syslog / SIEM settings tab. Storage and routes are this app's own: the audit
// log is written by Next, not by the orchestrator.

import { useState } from 'react'
import useSWR from 'swr'
import { useTranslations } from 'next-intl'

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
  FormHelperText,
  IconButton,
  InputLabel,
  MenuItem,
  OutlinedInput,
  Select,
  Skeleton,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'

import AppDialogTitle from '@/components/ui/AppDialogTitle'
import NumericTextField from '@/components/ui/NumericTextField'
import {
  AUDIT_CATEGORIES,
  MAX_SYSLOG_DESTINATIONS,
  SYSLOG_FACILITIES,
  SYSLOG_FORMATS,
  SYSLOG_FRAMINGS,
  SYSLOG_TRANSPORTS,
  defaultSyslogPort,
  type SyslogDestination,
  type SyslogDestinationStatus,
  type SyslogFormat,
  type SyslogFraming,
  type SyslogTransport,
} from '@/lib/syslog/types'

const API = '/api/v1/settings/syslog'

// A small MUI Select renders 38 px against 35.9 px for a small TextField; this
// pins both to the same line height so a row of fields sits level.
const SMALL_SELECT_SX = {
  '& .MuiInputBase-input.MuiSelect-select': { minHeight: '1.4375em', lineHeight: '1.4375em' },
} as const

type Payload = {
  destinations: SyslogDestination[]
  status: Record<string, SyslogDestinationStatus>
  limits?: { maxDestinations: number }
}

type TestResult = { ok: boolean; error?: string; message?: string }

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init)
  const text = await r.text()
  let json: any = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    // not JSON
  }
  if (!r.ok) throw new Error(json?.error || text || `HTTP ${r.status}`)
  return json as T
}

const fetcher = (url: string) => fetchJson<Payload>(url)

function newDestination(): SyslogDestination {
  return {
    id: '',
    name: '',
    enabled: true,
    host: '',
    port: defaultSyslogPort('udp'),
    transport: 'udp',
    format: 'rfc5424',
    framing: 'newline',
    facility: 13,
    categories: [],
    tls: { verify: true, ca: '', serverName: '' },
  }
}

type Health = 'disabled' | 'idle' | 'ok' | 'error'

function healthOf(dest: SyslogDestination, st?: SyslogDestinationStatus): Health {
  if (!dest.enabled) return 'disabled'
  if (!st) return 'idle'
  if (st.lastErrorAt && (!st.lastSentAt || st.lastErrorAt > st.lastSentAt)) return 'error'
  if (st.sent > 0) return 'ok'
  return 'idle'
}

const HEALTH_COLOR: Record<Health, string> = {
  disabled: 'text.disabled',
  idle: 'action.disabled',
  ok: 'success.main',
  error: 'error.main',
}

function isStream(transport: SyslogTransport) {
  return transport !== 'udp'
}

export default function SyslogDestinationsCard() {
  const t = useTranslations('settings.syslog')
  const tc = useTranslations('common')
  const { data, error: loadError, isLoading, mutate } = useSWR<Payload>(API, fetcher, { refreshInterval: 15_000 })

  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState<SyslogDestination | null>(null)
  const [deleting, setDeleting] = useState<SyslogDestination | null>(null)

  const destinations = data?.destinations ?? []
  const status = data?.status ?? {}
  const max = data?.limits?.maxDestinations ?? MAX_SYSLOG_DESTINATIONS

  const categoryLabel = (c: string) => t(`categories.${c}` as any)
  const formatLabel = (f: SyslogFormat) => t(`formats.${f}`)

  const save = async (next: SyslogDestination[]): Promise<boolean> => {
    setSaving(true)
    setMessage(null)
    try {
      const res = await fetchJson<Payload>(API, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ destinations: next }),
      })
      await mutate(res, { revalidate: false })
      setMessage({ type: 'success', text: t('saved') })
      return true
    } catch (err: any) {
      setMessage({ type: 'error', text: `${t('saveError')} ${err.message}` })
      return false
    } finally {
      setSaving(false)
    }
  }

  const upsert = async (dest: SyslogDestination) => {
    const exists = dest.id && destinations.some(d => d.id === dest.id)
    const next = exists ? destinations.map(d => (d.id === dest.id ? dest : d)) : [...destinations, dest]
    if (await save(next)) setEditing(null)
  }

  const toggle = (dest: SyslogDestination, enabled: boolean) =>
    save(destinations.map(d => (d.id === dest.id ? { ...d, enabled } : d)))

  const remove = async (dest: SyslogDestination) => {
    if (await save(destinations.filter(d => d.id !== dest.id))) setDeleting(null)
  }

  const activityText = (dest: SyslogDestination, st?: SyslogDestinationStatus) => {
    if (!dest.enabled) return tc('disabled')
    if (!st || (st.sent === 0 && !st.lastError)) return t('neverSent')
    const parts: string[] = []
    if (healthOf(dest, st) === 'error' && st.lastError) {
      parts.push(t('lastError', { error: st.lastError.length > 80 ? `${st.lastError.slice(0, 79)}…` : st.lastError }))
    } else if (st.lastSentAt) {
      parts.push(t('lastSent', { time: new Date(st.lastSentAt).toLocaleString() }))
    }
    parts.push(t('sentCount', { count: st.sent }))
    if (st.dropped > 0) parts.push(t('droppedCount', { count: st.dropped }))
    return parts.join(' · ')
  }

  return (
    <Card variant='outlined'>
      <CardContent>
        <Stack direction='row' alignItems='flex-start' spacing={2} sx={{ mb: 2 }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant='subtitle1' fontWeight={600}>
              {t('destinations')}
            </Typography>
          </Box>
          <Tooltip title={destinations.length >= max ? t('limitReached', { max }) : ''}>
            <span>
              <Button
                variant='contained'
                size='small'
                startIcon={<i className='ri-add-line' />}
                disabled={isLoading || Boolean(loadError) || destinations.length >= max}
                onClick={() => setEditing(newDestination())}
              >
                {t('add')}
              </Button>
            </span>
          </Tooltip>
        </Stack>

        {loadError && (
          <Alert severity='error' sx={{ mb: 2 }}>
            {t('loadError')} {String(loadError.message || '')}
          </Alert>
        )}

        {message && (
          <Alert severity={message.type} sx={{ mb: 2 }} onClose={() => setMessage(null)}>
            {message.text}
          </Alert>
        )}

        {isLoading && (
          <Stack spacing={1}>
            <Skeleton variant='rounded' height={40} />
            <Skeleton variant='rounded' height={40} />
          </Stack>
        )}

        {!isLoading && !loadError && destinations.length === 0 && (
          <Typography variant='body2' color='text.secondary'>
            {t('empty')}
          </Typography>
        )}

        {!isLoading && destinations.length > 0 && (
          <Table size='small'>
            <TableHead>
              <TableRow>
                <TableCell padding='checkbox' />
                <TableCell>{t('columns.name')}</TableCell>
                <TableCell>{t('columns.target')}</TableCell>
                <TableCell>{t('columns.format')}</TableCell>
                <TableCell>{t('columns.categories')}</TableCell>
                <TableCell>{t('columns.activity')}</TableCell>
                <TableCell align='right'>{tc('actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {destinations.map(dest => {
                const st = status[dest.id]
                const health = healthOf(dest, st)
                return (
                  <TableRow key={dest.id} hover>
                    <TableCell padding='checkbox'>
                      <Tooltip title={activityText(dest, st)}>
                        <Box
                          sx={{
                            width: 10,
                            height: 10,
                            borderRadius: '50%',
                            bgcolor: HEALTH_COLOR[health],
                            mx: 'auto',
                          }}
                        />
                      </Tooltip>
                    </TableCell>
                    <TableCell sx={{ maxWidth: 200 }}>
                      <Typography variant='body2' fontWeight={500} noWrap>
                        {dest.name}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Stack direction='row' spacing={1} alignItems='center'>
                        <Typography variant='body2' noWrap>
                          {dest.host}:{dest.port}
                        </Typography>
                        <Chip size='small' variant='outlined' label={dest.transport.toUpperCase()} />
                      </Stack>
                    </TableCell>
                    <TableCell>
                      <Chip size='small' label={formatLabel(dest.format)} />
                    </TableCell>
                    <TableCell>
                      <Typography variant='body2' noWrap>
                        {dest.categories.length === 0
                          ? t('allCategories')
                          : t('categoriesCount', { count: dest.categories.length })}
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ maxWidth: 260 }}>
                      <Typography variant='caption' color={health === 'error' ? 'error.main' : 'text.secondary'} noWrap component='div'>
                        {activityText(dest, st)}
                      </Typography>
                    </TableCell>
                    <TableCell align='right' sx={{ whiteSpace: 'nowrap' }}>
                      <Tooltip title={dest.enabled ? tc('enabled') : tc('disabled')}>
                        <Switch size='small' checked={dest.enabled} disabled={saving} onChange={e => toggle(dest, e.target.checked)} />
                      </Tooltip>
                      <Tooltip title={tc('edit')}>
                        <IconButton size='small' onClick={() => setEditing(dest)}>
                          <i className='ri-pencil-line' />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title={tc('delete')}>
                        <IconButton size='small' color='error' onClick={() => setDeleting(dest)}>
                          <i className='ri-delete-bin-line' />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>

      {editing && (
        <DestinationDialog
          initial={editing}
          saving={saving}
          onCancel={() => setEditing(null)}
          onSave={upsert}
          categoryLabel={categoryLabel}
        />
      )}

      <Dialog open={Boolean(deleting)} onClose={() => setDeleting(null)} maxWidth='xs' fullWidth>
        <AppDialogTitle onClose={() => setDeleting(null)} icon={<i className='ri-delete-bin-line' />}>
          {t('deleteConfirm.title')}
        </AppDialogTitle>
        <DialogContent>
          <Typography variant='body2'>{deleting && t('deleteConfirm.body', { name: deleting.name })}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleting(null)}>{tc('cancel')}</Button>
          <Button color='error' variant='contained' disabled={saving} onClick={() => deleting && remove(deleting)}>
            {tc('delete')}
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  )
}

type DialogProps = {
  initial: SyslogDestination
  saving: boolean
  onCancel: () => void
  onSave: (dest: SyslogDestination) => Promise<void>
  categoryLabel: (c: string) => string
}

function DestinationDialog({ initial, saving, onCancel, onSave, categoryLabel }: DialogProps) {
  const t = useTranslations('settings.syslog')
  const tc = useTranslations('common')
  const [form, setForm] = useState<SyslogDestination>(initial)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<TestResult | null>(null)
  const [touched, setTouched] = useState(false)

  const isNew = !initial.id
  const nameMissing = form.name.trim() === ''
  const hostMissing = form.host.trim() === ''
  const invalid = nameMissing || hostMissing

  const patch = (partial: Partial<SyslogDestination>) => setForm(f => ({ ...f, ...partial }))

  const setTransport = (transport: SyslogTransport) =>
    setForm(f => ({
      ...f,
      transport,
      port: f.port === defaultSyslogPort(f.transport) ? defaultSyslogPort(transport) : f.port,
    }))

  const runTest = async () => {
    setTouched(true)
    if (invalid) return
    setTesting(true)
    setTestResult(null)
    try {
      const r = await fetchJson<TestResult>(`${API}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      setTestResult(r)
    } catch (err: any) {
      setTestResult({ ok: false, error: err.message })
    } finally {
      setTesting(false)
    }
  }

  const submit = async () => {
    setTouched(true)
    if (invalid) return
    await onSave({ ...form, name: form.name.trim(), host: form.host.trim() })
  }

  const testText = (r: TestResult) => {
    if (!r.ok) return t('testFailed', { error: r.error ?? '' })
    return form.transport === 'udp'
      ? t('testOkUdp', { host: form.host, port: form.port })
      : t('testOk', { host: form.host, port: form.port })
  }

  return (
    <Dialog open onClose={onCancel} maxWidth='sm' fullWidth>
      <AppDialogTitle onClose={onCancel} icon={<i className='ri-broadcast-line' />}>
        {isNew ? t('dialog.addTitle') : t('dialog.editTitle')}
      </AppDialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            size='small'
            fullWidth
            required
            label={t('fields.name')}
            value={form.name}
            onChange={e => patch({ name: e.target.value })}
            error={touched && nameMissing}
            autoFocus={isNew}
          />

          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '2fr 1fr' }, gap: 2 }}>
            <TextField
              size='small'
              fullWidth
              required
              label={t('fields.host')}
              value={form.host}
              onChange={e => patch({ host: e.target.value })}
              error={touched && hostMissing}
              placeholder='siem.example.com'
            />
            <NumericTextField
              size='small'
              fullWidth
              type='number'
              label={t('fields.port')}
              value={form.port}
              onChange={port => patch({ port })}
              fallback={defaultSyslogPort(form.transport)}
              min={1}
              max={65535}
            />
          </Box>

          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
            <FormControl size='small' fullWidth sx={SMALL_SELECT_SX}>
              <InputLabel>{t('fields.transport')}</InputLabel>
              <Select
                value={form.transport}
                label={t('fields.transport')}
                onChange={e => setTransport(e.target.value as SyslogTransport)}
              >
                {SYSLOG_TRANSPORTS.map(tr => (
                  <MenuItem key={tr} value={tr}>
                    {tr.toUpperCase()}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControl size='small' fullWidth sx={SMALL_SELECT_SX}>
              <InputLabel>{t('fields.format')}</InputLabel>
              <Select
                value={form.format}
                label={t('fields.format')}
                onChange={e => patch({ format: e.target.value as SyslogFormat })}
              >
                {SYSLOG_FORMATS.map(f => (
                  <MenuItem key={f} value={f}>
                    {t(`formats.${f}`)}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>
          <FormHelperText sx={{ mt: -1.5, mx: 1.75 }}>{t(`transportHelper.${form.transport}`)}</FormHelperText>

          <FormControl size='small' fullWidth sx={SMALL_SELECT_SX}>
            <InputLabel>{t('fields.facility')}</InputLabel>
            <Select
              value={form.facility}
              label={t('fields.facility')}
              onChange={e => patch({ facility: Number(e.target.value) })}
            >
              {SYSLOG_FACILITIES.map(f => (
                <MenuItem key={f.code} value={f.code}>
                  {f.label} ({f.code})
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {isStream(form.transport) && (
            <FormControl size='small' fullWidth sx={SMALL_SELECT_SX}>
              <InputLabel>{t('fields.framing')}</InputLabel>
              <Select
                value={form.framing}
                label={t('fields.framing')}
                onChange={e => patch({ framing: e.target.value as SyslogFraming })}
              >
                {SYSLOG_FRAMINGS.map(fr => (
                  <MenuItem key={fr} value={fr}>
                    {t(`framings.${fr === 'octet-counting' ? 'octetCounting' : fr}`)}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )}

          <FormControl size='small' fullWidth sx={SMALL_SELECT_SX}>
            <InputLabel shrink>{t('fields.categories')}</InputLabel>
            <Select
              multiple
              displayEmpty
              value={form.categories}
              input={<OutlinedInput notched label={t('fields.categories')} />}
              onChange={e => {
                const v = e.target.value
                patch({ categories: (typeof v === 'string' ? v.split(',') : v) as SyslogDestination['categories'] })
              }}
              renderValue={selected => {
                const list = selected as string[]
                if (list.length === 0) return <em>{t('allCategories')}</em>
                return list.map(categoryLabel).join(', ')
              }}
            >
              {AUDIT_CATEGORIES.map(c => (
                <MenuItem key={c} value={c}>
                  {categoryLabel(c)}
                </MenuItem>
              ))}
            </Select>
            <FormHelperText>{t('fields.categoriesHelper')}</FormHelperText>
          </FormControl>

          <Collapse in={form.transport === 'tls'} unmountOnExit>
            <Stack spacing={2} sx={{ p: 2, border: 1, borderColor: 'divider', borderRadius: 1 }}>
              <Typography variant='subtitle2'>{t('tls.title')}</Typography>
              <Box>
                <FormControlLabel
                  control={
                    <Switch
                      checked={form.tls.verify}
                      onChange={e => patch({ tls: { ...form.tls, verify: e.target.checked } })}
                    />
                  }
                  label={t('tls.verify')}
                />
                {!form.tls.verify && (
                  <Alert severity='warning' sx={{ mt: 1 }}>
                    {t('tls.verifyWarning')}
                  </Alert>
                )}
              </Box>
              <TextField
                size='small'
                fullWidth
                label={t('tls.serverName')}
                value={form.tls.serverName}
                onChange={e => patch({ tls: { ...form.tls, serverName: e.target.value } })}
                helperText={t('tls.serverNameHelper')}
              />
              <TextField
                size='small'
                fullWidth
                multiline
                minRows={3}
                maxRows={8}
                label={t('tls.ca')}
                value={form.tls.ca}
                onChange={e => patch({ tls: { ...form.tls, ca: e.target.value } })}
                helperText={t('tls.caHelper')}
                placeholder='-----BEGIN CERTIFICATE-----'
                slotProps={{ input: { sx: { fontFamily: 'monospace', fontSize: '0.75rem' } } }}
              />
            </Stack>
          </Collapse>

          <FormControlLabel
            control={<Switch checked={form.enabled} onChange={e => patch({ enabled: e.target.checked })} />}
            label={t('fields.enabled')}
          />

          {testResult && (
            <Alert severity={testResult.ok ? 'success' : 'error'} onClose={() => setTestResult(null)}>
              {testText(testResult)}
              {testResult.message && (
                <Box
                  component='pre'
                  sx={{
                    mt: 1,
                    mb: 0,
                    p: 1,
                    fontSize: '0.7rem',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                    bgcolor: 'action.hover',
                    borderRadius: 1,
                    maxHeight: 120,
                    overflow: 'auto',
                  }}
                >
                  {testResult.message}
                </Box>
              )}
            </Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button
          variant='outlined'
          onClick={runTest}
          disabled={testing || saving}
          startIcon={testing ? <CircularProgress size={16} /> : <i className='ri-send-plane-line' />}
          sx={{ mr: 'auto' }}
        >
          {testing ? t('testing') : t('test')}
        </Button>
        <Button onClick={onCancel} disabled={saving}>
          {tc('cancel')}
        </Button>
        <Button
          variant='contained'
          onClick={submit}
          disabled={saving}
          startIcon={saving ? <CircularProgress size={16} /> : <i className='ri-save-line' />}
        >
          {saving ? tc('saving') : tc('save')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
