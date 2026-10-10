'use client'

// Notification channels (roadmap#47): Slack, Microsoft Teams, ntfy, Discord
// and generic webhooks next to the email settings. The channels live in the
// orchestrator, which delivers to them through the same pipeline as email
// (rate limit, global type and severity filters) and then applies each
// channel's own type list and severity floor.

import { useState } from 'react'
import useSWR from 'swr'
import { useTranslations } from 'next-intl'

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
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
  InputAdornment,
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
import {
  CHANNEL_NOTIFICATION_TYPES,
  CHANNEL_SEVERITIES,
  CHANNEL_TYPES,
  CHANNEL_TYPE_META,
  CHANNEL_URL_PLACEHOLDER,
  channelHealth,
  channelSecretKind,
  channelToInput,
  newChannelInput,
  type ChannelHealth,
  type ChannelInput,
  type ChannelNotificationType,
  type ChannelSeverity,
  type ChannelType,
  type NotificationChannel,
} from '@/lib/notifications/channels'

const API = '/api/v1/orchestrator/notifications/channels'

// A small MUI Select renders 38 px against 35.9 px for a small TextField; this
// pins both to the same line height so a row of fields sits level.
const SMALL_SELECT_SX = {
  '& .MuiInputBase-input.MuiSelect-select': { minHeight: '1.4375em', lineHeight: '1.4375em' },
} as const

type Payload = { data: NotificationChannel[] }

type TestResult = { success: boolean; error?: string; message?: string }

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

const HEALTH_COLOR: Record<ChannelHealth, string> = {
  disabled: 'text.disabled',
  idle: 'action.disabled',
  ok: 'success.main',
  error: 'error.main',
}

// Type glyph at the head of every row.
function ChannelGlyph({ type }: { type: ChannelType }) {
  const meta = CHANNEL_TYPE_META[type] ?? CHANNEL_TYPE_META.webhook

  return <i className={meta.icon} style={{ color: meta.color, fontSize: 18, flexShrink: 0 }} />
}

export default function NotificationChannelsCard() {
  const t = useTranslations('notifications.channels')
  const tc = useTranslations('common')
  const { data, error: loadError, isLoading, mutate } = useSWR<Payload>(API, fetcher, { refreshInterval: 15_000 })

  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState<{ channel: NotificationChannel | null; form: ChannelInput } | null>(null)
  const [deleting, setDeleting] = useState<NotificationChannel | null>(null)

  const channels = data?.data ?? []

  const typeLabel = (type: ChannelType) => t(`types.${type}`)
  const notificationTypeLabel = (type: ChannelNotificationType) => t(`notificationTypes.${type}`)
  const severityLabel = (sev: ChannelSeverity) => t(`severities.${sev}`)

  const save = async (channel: NotificationChannel | null, form: ChannelInput): Promise<boolean> => {
    setSaving(true)
    setMessage(null)

    try {
      if (channel) {
        await fetchJson<NotificationChannel>(`${API}/${encodeURIComponent(channel.id)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        })
      } else {
        await fetchJson<NotificationChannel>(API, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        })
      }

      await mutate()
      setMessage({ type: 'success', text: t('saved') })

      return true
    } catch (err: any) {
      setMessage({ type: 'error', text: `${t('saveError')} ${err.message}` })

      return false
    } finally {
      setSaving(false)
    }
  }

  const upsert = async (form: ChannelInput) => {
    if (!editing) return
    if (await save(editing.channel, form)) setEditing(null)
  }

  const toggle = (channel: NotificationChannel, enabled: boolean) =>
    save(channel, { ...channelToInput(channel), enabled })

  const remove = async (channel: NotificationChannel) => {
    setSaving(true)
    setMessage(null)

    try {
      await fetchJson(`${API}/${encodeURIComponent(channel.id)}`, { method: 'DELETE' })
      await mutate()
      setDeleting(null)
    } catch (err: any) {
      setMessage({ type: 'error', text: `${t('saveError')} ${err.message}` })
    } finally {
      setSaving(false)
    }
  }

  const filtersText = (ch: NotificationChannel) => {
    const types = ch.types?.length ? ch.types.map(notificationTypeLabel).join(', ') : t('allTypes')

    return `${types} · ${severityLabel(ch.min_severity || 'warning')}`
  }

  const activityText = (ch: NotificationChannel) => {
    if (!ch.enabled) return tc('disabled')
    const health = channelHealth(ch)

    if (health === 'idle') return t('neverSent')
    if (health === 'error') {
      const error = ch.last_error || ''

      return t('lastError', { error: error.length > 80 ? `${error.slice(0, 79)}…` : error })
    }

    return t('lastSent', { time: ch.last_sent_at ? new Date(ch.last_sent_at).toLocaleString() : '' })
  }

  return (
    <Card variant='outlined' sx={{ mb: 3 }}>
      <CardContent>
        <Stack direction='row' alignItems='flex-start' spacing={2} sx={{ mb: 2 }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant='subtitle1' fontWeight={700} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <i className='ri-webhook-line' style={{ color: '#6366f1' }} />
              {t('title')}
            </Typography>
            <Typography variant='body2' sx={{ opacity: 0.7, mt: 0.5 }}>
              {t('description')}
            </Typography>
          </Box>
          <Button
            variant='contained'
            size='small'
            startIcon={<i className='ri-add-line' />}
            disabled={isLoading || Boolean(loadError)}
            onClick={() => setEditing({ channel: null, form: newChannelInput() })}
          >
            {t('add')}
          </Button>
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

        {!isLoading && !loadError && channels.length === 0 && (
          <Typography variant='body2' color='text.secondary'>
            {t('empty')}
          </Typography>
        )}

        {!isLoading && channels.length > 0 && (
          <Table size='small'>
            <TableHead>
              <TableRow>
                <TableCell padding='checkbox' />
                <TableCell>{t('columns.name')}</TableCell>
                <TableCell>{t('columns.target')}</TableCell>
                <TableCell>{t('columns.filters')}</TableCell>
                <TableCell>{t('columns.activity')}</TableCell>
                <TableCell align='right'>{tc('actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {channels.map(ch => {
                const health = channelHealth(ch)

                return (
                  <TableRow key={ch.id} hover data-testid={`channel-row-${ch.id}`}>
                    <TableCell padding='checkbox'>
                      <Tooltip title={activityText(ch)}>
                        <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: HEALTH_COLOR[health], mx: 'auto' }} />
                      </Tooltip>
                    </TableCell>
                    <TableCell sx={{ maxWidth: 260 }}>
                      <Stack direction='row' spacing={1} alignItems='center' sx={{ minWidth: 0 }}>
                        <ChannelGlyph type={ch.type} />
                        <Typography variant='body2' fontWeight={500} noWrap>
                          {ch.name}
                        </Typography>
                        <Chip size='small' variant='outlined' label={typeLabel(ch.type)} />
                      </Stack>
                    </TableCell>
                    <TableCell sx={{ maxWidth: 280 }}>
                      <Typography variant='body2' noWrap sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                        {ch.url_masked}
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ maxWidth: 220 }}>
                      <Typography variant='body2' noWrap>
                        {filtersText(ch)}
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ maxWidth: 260 }}>
                      <Typography variant='caption' color={health === 'error' ? 'error.main' : 'text.secondary'} noWrap component='div'>
                        {activityText(ch)}
                      </Typography>
                    </TableCell>
                    <TableCell align='right' sx={{ whiteSpace: 'nowrap' }}>
                      <Tooltip title={ch.enabled ? tc('enabled') : tc('disabled')}>
                        <Switch size='small' checked={ch.enabled} disabled={saving} onChange={e => toggle(ch, e.target.checked)} />
                      </Tooltip>
                      <Tooltip title={tc('edit')}>
                        <IconButton size='small' onClick={() => setEditing({ channel: ch, form: channelToInput(ch) })}>
                          <i className='ri-pencil-line' />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title={tc('delete')}>
                        <IconButton size='small' color='error' onClick={() => setDeleting(ch)}>
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
        <ChannelDialog
          channel={editing.channel}
          initial={editing.form}
          saving={saving}
          onCancel={() => setEditing(null)}
          onSave={upsert}
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
  channel: NotificationChannel | null
  initial: ChannelInput
  saving: boolean
  onCancel: () => void
  onSave: (form: ChannelInput) => Promise<void>
}

function ChannelDialog({ channel, initial, saving, onCancel, onSave }: DialogProps) {
  const t = useTranslations('notifications.channels')
  const tc = useTranslations('common')
  const [form, setForm] = useState<ChannelInput>(initial)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<TestResult | null>(null)
  const [touched, setTouched] = useState(false)
  const [showSecrets, setShowSecrets] = useState(false)

  const isNew = !channel
  const nameMissing = form.name.trim() === ''
  const urlMissing = isNew && form.url.trim() === ''
  const invalid = nameMissing || urlMissing
  const secretKind = channelSecretKind(form.type)
  const isWebhook = form.type === 'webhook'

  const patch = (partial: Partial<ChannelInput>) => setForm(f => ({ ...f, ...partial }))

  const runTest = async () => {
    setTouched(true)
    if (invalid) return
    setTesting(true)
    setTestResult(null)

    try {
      const r = await fetchJson<TestResult>(`${API}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: channel?.id ?? '', ...form }),
      })

      setTestResult(r)
    } catch (err: any) {
      setTestResult({ success: false, error: err.message })
    } finally {
      setTesting(false)
    }
  }

  const submit = async () => {
    setTouched(true)
    if (invalid) return
    await onSave({ ...form, name: form.name.trim(), url: form.url.trim() })
  }

  const secretAdornment = (
    <InputAdornment position='end'>
      <IconButton size='small' onClick={() => setShowSecrets(s => !s)} aria-label={showSecrets ? t('hideSecrets') : t('showSecrets')}>
        <i className={showSecrets ? 'ri-eye-off-line' : 'ri-eye-line'} />
      </IconButton>
    </InputAdornment>
  )

  const typeLabel = (type: ChannelType) => t(`types.${type}`)
  const notificationTypeLabel = (type: ChannelNotificationType) => t(`notificationTypes.${type}`)

  return (
    <Dialog open onClose={onCancel} maxWidth='sm' fullWidth>
      <AppDialogTitle onClose={onCancel} icon={<i className={CHANNEL_TYPE_META[form.type]?.icon ?? 'ri-webhook-line'} />}>
        {isNew ? t('dialog.addTitle') : t('dialog.editTitle')}
      </AppDialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '2fr 1fr' }, gap: 2 }}>
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
            <FormControl size='small' fullWidth sx={SMALL_SELECT_SX}>
              <InputLabel>{t('fields.type')}</InputLabel>
              <Select value={form.type} label={t('fields.type')} onChange={e => patch({ type: e.target.value as ChannelType })}>
                {CHANNEL_TYPES.map(type => (
                  <MenuItem key={type} value={type}>
                    <Stack direction='row' spacing={1} alignItems='center'>
                      <ChannelGlyph type={type} />
                      <span>{typeLabel(type)}</span>
                    </Stack>
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>

          <TextField
            size='small'
            fullWidth
            required={isNew}
            type={showSecrets ? 'text' : 'password'}
            label={t('fields.url')}
            value={form.url}
            onChange={e => patch({ url: e.target.value })}
            error={touched && urlMissing}
            placeholder={isNew ? CHANNEL_URL_PLACEHOLDER[form.type] : channel?.url_masked}
            helperText={isNew ? t(`urlHelper.${form.type}`) : t('keepCurrent', { current: channel?.url_masked ?? '' })}
            autoComplete='off'
            slotProps={{ input: { endAdornment: secretAdornment } }}
          />

          {secretKind === 'token' && (
            <TextField
              size='small'
              fullWidth
              type={showSecrets ? 'text' : 'password'}
              label={t('fields.token')}
              value={form.secret}
              onChange={e => patch({ secret: e.target.value })}
              helperText={channel?.has_secret ? t('keepStoredSecret') : t('fields.tokenHelper')}
              autoComplete='off'
              slotProps={{ input: { endAdornment: secretAdornment } }}
            />
          )}

          {isWebhook && (
            <>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
                <TextField
                  size='small'
                  fullWidth
                  label={t('fields.headerName')}
                  value={form.header_name}
                  onChange={e => patch({ header_name: e.target.value })}
                  placeholder='X-Api-Key'
                />
                <TextField
                  size='small'
                  fullWidth
                  type={showSecrets ? 'text' : 'password'}
                  label={t('fields.headerValue')}
                  value={form.header_value}
                  onChange={e => patch({ header_value: e.target.value })}
                  helperText={channel?.has_header_value ? t('keepStoredSecret') : undefined}
                  autoComplete='off'
                  slotProps={{ input: { endAdornment: secretAdornment } }}
                />
              </Box>
              <TextField
                size='small'
                fullWidth
                type={showSecrets ? 'text' : 'password'}
                label={t('fields.signingSecret')}
                value={form.secret}
                onChange={e => patch({ secret: e.target.value })}
                helperText={channel?.has_secret ? t('keepStoredSecret') : t('fields.signingSecretHelper')}
                autoComplete='off'
                slotProps={{ input: { endAdornment: secretAdornment } }}
              />
            </>
          )}

          {!isNew && secretKind && channel?.has_secret && (
            <FormControlLabel
              control={<Checkbox size='small' checked={Boolean(form.clear_secret)} onChange={e => patch({ clear_secret: e.target.checked })} />}
              label={secretKind === 'token' ? t('clearToken') : t('clearSigningSecret')}
            />
          )}
          {!isNew && isWebhook && channel?.has_header_value && (
            <FormControlLabel
              control={<Checkbox size='small' checked={Boolean(form.clear_header_value)} onChange={e => patch({ clear_header_value: e.target.checked })} />}
              label={t('clearHeaderValue')}
            />
          )}

          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
            <FormControl size='small' fullWidth sx={SMALL_SELECT_SX}>
              <InputLabel shrink>{t('fields.types')}</InputLabel>
              <Select
                multiple
                displayEmpty
                value={form.types}
                input={<OutlinedInput notched label={t('fields.types')} />}
                onChange={e => {
                  const v = e.target.value

                  patch({ types: (typeof v === 'string' ? v.split(',') : v) as ChannelNotificationType[] })
                }}
                renderValue={selected => {
                  const list = selected as ChannelNotificationType[]

                  if (list.length === 0) return <em>{t('allTypes')}</em>

                  return list.map(notificationTypeLabel).join(', ')
                }}
              >
                {CHANNEL_NOTIFICATION_TYPES.map(type => (
                  <MenuItem key={type} value={type}>
                    {notificationTypeLabel(type)}
                  </MenuItem>
                ))}
              </Select>
              <FormHelperText>{t('fields.typesHelper')}</FormHelperText>
            </FormControl>

            <FormControl size='small' fullWidth sx={SMALL_SELECT_SX}>
              <InputLabel>{t('fields.minSeverity')}</InputLabel>
              <Select
                value={form.min_severity}
                label={t('fields.minSeverity')}
                onChange={e => patch({ min_severity: e.target.value as ChannelSeverity })}
              >
                {CHANNEL_SEVERITIES.map(sev => (
                  <MenuItem key={sev} value={sev}>
                    {t(`severities.${sev}`)}
                  </MenuItem>
                ))}
              </Select>
              <FormHelperText>{t('fields.minSeverityHelper')}</FormHelperText>
            </FormControl>
          </Box>

          <Box>
            <FormControlLabel
              control={<Switch checked={form.allow_private_network} onChange={e => patch({ allow_private_network: e.target.checked })} />}
              label={t('fields.allowPrivate')}
            />
            <Collapse in={form.allow_private_network} unmountOnExit>
              <Alert severity='warning' sx={{ mt: 1 }}>
                {t('fields.allowPrivateWarning')}
              </Alert>
            </Collapse>
            {!form.allow_private_network && <FormHelperText sx={{ mx: 1.75 }}>{t('fields.allowPrivateHelper')}</FormHelperText>}
          </Box>

          <FormControlLabel
            control={<Switch checked={form.enabled} onChange={e => patch({ enabled: e.target.checked })} />}
            label={t('fields.enabled')}
          />

          {testResult && (
            <Alert severity={testResult.success ? 'success' : 'error'} onClose={() => setTestResult(null)}>
              {testResult.success ? t('testOk') : t('testFailed')}
              {!testResult.success && testResult.error && (
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
                  {testResult.error}
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
