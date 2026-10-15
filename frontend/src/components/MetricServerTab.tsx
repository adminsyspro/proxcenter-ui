'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import {
  Alert,
  Box,
  Button,
  Card,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
  useTheme,
} from '@mui/material'
import { useToast } from '@/contexts/ToastContext'

interface MetricServer {
  id: string
  type: string
  server?: string
  port?: number
  disable?: number
  [key: string]: any
}

interface Props {
  connectionId: string
}

const TYPE_ICONS: Record<string, string> = {
  graphite: 'ri-line-chart-line',
  influxdb: 'ri-database-2-line',
  opentelemetry: 'ri-radar-line',
}

const TYPE_DEFAULTS: Record<string, Record<string, any>> = {
  graphite: { port: 2003, path: 'proxmox', proto: 'udp', mtu: 1500, timeout: 1 },
  influxdb: { port: 8089, influxdbproto: 'udp', organization: 'proxmox', bucket: 'proxmox', 'max-body-size': 25000000, timeout: 1, mtu: 1500, 'verify-certificate': 1 },
  opentelemetry: { port: 4318, 'otel-protocol': 'https', 'otel-path': '/v1/metrics', 'otel-timeout': 5, 'otel-verify-ssl': 1, 'otel-max-body-size': 10000000, 'otel-compression': 'gzip' },
}

// PVE stores these OpenTelemetry options as base64-encoded JSON; the dialog edits the JSON itself.
const OTEL_JSON_FIELDS = ['otel-headers', 'otel-resource-attributes']

const encodeBase64 = (text: string) => {
  let binary = ''
  new TextEncoder().encode(text).forEach(byte => { binary += String.fromCharCode(byte) })
  return btoa(binary)
}

const decodeBase64 = (value: string) => {
  try {
    return new TextDecoder().decode(Uint8Array.from(atob(value), c => c.charCodeAt(0)))
  } catch {
    return value
  }
}

const isInvalidJson = (text?: string) => {
  if (!text?.trim()) return false
  try { JSON.parse(text); return false } catch { return true }
}

const isEmpty = (v: any) => v === undefined || v === null || v === ''

export default function MetricServerTab({ connectionId }: Props) {
  const t = useTranslations('inventory')
  const theme = useTheme()
  const toast = useToast()

  const [loading, setLoading] = useState(true)
  const [servers, setServers] = useState<MetricServer[]>([])
  const [error, setError] = useState<string | null>(null)

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogMode, setDialogMode] = useState<'create' | 'edit'>('create')
  const [dialogType, setDialogType] = useState<string>('graphite')
  const [dialogData, setDialogData] = useState<Record<string, any>>({})
  const [loadedData, setLoadedData] = useState<Record<string, any>>({})
  const [dialogSaving, setDialogSaving] = useState(false)

  // Delete dialog
  const [deleteTarget, setDeleteTarget] = useState<MetricServer | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Add menu
  const [addMenuAnchor, setAddMenuAnchor] = useState<null | HTMLElement>(null)

  const apiBase = `/api/v1/connections/${encodeURIComponent(connectionId)}/cluster/metrics/server`

  const fetchServers = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(apiBase, { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setServers(json?.data || [])
    } catch (e: any) {
      setError(e?.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [apiBase])

  useEffect(() => { void fetchServers() }, [fetchServers])

  const openCreate = (type: string) => {
    setAddMenuAnchor(null)
    setDialogMode('create')
    setDialogType(type)
    setDialogData({ ...TYPE_DEFAULTS[type], disable: 0 })
    setLoadedData({})
    setDialogOpen(true)
  }

  const openEdit = async (server: MetricServer) => {
    // The list only carries id/type/server/port/disable: load the full config to edit it.
    let config: Record<string, any>
    try {
      const res = await fetch(`${apiBase}/${encodeURIComponent(server.id)}`, { cache: 'no-store' })
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `HTTP ${res.status}`) }
      const json = await res.json()
      config = { ...json?.data, id: server.id, type: server.type }
    } catch (e: any) {
      toast.error(e?.message || 'Error')
      return
    }
    for (const key of OTEL_JSON_FIELDS) {
      if (config[key]) config[key] = decodeBase64(config[key])
    }
    setDialogMode('edit')
    setDialogType(server.type)
    setDialogData(config)
    setLoadedData(config)
    setDialogOpen(true)
  }

  const toPveParams = (data: Record<string, any>) => {
    const params = { ...data }
    for (const key of OTEL_JSON_FIELDS) {
      if (key in params) params[key] = params[key]?.trim() ? encodeBase64(params[key].trim()) : ''
    }
    return params
  }

  const handleDialogSave = async () => {
    setDialogSaving(true)
    try {
      if (dialogMode === 'create') {
        const res = await fetch(apiBase, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ serverId: dialogData.id || dialogData.name, type: dialogType, ...toPveParams(dialogData) }),
        })
        if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `HTTP ${res.status}`) }
        toast.success(t('metricServerCreated'))
      } else {
        const serverId = dialogData.id
        const { id: _, type: __, ...params } = toPveParams(dialogData)
        // Empty values are dropped by the route, so a field the user cleared must be deleted explicitly.
        const cleared = Object.keys(loadedData).filter(k => k !== 'id' && k !== 'type' && !isEmpty(loadedData[k]) && isEmpty(params[k]))
        if (cleared.length) params.delete = cleared.join(',')
        const res = await fetch(`${apiBase}/${encodeURIComponent(serverId)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(params),
        })
        if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `HTTP ${res.status}`) }
        toast.success(t('metricServerUpdated'))
      }
      setDialogOpen(false)
      await fetchServers()
    } catch (e: any) {
      toast.error(e?.message || 'Error')
    } finally {
      setDialogSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const res = await fetch(`${apiBase}/${encodeURIComponent(deleteTarget.id)}`, { method: 'DELETE' })
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `HTTP ${res.status}`) }
      toast.success(t('metricServerDeleted'))
      setDeleteTarget(null)
      await fetchServers()
    } catch (e: any) {
      toast.error(e?.message || 'Error')
    } finally {
      setDeleting(false)
    }
  }

  const setField = (key: string, value: any) => {
    setDialogData(prev => ({ ...prev, [key]: value }))
  }

  const invalidJson = dialogType === 'opentelemetry' && OTEL_JSON_FIELDS.some(key => isInvalidJson(dialogData[key]))

  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', p: 6 }}><CircularProgress size={32} /></Box>
  if (error) return <Box sx={{ p: 2 }}><Alert severity="error">{error}</Alert></Box>

  return (
    <Box sx={{ p: 2, overflow: 'auto' }}>
      <Stack spacing={2}>
        {/* Toolbar */}
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button
            variant="contained"
            size="small"
            startIcon={<i className="ri-add-line" />}
            onClick={e => setAddMenuAnchor(e.currentTarget)}
          >
            {t('metricServerAdd')}
          </Button>
          <Menu anchorEl={addMenuAnchor} open={Boolean(addMenuAnchor)} onClose={() => setAddMenuAnchor(null)}>
            {['graphite', 'influxdb', 'opentelemetry'].map(type => (
              <MenuItem key={type} onClick={() => openCreate(type)}>
                <ListItemIcon><i className={TYPE_ICONS[type]} style={{ fontSize: 18 }} /></ListItemIcon>
                <ListItemText>{type.charAt(0).toUpperCase() + type.slice(1)}{type === 'opentelemetry' ? ' Server' : ''}</ListItemText>
              </MenuItem>
            ))}
          </Menu>
        </Box>

        {/* Table */}
        <Card variant="outlined">
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 700 }}>{t('metricServerName')}</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>{t('metricServerType')}</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>{t('metricServerServer')}</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>{t('metricServerPort')}</TableCell>
                  <TableCell sx={{ fontWeight: 700 }} align="center">{t('metricServerEnabled')}</TableCell>
                  <TableCell sx={{ fontWeight: 700 }} align="right">{t('metricServerActions')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {servers.length === 0 && (
                  <TableRow><TableCell colSpan={6} align="center" sx={{ py: 4, opacity: 0.5 }}>{t('metricServerEmpty')}</TableCell></TableRow>
                )}
                {servers.map(s => (
                  <TableRow key={s.id} hover>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <i className={TYPE_ICONS[s.type] || 'ri-server-line'} style={{ fontSize: 16, opacity: 0.6 }} />
                        {s.id}
                      </Box>
                    </TableCell>
                    <TableCell>{s.type}</TableCell>
                    <TableCell>{s.server || '-'}</TableCell>
                    <TableCell>{s.port || '-'}</TableCell>
                    <TableCell align="center">
                      <i className={s.disable ? 'ri-close-line' : 'ri-check-line'} style={{ fontSize: 16, color: s.disable ? theme.palette.error.main : theme.palette.success.main }} />
                    </TableCell>
                    <TableCell align="right">
                      <IconButton size="small" onClick={() => openEdit(s)}><i className="ri-pencil-line" style={{ fontSize: 16 }} /></IconButton>
                      <IconButton size="small" color="error" onClick={() => setDeleteTarget(s)}><i className="ri-delete-bin-line" style={{ fontSize: 16 }} /></IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Card>
      </Stack>

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <i className={TYPE_ICONS[dialogType] || 'ri-server-line'} style={{ fontSize: 20 }} />
          {dialogMode === 'create' ? `${t('metricServerCreate')}: ${dialogType.charAt(0).toUpperCase() + dialogType.slice(1)}` : `${t('metricServerEdit')}: ${dialogData.id || ''}`}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {/* Common fields */}
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
              <TextField size="small" label={t('metricServerName')} value={dialogData.id || ''} onChange={e => setField('id', e.target.value)} disabled={dialogMode === 'edit'} required />
              <FormControlLabel control={<Checkbox checked={!dialogData.disable} onChange={e => setField('disable', e.target.checked ? 0 : 1)} />} label={t('metricServerEnabled')} />
            </Box>
            <Box sx={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 2 }}>
              <TextField size="small" label={t('metricServerServer')} value={dialogData.server || ''} onChange={e => setField('server', e.target.value)} required />
              <TextField size="small" label={t('metricServerPort')} value={dialogData.port || ''} onChange={e => setField('port', e.target.value)} type="number" />
            </Box>

            {/* Type-specific fields */}
            {dialogType === 'graphite' && (
              <>
                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                  <TextField size="small" label="Path" value={dialogData.path || ''} onChange={e => setField('path', e.target.value)} />
                  <FormControl size="small">
                    <InputLabel>Protocol</InputLabel>
                    <Select value={dialogData.proto || 'udp'} label="Protocol" onChange={e => setField('proto', e.target.value)}>
                      <MenuItem value="udp">UDP</MenuItem>
                      <MenuItem value="tcp">TCP</MenuItem>
                    </Select>
                  </FormControl>
                </Box>
                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                  <TextField size="small" label="MTU" value={dialogData.mtu || ''} onChange={e => setField('mtu', e.target.value)} type="number" />
                  <TextField size="small" label="TCP Timeout" value={dialogData.timeout || ''} onChange={e => setField('timeout', e.target.value)} type="number" />
                </Box>
              </>
            )}

            {dialogType === 'influxdb' && (
              <>
                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                  <FormControl size="small">
                    <InputLabel>Protocol</InputLabel>
                    <Select value={dialogData.influxdbproto || 'udp'} label="Protocol" onChange={e => setField('influxdbproto', e.target.value)}>
                      <MenuItem value="udp">UDP</MenuItem>
                      <MenuItem value="http">HTTP</MenuItem>
                      <MenuItem value="https">HTTPS</MenuItem>
                    </Select>
                  </FormControl>
                  <TextField size="small" label="Token" value={dialogData.token || ''} onChange={e => setField('token', e.target.value)} />
                </Box>
                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                  <TextField size="small" label="Organization" value={dialogData.organization || ''} onChange={e => setField('organization', e.target.value)} />
                  <TextField size="small" label="Bucket" value={dialogData.bucket || ''} onChange={e => setField('bucket', e.target.value)} />
                </Box>
                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                  <TextField size="small" label="API Path Prefix" value={dialogData['api-path-prefix'] || ''} onChange={e => setField('api-path-prefix', e.target.value)} />
                  <TextField size="small" label="Max Body Size (b)" value={dialogData['max-body-size'] || ''} onChange={e => setField('max-body-size', e.target.value)} type="number" />
                </Box>
                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 2 }}>
                  <TextField size="small" label="Timeout (s)" value={dialogData.timeout || ''} onChange={e => setField('timeout', e.target.value)} type="number" />
                  <TextField size="small" label="MTU" value={dialogData.mtu || ''} onChange={e => setField('mtu', e.target.value)} type="number" />
                  <FormControlLabel control={<Checkbox checked={dialogData['verify-certificate'] !== false && dialogData['verify-certificate'] !== 0} onChange={e => setField('verify-certificate', e.target.checked ? 1 : 0)} />} label="Verify Certificate" />
                </Box>
              </>
            )}

            {dialogType === 'opentelemetry' && (
              <>
                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                  <FormControl size="small">
                    <InputLabel>Protocol</InputLabel>
                    <Select value={dialogData['otel-protocol'] || 'https'} label="Protocol" onChange={e => setField('otel-protocol', e.target.value)}>
                      <MenuItem value="https">HTTPS</MenuItem>
                      <MenuItem value="http">HTTP</MenuItem>
                    </Select>
                  </FormControl>
                  <TextField size="small" label="Path" value={dialogData['otel-path'] || ''} onChange={e => setField('otel-path', e.target.value)} />
                </Box>
                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                  <TextField size="small" label="Timeout (s)" value={dialogData['otel-timeout'] || ''} onChange={e => setField('otel-timeout', e.target.value)} type="number" slotProps={{ htmlInput: { min: 1, max: 10 } }} />
                  <FormControlLabel control={<Checkbox checked={dialogData['otel-verify-ssl'] !== false && dialogData['otel-verify-ssl'] !== 0} onChange={e => setField('otel-verify-ssl', e.target.checked ? 1 : 0)} />} label="Verify SSL" />
                </Box>
                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                  <TextField size="small" label="Max Body Size (bytes)" value={dialogData['otel-max-body-size'] || ''} onChange={e => setField('otel-max-body-size', e.target.value)} type="number" slotProps={{ htmlInput: { min: 1024 } }} />
                  <FormControl size="small">
                    <InputLabel>Compression</InputLabel>
                    <Select value={dialogData['otel-compression'] || 'gzip'} label="Compression" onChange={e => setField('otel-compression', e.target.value)}>
                      <MenuItem value="none">None</MenuItem>
                      <MenuItem value="gzip">Gzip</MenuItem>
                    </Select>
                  </FormControl>
                </Box>
                <TextField
                  size="small"
                  multiline
                  minRows={3}
                  label="HTTP Headers (JSON)"
                  placeholder={'{\n  "Authorization": "Bearer token"\n}'}
                  value={dialogData['otel-headers'] || ''}
                  onChange={e => setField('otel-headers', e.target.value)}
                  error={isInvalidJson(dialogData['otel-headers'])}
                  helperText={isInvalidJson(dialogData['otel-headers']) ? 'Invalid JSON' : undefined}
                />
                <TextField
                  size="small"
                  multiline
                  minRows={3}
                  label="Resource Attributes (JSON)"
                  placeholder={'{\n  "environment": "production"\n}'}
                  value={dialogData['otel-resource-attributes'] || ''}
                  onChange={e => setField('otel-resource-attributes', e.target.value)}
                  error={isInvalidJson(dialogData['otel-resource-attributes'])}
                  helperText={isInvalidJson(dialogData['otel-resource-attributes']) ? 'Invalid JSON' : undefined}
                />
              </>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>{t('dcSettingsReset')}</Button>
          <Button variant="contained" onClick={handleDialogSave} disabled={dialogSaving || !dialogData.id || !dialogData.server || invalidJson}>
            {dialogSaving ? <CircularProgress size={16} /> : dialogMode === 'create' ? t('metricServerCreate') : t('dcSettingsSave')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)}>
        <DialogTitle>{t('metricServerDeleteTitle')}</DialogTitle>
        <DialogContent>
          <Typography>{t('metricServerDeleteConfirm', { name: deleteTarget?.id || '' })}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)}>{t('dcSettingsReset')}</Button>
          <Button variant="contained" color="error" onClick={handleDelete} disabled={deleting}>
            {deleting ? <CircularProgress size={16} /> : t('metricServerDelete')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
