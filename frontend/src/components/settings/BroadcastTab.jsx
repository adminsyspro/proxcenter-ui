'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useSWRConfig } from 'swr'
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Snackbar,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'

import ColorPicker from '@/components/common/ColorPicker'
import BroadcastBanner from '@/components/broadcast/BroadcastBanner'
import { MIN_CONTRAST_RATIO, contrastRatio } from '@/lib/broadcast/contrast'
import { ACTIVE_BROADCASTS_KEY } from '@/hooks/useBroadcasts'
import { useRbacRoles, useTenants } from '@/hooks/useUsers'

const API = '/api/v1/settings/broadcast'

const PRESETS = [
  { key: 'info', bgColor: '#0ea5e9', fgColor: '#000000' },
  { key: 'warning', bgColor: '#f59e0b', fgColor: '#000000' },
  { key: 'critical', bgColor: '#dc2626', fgColor: '#ffffff' },
]

const EMPTY = {
  message: '',
  bgColor: '#f59e0b',
  fgColor: '#000000',
  dismissible: true,
  enabled: true,
  startsAt: '',
  endsAt: '',
  targetKind: 'all',
  targetIds: [],
}

/**
 * Local-datetime input value from an ISO string, and back. The input value
 * must be built from the local getters: a datetime-local field is read by the
 * browser as local time, so feeding it a UTC slice would shift the stored
 * schedule by the timezone offset on every edit round-trip.
 */
const pad2 = n => String(n).padStart(2, '0')
const toInput = iso => {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}
const toIso = value => (value ? new Date(value).toISOString() : null)

function deriveState(row) {
  const now = Date.now()
  if (!row.enabled) return 'disabled'
  if (row.startsAt && new Date(row.startsAt).getTime() > now) return 'scheduled'
  if (row.endsAt && new Date(row.endsAt).getTime() < now) return 'expired'
  return 'active'
}

const STATE_COLOUR = { active: 'success', scheduled: 'info', expired: 'default', disabled: 'warning' }

export default function BroadcastTab() {
  const t = useTranslations()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [snackbar, setSnackbar] = useState({ open: false, severity: 'success', message: '' })
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(EMPTY)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)

  // Bound to the surrounding SWR cache, so writing here refreshes the live
  // banner stack immediately instead of leaving it on its one-minute poll.
  // Taken from useSWRConfig() rather than swr's module-level mutate: the
  // latter only ever addresses the default cache.
  const { mutate } = useSWRConfig()

  const { data: tenantsData } = useTenants(true)
  const { data: rolesData } = useRbacRoles(true)
  const tenants = tenantsData?.data ?? []
  const roles = rolesData?.data ?? []

  // No setLoading(true) here: `loading` starts true and only ever settles to
  // false, so reloads after a save or delete update the table in place
  // instead of flashing the whole tab back to a spinner (and a synchronous
  // setState inside the mount effect would trip the lint cascade rule).
  const load = useCallback(async () => {
    try {
      const r = await fetch(API)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const payload = await r.json()
      setRows(Array.isArray(payload?.data) ? payload.data : [])
    } catch (e) {
      setSnackbar({ open: true, severity: 'error', message: e.message || t('settings.broadcast.loadError') })
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    ;(async () => { await load() })()
  }, [load])

  const setField = (key, value) => setForm(prev => ({ ...prev, [key]: value }))

  const closeSnackbar = () => setSnackbar(s => ({ ...s, open: false }))

  const openCreate = () => {
    setEditingId(null)
    setForm(EMPTY)
    setDialogOpen(true)
  }

  const openEdit = row => {
    setEditingId(row.id)
    setForm({
      message: row.message,
      bgColor: row.bgColor,
      fgColor: row.fgColor,
      dismissible: row.dismissible,
      enabled: row.enabled,
      startsAt: toInput(row.startsAt),
      endsAt: toInput(row.endsAt),
      targetKind: row.targetKind,
      targetIds: Array.isArray(row.targetIds) ? row.targetIds : [],
    })
    setDialogOpen(true)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const body = {
        message: form.message,
        bgColor: form.bgColor,
        fgColor: form.fgColor,
        dismissible: form.dismissible,
        enabled: form.enabled,
        startsAt: toIso(form.startsAt),
        endsAt: toIso(form.endsAt),
        targetKind: form.targetKind,
        targetIds: form.targetKind === 'all' ? [] : form.targetIds,
      }
      const r = await fetch(editingId ? `${API}/${encodeURIComponent(editingId)}` : API, {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!r.ok) {
        const data = await r.json().catch(() => null)
        throw new Error(data?.error || `HTTP ${r.status}`)
      }
      setDialogOpen(false)
      setSnackbar({ open: true, severity: 'success', message: t('settings.broadcast.saved') })
      await load()
      await mutate(ACTIVE_BROADCASTS_KEY)
    } catch (e) {
      setSnackbar({ open: true, severity: 'error', message: e.message || t('settings.broadcast.saveError') })
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const r = await fetch(`${API}/${encodeURIComponent(deleteTarget.id)}`, { method: 'DELETE' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      setDeleteTarget(null)
      await load()
      await mutate(ACTIVE_BROADCASTS_KEY)
    } catch (e) {
      setSnackbar({ open: true, severity: 'error', message: e.message || t('settings.broadcast.saveError') })
    } finally {
      setDeleting(false)
    }
  }

  // Code points, not UTF-16 units, so a single emoji counts as one.
  const messageLength = [...form.message].length
  const ratio = contrastRatio(form.bgColor, form.fgColor)
  const lowContrast = ratio !== null && ratio < MIN_CONTRAST_RATIO

  // Every targeted id must stay visible: an id that no longer resolves (or
  // has not loaded yet) falls back to the raw id instead of being silently
  // dropped, otherwise the table understates who receives the announcement.
  // An empty target list shows a placeholder rather than a blank cell.
  const targetLabel = row => {
    if (row.targetKind === 'all') return t('settings.broadcast.targetAll')
    const pool = row.targetKind === 'tenants' ? tenants : roles
    const ids = Array.isArray(row.targetIds) ? row.targetIds : []
    if (ids.length === 0) return '-'
    return ids.map(id => pool.find(item => item.id === id)?.name ?? id).join(', ')
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
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Box>
          <Typography variant='h6' fontWeight={700}>{t('settings.broadcast.title')}</Typography>
          <Typography variant='body2' color='text.secondary' sx={{ mt: 0.5 }}>
            {t('settings.broadcast.description')}
          </Typography>
        </Box>
        <Button
          data-testid='broadcast-create'
          variant='contained'
          startIcon={<i className='ri-add-line' />}
          onClick={openCreate}
        >
          {t('settings.broadcast.create')}
        </Button>
      </Box>

      <Card variant='outlined'>
        <TableContainer>
          <Table size='small'>
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 700 }}>{t('settings.broadcast.colMessage')}</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>{t('settings.broadcast.colState')}</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>{t('settings.broadcast.colTarget')}</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>{t('settings.broadcast.colWindow')}</TableCell>
                <TableCell sx={{ fontWeight: 700 }} align='right'>{t('settings.broadcast.colActions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} align='center' sx={{ py: 4, opacity: 0.5 }} data-testid='broadcast-empty'>
                    {t('settings.broadcast.empty')}
                  </TableCell>
                </TableRow>
              ) : null}
              {rows.map(row => {
                const state = deriveState(row)
                return (
                  <TableRow key={row.id} hover>
                    <TableCell sx={{ maxWidth: 380 }}>{row.message}</TableCell>
                    <TableCell>
                      <Chip
                        size='small'
                        color={STATE_COLOUR[state]}
                        data-testid={`broadcast-state-${row.id}`}
                        data-state={state}
                        label={t(`settings.broadcast.state.${state}`)}
                      />
                    </TableCell>
                    <TableCell>{targetLabel(row)}</TableCell>
                    <TableCell>
                      {row.startsAt ? new Date(row.startsAt).toLocaleString() : '—'}
                      {' → '}
                      {row.endsAt ? new Date(row.endsAt).toLocaleString() : '—'}
                    </TableCell>
                    <TableCell align='right'>
                      <IconButton
                        size='small'
                        aria-label={t('settings.broadcast.edit')}
                        data-testid={`broadcast-edit-${row.id}`}
                        onClick={() => openEdit(row)}
                      >
                        <i className='ri-pencil-line' style={{ fontSize: 16 }} />
                      </IconButton>
                      <IconButton
                        size='small'
                        color='error'
                        aria-label={t('settings.broadcast.delete')}
                        data-testid={`broadcast-delete-${row.id}`}
                        onClick={() => setDeleteTarget(row)}
                      >
                        <i className='ri-delete-bin-line' style={{ fontSize: 16 }} />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth='sm' fullWidth data-testid='broadcast-dialog'>
        <DialogTitle>
          {editingId ? t('settings.broadcast.editTitle') : t('settings.broadcast.createTitle')}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {/* Live preview reuses the real row component so it cannot drift. */}
            <Box sx={{ position: 'relative', borderRadius: 1, overflow: 'hidden' }}>
              <BroadcastBanner
                banner={{
                  id: 'preview',
                  message: form.message || t('settings.broadcast.previewPlaceholder'),
                  bgColor: form.bgColor,
                  fgColor: form.fgColor,
                  dismissible: false,
                  updatedAt: 'preview',
                }}
                onDismiss={() => {}}
              />
            </Box>

            <Box>
              <TextField
                fullWidth
                multiline
                minRows={2}
                label={t('settings.broadcast.message')}
                value={form.message}
                onChange={e => setField('message', e.target.value)}
                slotProps={{ htmlInput: { 'data-testid': 'broadcast-message-input' } }}
              />
              <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 0.5 }}>
                <Typography variant='caption' color='text.secondary' data-testid='broadcast-message-count'>
                  {messageLength} / 500
                </Typography>
              </Box>
            </Box>

            {/* Each preset wears the pair it applies, so the readable
                combination is visible before it is chosen. The three share the
                dialog width equally. */}
            <Stack
              direction='row'
              spacing={1}
              sx={{ flexWrap: 'wrap', rowGap: 1, '& > *': { flex: '1 1 0', minWidth: 96 } }}
            >
              {PRESETS.map(preset => (
                <Button
                  key={preset.key}
                  data-testid={`broadcast-preset-${preset.key}`}
                  size='small'
                  variant='contained'
                  onClick={() => setForm(prev => ({ ...prev, bgColor: preset.bgColor, fgColor: preset.fgColor }))}
                  sx={{
                    bgcolor: preset.bgColor,
                    color: preset.fgColor,
                    boxShadow: 'none',
                    // brightness() rather than a computed shade: the presets are
                    // plain hex values, so this works without parsing them.
                    '&:hover': { bgcolor: preset.bgColor, filter: 'brightness(0.92)', boxShadow: 'none' },
                  }}
                >
                  {t(`settings.broadcast.preset.${preset.key}`)}
                </Button>
              ))}
            </Stack>

            {/* One row, each picker taking half the dialog width and wrapping
                to its own line only when there is no room left. */}
            <Stack
              direction='row'
              spacing={3}
              sx={{ flexWrap: 'wrap', rowGap: 2, '& > *': { flex: '1 1 220px', minWidth: 0 } }}
            >
              <ColorPicker
                fullWidth
                value={form.bgColor}
                onChange={hex => setField('bgColor', hex)}
                label={t('settings.broadcast.bgColor')}
                placeholder='#f59e0b'
                fallback='#f59e0b'
              />
              <ColorPicker
                fullWidth
                value={form.fgColor}
                onChange={hex => setField('fgColor', hex)}
                label={t('settings.broadcast.fgColor')}
                placeholder='#000000'
                fallback='#000000'
              />
            </Stack>
            {lowContrast ? (
              <Alert severity='warning' data-testid='broadcast-contrast-warning'>
                {t('settings.broadcast.contrastWarning')}
              </Alert>
            ) : null}

            <Stack direction='row' spacing={2}>
              <TextField
                fullWidth
                type='datetime-local'
                label={t('settings.broadcast.startsAt')}
                value={form.startsAt}
                onChange={e => setField('startsAt', e.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
              />
              <TextField
                fullWidth
                type='datetime-local'
                label={t('settings.broadcast.endsAt')}
                value={form.endsAt}
                onChange={e => setField('endsAt', e.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
              />
            </Stack>

            <FormControl fullWidth size='small'>
              <InputLabel id='broadcast-target-kind'>{t('settings.broadcast.target')}</InputLabel>
              <Select
                labelId='broadcast-target-kind'
                label={t('settings.broadcast.target')}
                value={form.targetKind}
                onChange={e => setForm(prev => ({ ...prev, targetKind: e.target.value, targetIds: [] }))}
              >
                <MenuItem value='all'>{t('settings.broadcast.targetAll')}</MenuItem>
                <MenuItem value='tenants'>{t('settings.broadcast.targetTenants')}</MenuItem>
                <MenuItem value='roles'>{t('settings.broadcast.targetRoles')}</MenuItem>
              </Select>
            </FormControl>

            {form.targetKind !== 'all' ? (
              <Autocomplete
                multiple
                size='small'
                options={form.targetKind === 'tenants' ? tenants : roles}
                getOptionLabel={option => option.name ?? option.id}
                value={(form.targetKind === 'tenants' ? tenants : roles).filter(o => form.targetIds.includes(o.id))}
                onChange={(_e, selected) => setField('targetIds', selected.map(o => o.id))}
                renderTags={(value, getTagProps) =>
                  value.map((option, index) => (
                    <Chip size='small' label={option.name ?? option.id} {...getTagProps({ index })} key={option.id} />
                  ))
                }
                renderInput={params => <TextField {...params} label={t('settings.broadcast.targetIds')} />}
              />
            ) : null}

            {/* One row: wraps instead of overflowing on a narrow dialog. */}
            <Stack direction='row' spacing={3} sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
              <FormControlLabel
                control={<Switch checked={form.dismissible} onChange={(_e, v) => setField('dismissible', v)} />}
                label={t('settings.broadcast.dismissible')}
              />
              <FormControlLabel
                control={<Switch checked={form.enabled} onChange={(_e, v) => setField('enabled', v)} />}
                label={t('settings.broadcast.enabled')}
              />
            </Stack>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>{t('common.cancel')}</Button>
          <Button
            data-testid='broadcast-save'
            variant='contained'
            onClick={handleSave}
            disabled={saving || form.message.trim().length === 0}
          >
            {saving ? <CircularProgress size={16} /> : t('common.save')}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)} data-testid='broadcast-delete-dialog'>
        <DialogTitle>{t('settings.broadcast.deleteTitle')}</DialogTitle>
        <DialogContent>
          <Typography>{t('settings.broadcast.deleteConfirm')}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)}>{t('common.cancel')}</Button>
          <Button
            data-testid='broadcast-delete-confirm'
            variant='contained'
            color='error'
            onClick={handleDelete}
            disabled={deleting}
          >
            {deleting ? <CircularProgress size={16} /> : t('settings.broadcast.delete')}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={closeSnackbar}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert severity={snackbar.severity} onClose={closeSnackbar}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  )
}
