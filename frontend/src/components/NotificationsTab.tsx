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

interface Target {
  name: string
  type: string
  comment?: string
  disable?: boolean | number
  [key: string]: any
}

interface Matcher {
  name: string
  comment?: string
  disable?: boolean | number
  [key: string]: any
}

interface Props {
  connectionId: string
}

const TYPE_ICONS: Record<string, string> = {
  smtp: 'ri-mail-send-line',
  sendmail: 'ri-mail-line',
  gotify: 'ri-notification-3-line',
  webhook: 'ri-webhook-line',
}

export default function NotificationsTab({ connectionId }: Props) {
  const t = useTranslations('inventory')
  const theme = useTheme()
  const toast = useToast()

  const [loading, setLoading] = useState(true)
  const [targets, setTargets] = useState<Target[]>([])
  const [matchers, setMatchers] = useState<Matcher[]>([])
  const [error, setError] = useState<string | null>(null)

  // Target dialog
  const [targetDialogOpen, setTargetDialogOpen] = useState(false)
  const [targetDialogMode, setTargetDialogMode] = useState<'create' | 'edit'>('create')
  const [targetDialogType, setTargetDialogType] = useState('smtp')
  const [targetData, setTargetData] = useState<Record<string, any>>({})
  const [targetSaving, setTargetSaving] = useState(false)

  // Matcher dialog
  const [matcherDialogOpen, setMatcherDialogOpen] = useState(false)
  const [matcherDialogMode, setMatcherDialogMode] = useState<'create' | 'edit'>('create')
  const [matcherData, setMatcherData] = useState<Record<string, any>>({})
  const [matcherSaving, setMatcherSaving] = useState(false)

  // Delete
  const [deleteDialog, setDeleteDialog] = useState<{ type: 'target' | 'matcher'; item: any } | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Add menu
  const [addMenuAnchor, setAddMenuAnchor] = useState<null | HTMLElement>(null)

  const base = `/api/v1/connections/${encodeURIComponent(connectionId)}/cluster/notifications`

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [targetsRes, matchersRes] = await Promise.all([
        fetch(`${base}/targets`, { cache: 'no-store' }),
        fetch(`${base}/matchers`, { cache: 'no-store' }),
      ])
      if (!targetsRes.ok) throw new Error(`Targets: HTTP ${targetsRes.status}`)
      if (!matchersRes.ok) throw new Error(`Matchers: HTTP ${matchersRes.status}`)
      const [targetsJson, matchersJson] = await Promise.all([targetsRes.json(), matchersRes.json()])
      setTargets(targetsJson?.data || [])
      setMatchers(matchersJson?.data || [])
    } catch (e: any) {
      setError(e?.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [base])

  useEffect(() => { fetchData() }, [fetchData])

  /* ---- Target CRUD ---- */

  const openCreateTarget = (type: string) => {
    setAddMenuAnchor(null)
    setTargetDialogMode('create')
    setTargetDialogType(type)
    const defaults: Record<string, any> = { disable: 0 }
    if (type === 'smtp') { defaults.port = 465; defaults.encryption = 'tls' }
    setTargetData(defaults)
    setTargetDialogOpen(true)
  }

  const openEditTarget = (target: Target) => {
    setTargetDialogMode('edit')
    setTargetDialogType(target.type || 'smtp')
    setTargetData({ ...target })
    setTargetDialogOpen(true)
  }

  const handleTargetSave = async () => {
    setTargetSaving(true)
    try {
      const name = targetData.name
      const type = targetDialogType
      if (!name) throw new Error('Name is required')

      if (targetDialogMode === 'create') {
        const res = await fetch(`${base}/endpoints/${encodeURIComponent(type)}/${encodeURIComponent(name)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(targetData),
        })
        if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `HTTP ${res.status}`) }
        toast.success(t('notifTargetCreated'))
      } else {
        const { name: _, type: __, ...params } = targetData
        const res = await fetch(`${base}/endpoints/${encodeURIComponent(type)}/${encodeURIComponent(name)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(params),
        })
        if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `HTTP ${res.status}`) }
        toast.success(t('notifTargetUpdated'))
      }
      setTargetDialogOpen(false)
      await fetchData()
    } catch (e: any) {
      toast.error(e?.message || 'Error')
    } finally {
      setTargetSaving(false)
    }
  }

  /* ---- Matcher CRUD ---- */

  const openCreateMatcher = () => {
    setMatcherDialogMode('create')
    setMatcherData({ disable: 0 })
    setMatcherDialogOpen(true)
  }

  const openEditMatcher = (matcher: Matcher) => {
    setMatcherDialogMode('edit')
    setMatcherData({ ...matcher })
    setMatcherDialogOpen(true)
  }

  const handleMatcherSave = async () => {
    setMatcherSaving(true)
    try {
      const name = matcherData.name
      if (!name) throw new Error('Name is required')

      if (matcherDialogMode === 'create') {
        const res = await fetch(`${base}/matchers`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(matcherData),
        })
        if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `HTTP ${res.status}`) }
        toast.success(t('notifMatcherCreated'))
      } else {
        const { name: _, ...params } = matcherData
        const res = await fetch(`${base}/matchers/${encodeURIComponent(name)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(params),
        })
        if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `HTTP ${res.status}`) }
        toast.success(t('notifMatcherUpdated'))
      }
      setMatcherDialogOpen(false)
      await fetchData()
    } catch (e: any) {
      toast.error(e?.message || 'Error')
    } finally {
      setMatcherSaving(false)
    }
  }

  /* ---- Delete ---- */

  const handleDelete = async () => {
    if (!deleteDialog) return
    setDeleting(true)
    try {
      let url: string
      if (deleteDialog.type === 'target') {
        const tgt = deleteDialog.item as Target
        url = `${base}/endpoints/${encodeURIComponent(tgt.type)}/${encodeURIComponent(tgt.name)}`
      } else {
        url = `${base}/matchers/${encodeURIComponent(deleteDialog.item.name)}`
      }
      const res = await fetch(url, { method: 'DELETE' })
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `HTTP ${res.status}`) }
      toast.success(deleteDialog.type === 'target' ? t('notifTargetDeleted') : t('notifMatcherDeleted'))
      setDeleteDialog(null)
      await fetchData()
    } catch (e: any) {
      toast.error(e?.message || 'Error')
    } finally {
      setDeleting(false)
    }
  }

  const setTargetField = (key: string, value: any) => setTargetData(prev => ({ ...prev, [key]: value }))
  const setMatcherField = (key: string, value: any) => setMatcherData(prev => ({ ...prev, [key]: value }))

  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', p: 6 }}><CircularProgress size={32} /></Box>
  if (error) return <Box sx={{ p: 2 }}><Alert severity="error">{error}</Alert></Box>

  return (
    <Box sx={{ p: 2, overflow: 'auto' }}>
      <Stack spacing={3}>
        {/* ===== Notification Targets ===== */}
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
            <i className="ri-notification-3-line" style={{ fontSize: 18, color: theme.palette.primary.main }} />
            <Typography variant="subtitle1" fontWeight={700}>{t('notifTargetsTitle')}</Typography>
          </Box>

          <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
            <Button variant="contained" size="small" startIcon={<i className="ri-add-line" />} onClick={e => setAddMenuAnchor(e.currentTarget)}>
              {t('notifTargetAdd')}
            </Button>
            <Menu anchorEl={addMenuAnchor} open={Boolean(addMenuAnchor)} onClose={() => setAddMenuAnchor(null)}>
              {['smtp', 'sendmail', 'gotify', 'webhook'].map(type => (
                <MenuItem key={type} onClick={() => openCreateTarget(type)}>
                  <ListItemIcon><i className={TYPE_ICONS[type]} style={{ fontSize: 18 }} /></ListItemIcon>
                  <ListItemText>{type.charAt(0).toUpperCase() + type.slice(1)}</ListItemText>
                </MenuItem>
              ))}
            </Menu>
          </Box>

          <Card variant="outlined">
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 700 }} align="center">{t('notifEnabled')}</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>{t('notifTargetName')}</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>{t('notifTargetType')}</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>{t('notifComment')}</TableCell>
                    <TableCell sx={{ fontWeight: 700 }} align="right">{t('metricServerActions')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {targets.length === 0 && (
                    <TableRow><TableCell colSpan={5} align="center" sx={{ py: 4, opacity: 0.5 }}>{t('notifTargetsEmpty')}</TableCell></TableRow>
                  )}
                  {targets.map(tgt => (
                    <TableRow key={`${tgt.type}-${tgt.name}`} hover>
                      <TableCell align="center">
                        <i className={tgt.disable ? 'ri-close-line' : 'ri-check-line'} style={{ fontSize: 16, color: tgt.disable ? theme.palette.error.main : theme.palette.success.main }} />
                      </TableCell>
                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <i className={TYPE_ICONS[tgt.type] || 'ri-mail-line'} style={{ fontSize: 16, opacity: 0.6 }} />
                          {tgt.name}
                        </Box>
                      </TableCell>
                      <TableCell>{tgt.type}</TableCell>
                      <TableCell sx={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tgt.comment || '-'}</TableCell>
                      <TableCell align="right">
                        <IconButton size="small" onClick={() => openEditTarget(tgt)}><i className="ri-pencil-line" style={{ fontSize: 16 }} /></IconButton>
                        <IconButton size="small" color="error" onClick={() => setDeleteDialog({ type: 'target', item: tgt })}><i className="ri-delete-bin-line" style={{ fontSize: 16 }} /></IconButton>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Card>
        </Box>

        {/* ===== Notification Matchers ===== */}
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
            <i className="ri-filter-3-line" style={{ fontSize: 18, color: theme.palette.primary.main }} />
            <Typography variant="subtitle1" fontWeight={700}>{t('notifMatchersTitle')}</Typography>
          </Box>

          <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
            <Button variant="contained" size="small" startIcon={<i className="ri-add-line" />} onClick={openCreateMatcher}>
              {t('notifMatcherAdd')}
            </Button>
          </Box>

          <Card variant="outlined">
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 700 }} align="center">{t('notifEnabled')}</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>{t('notifMatcherName')}</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>{t('notifComment')}</TableCell>
                    <TableCell sx={{ fontWeight: 700 }} align="right">{t('metricServerActions')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {matchers.length === 0 && (
                    <TableRow><TableCell colSpan={4} align="center" sx={{ py: 4, opacity: 0.5 }}>{t('notifMatchersEmpty')}</TableCell></TableRow>
                  )}
                  {matchers.map(m => (
                    <TableRow key={m.name} hover>
                      <TableCell align="center">
                        <i className={m.disable ? 'ri-close-line' : 'ri-check-line'} style={{ fontSize: 16, color: m.disable ? theme.palette.error.main : theme.palette.success.main }} />
                      </TableCell>
                      <TableCell>{m.name}</TableCell>
                      <TableCell sx={{ maxWidth: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.comment || '-'}</TableCell>
                      <TableCell align="right">
                        <IconButton size="small" onClick={() => openEditMatcher(m)}><i className="ri-pencil-line" style={{ fontSize: 16 }} /></IconButton>
                        <IconButton size="small" color="error" onClick={() => setDeleteDialog({ type: 'matcher', item: m })}><i className="ri-delete-bin-line" style={{ fontSize: 16 }} /></IconButton>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Card>
        </Box>
      </Stack>

      {/* ===== Target Create/Edit Dialog ===== */}
      <Dialog open={targetDialogOpen} onClose={() => setTargetDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <i className={TYPE_ICONS[targetDialogType] || 'ri-mail-line'} style={{ fontSize: 20 }} />
          {targetDialogMode === 'create' ? `${t('notifTargetAdd')}: ${targetDialogType.charAt(0).toUpperCase() + targetDialogType.slice(1)}` : `${t('notifTargetEdit')}: ${targetData.name || ''}`}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Box sx={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 2 }}>
              <TextField size="small" label={t('notifTargetName')} value={targetData.name || ''} onChange={e => setTargetField('name', e.target.value)} disabled={targetDialogMode === 'edit'} required />
              <FormControlLabel control={<Checkbox checked={!targetData.disable} onChange={e => setTargetField('disable', e.target.checked ? 0 : 1)} />} label={t('notifEnabled')} />
            </Box>

            {/* SMTP */}
            {targetDialogType === 'smtp' && (
              <>
                <Box sx={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 2 }}>
                  <TextField size="small" label={t('notifSmtpServer')} value={targetData.server || ''} onChange={e => setTargetField('server', e.target.value)} required />
                  <TextField size="small" label={t('notifSmtpPort')} value={targetData.port || ''} onChange={e => setTargetField('port', e.target.value)} type="number" />
                </Box>
                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                  <FormControl size="small">
                    <InputLabel>{t('notifSmtpEncryption')}</InputLabel>
                    <Select value={targetData.encryption || 'tls'} label={t('notifSmtpEncryption')} onChange={e => setTargetField('encryption', e.target.value)}>
                      <MenuItem value="tls">TLS</MenuItem>
                      <MenuItem value="starttls">STARTTLS</MenuItem>
                      <MenuItem value="insecure">None</MenuItem>
                    </Select>
                  </FormControl>
                  <FormControlLabel control={<Checkbox checked={!!targetData.authentication} onChange={e => setTargetField('authentication', e.target.checked ? 1 : 0)} />} label={t('notifSmtpAuth')} />
                </Box>
                {targetData.authentication ? (
                  <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                    <TextField size="small" label={t('notifSmtpUsername')} value={targetData.username || ''} onChange={e => setTargetField('username', e.target.value)} />
                    <TextField size="small" label={t('notifSmtpPassword')} value={targetData.password || ''} onChange={e => setTargetField('password', e.target.value)} type="password" />
                  </Box>
                ) : null}
                <TextField size="small" label={t('notifSmtpFrom')} value={targetData['from-address'] || ''} onChange={e => setTargetField('from-address', e.target.value)} required />
                <TextField size="small" label={t('notifSmtpTo')} value={targetData.mailto || ''} onChange={e => setTargetField('mailto', e.target.value)} placeholder="user@example.com" required />
                <TextField size="small" label={t('notifSmtpToUser')} value={targetData['mailto-user'] || ''} onChange={e => setTargetField('mailto-user', e.target.value)} placeholder="root@pam" />
                <TextField size="small" label={t('notifAuthor')} value={targetData.author || ''} onChange={e => setTargetField('author', e.target.value)} placeholder="Proxmox VE" />
                <TextField size="small" label={t('notifComment')} value={targetData.comment || ''} onChange={e => setTargetField('comment', e.target.value)} multiline minRows={2} />
              </>
            )}

            {/* Sendmail */}
            {targetDialogType === 'sendmail' && (
              <>
                <TextField size="small" label={t('notifSmtpTo')} value={targetData.mailto || ''} onChange={e => setTargetField('mailto', e.target.value)} required />
                <TextField size="small" label={t('notifSmtpToUser')} value={targetData['mailto-user'] || ''} onChange={e => setTargetField('mailto-user', e.target.value)} placeholder="root@pam" />
                <TextField size="small" label={t('notifAuthor')} value={targetData.author || ''} onChange={e => setTargetField('author', e.target.value)} placeholder="Proxmox VE" />
                <TextField size="small" label={t('notifSmtpFrom')} value={targetData['from-address'] || ''} onChange={e => setTargetField('from-address', e.target.value)} placeholder="Defaults to datacenter configuration, or root@$hostname" />
                <TextField size="small" label={t('notifComment')} value={targetData.comment || ''} onChange={e => setTargetField('comment', e.target.value)} multiline minRows={2} />
              </>
            )}

            {/* Gotify */}
            {targetDialogType === 'gotify' && (
              <>
                <TextField size="small" label={t('notifGotifyServer')} value={targetData.server || ''} onChange={e => setTargetField('server', e.target.value)} placeholder="https://gotify.example.com" required />
                <TextField size="small" label={t('notifGotifyToken')} value={targetData.token || ''} onChange={e => setTargetField('token', e.target.value)} required />
                <TextField size="small" label={t('notifComment')} value={targetData.comment || ''} onChange={e => setTargetField('comment', e.target.value)} multiline minRows={2} />
              </>
            )}

            {/* Webhook */}
            {targetDialogType === 'webhook' && (
              <>
                <Box sx={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 2 }}>
                  <FormControl size="small">
                    <InputLabel>Method</InputLabel>
                    <Select value={targetData.method || 'POST'} label="Method" onChange={e => setTargetField('method', e.target.value)}>
                      <MenuItem value="POST">POST</MenuItem>
                      <MenuItem value="PUT">PUT</MenuItem>
                      <MenuItem value="GET">GET</MenuItem>
                    </Select>
                  </FormControl>
                  <TextField size="small" label="URL" value={targetData.url || ''} onChange={e => setTargetField('url', e.target.value)} placeholder="https://example.com/webhook" required />
                </Box>
                <TextField size="small" label={t('notifWebhookHeaders')} value={targetData.header || ''} onChange={e => setTargetField('header', e.target.value)} placeholder="Content-Type: application/json" multiline minRows={2} helperText="One header per line" />
                <TextField size="small" label={t('notifWebhookBody')} value={targetData.body || ''} onChange={e => setTargetField('body', e.target.value)} multiline minRows={3} placeholder='{"text": "{{message}}"}' />
                <TextField size="small" label={t('notifComment')} value={targetData.comment || ''} onChange={e => setTargetField('comment', e.target.value)} multiline minRows={2} />
              </>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTargetDialogOpen(false)}>{t('dcSettingsReset')}</Button>
          <Button variant="contained" onClick={handleTargetSave} disabled={targetSaving || !targetData.name}>
            {targetSaving ? <CircularProgress size={16} /> : targetDialogMode === 'create' ? t('notifTargetAdd') : t('dcSettingsSave')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ===== Matcher Create/Edit Dialog ===== */}
      <Dialog open={matcherDialogOpen} onClose={() => setMatcherDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>
          {matcherDialogMode === 'create' ? t('notifMatcherAdd') : `${t('notifMatcherEdit')}: ${matcherData.name || ''}`}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Box sx={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 2 }}>
              <TextField size="small" label={t('notifMatcherName')} value={matcherData.name || ''} onChange={e => setMatcherField('name', e.target.value)} disabled={matcherDialogMode === 'edit'} required />
              <FormControlLabel control={<Checkbox checked={!matcherData.disable} onChange={e => setMatcherField('disable', e.target.checked ? 0 : 1)} />} label={t('notifEnabled')} />
            </Box>
            <TextField size="small" label={t('notifMatcherTarget')} value={matcherData.target || ''} onChange={e => setMatcherField('target', e.target.value)} placeholder="target-name" />
            <TextField size="small" label={t('notifMatcherMatchSeverity')} value={matcherData['match-severity'] || ''} onChange={e => setMatcherField('match-severity', e.target.value)} placeholder="info,notice,warning,error" />
            <TextField size="small" label={t('notifMatcherMatchField')} value={matcherData['match-field'] || ''} onChange={e => setMatcherField('match-field', e.target.value)} placeholder="exact:field=value or regex:field=pattern" />
            <TextField size="small" label={t('notifMatcherMatchCalendar')} value={matcherData['match-calendar'] || ''} onChange={e => setMatcherField('match-calendar', e.target.value)} placeholder="8-17" />
            <TextField size="small" label={t('notifComment')} value={matcherData.comment || ''} onChange={e => setMatcherField('comment', e.target.value)} multiline minRows={2} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setMatcherDialogOpen(false)}>{t('dcSettingsReset')}</Button>
          <Button variant="contained" onClick={handleMatcherSave} disabled={matcherSaving || !matcherData.name}>
            {matcherSaving ? <CircularProgress size={16} /> : matcherDialogMode === 'create' ? t('notifMatcherAdd') : t('dcSettingsSave')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ===== Delete Confirmation ===== */}
      <Dialog open={Boolean(deleteDialog)} onClose={() => setDeleteDialog(null)}>
        <DialogTitle>{t('notifDeleteTitle')}</DialogTitle>
        <DialogContent>
          <Typography>{t('notifDeleteConfirm', { name: deleteDialog?.item?.name || '' })}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialog(null)}>{t('dcSettingsReset')}</Button>
          <Button variant="contained" color="error" onClick={handleDelete} disabled={deleting}>
            {deleting ? <CircularProgress size={16} /> : t('notifDelete')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
