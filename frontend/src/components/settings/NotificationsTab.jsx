'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import dynamic from 'next/dynamic'

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Collapse,
  Divider,
  FormControl,
  FormControlLabel,
  IconButton,
  InputAdornment,
  InputLabel,
  MenuItem,
  Select,
  Switch,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography
} from '@mui/material'

// Import dynamique de l'éditeur de templates
const EmailTemplateEditor = dynamic(() => import('./EmailTemplateEditor'), {
  ssr: false,
  loading: () => <Box sx={{ p: 3, textAlign: 'center' }}><CircularProgress /></Box>
})

async function fetchJson(url, init) {
  const r = await fetch(url, init)
  const text = await r.text()
  let json = null

  try {
    json = text ? JSON.parse(text) : null
  } catch {}

  if (!r.ok) throw new Error(json?.error || text || `HTTP ${r.status}`)
  
return json
}

export default function NotificationsTab() {
  const t = useTranslations()
  const [settings, setSettings] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testingConnection, setTestingConnection] = useState(false)
  const [message, setMessage] = useState(null)
  const [showPassword, setShowPassword] = useState(false)
  const [testEmail, setTestEmail] = useState('')
  const [activeTab, setActiveTab] = useState(0) // 0 = Config, 1 = Templates

  const loadSettings = async () => {
    setLoading(true)

    try {
      const data = await fetchJson('/api/v1/orchestrator/notifications/settings')

      setSettings(data)
      setMessage(null)
    } catch (err) {
      setMessage({ type: 'error', text: t('notifications.loadingError') + ' ' + err.message })
    } finally {
      setLoading(false)
    }
  }

  const saveSettings = async () => {
    setSaving(true)

    try {
      await fetchJson('/api/v1/orchestrator/notifications/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      })
      setMessage({ type: 'success', text: t('notifications.savedSuccess') })
    } catch (err) {
      setMessage({ type: 'error', text: t('notifications.saveError') + ' ' + err.message })
    } finally {
      setSaving(false)
    }
  }

  const testConnection = async () => {
    setTestingConnection(true)

    try {
      const result = await fetchJson('/api/v1/orchestrator/notifications/test-connection', {
        method: 'POST'
      })

      if (result.success) {
        setMessage({ type: 'success', text: t('notifications.smtp.connected') })
      } else {
        setMessage({ type: 'error', text: t('notifications.smtp.connectionFailed') + ' ' + result.error })
      }
    } catch (err) {
      setMessage({ type: 'error', text: t('notifications.error') + ' ' + err.message })
    } finally {
      setTestingConnection(false)
    }
  }

  const sendTestEmail = async () => {
    if (!testEmail) {
      setMessage({ type: 'warning', text: t('notifications.enterEmail') })

return
    }

    setTesting(true)

    try {
      await fetchJson('/api/v1/orchestrator/notifications/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient: testEmail })
      })
      setMessage({ type: 'success', text: t('notifications.testEmailSent', { email: testEmail }) })
    } catch (err) {
      setMessage({ type: 'error', text: t('notifications.sendFailed') + ' ' + err.message })
    } finally {
      setTesting(false)
    }
  }

  useEffect(() => {
    loadSettings()
  }, [])

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 300 }}>
        <CircularProgress />
      </Box>
    )
  }

  if (!settings) {
    return (
      <Alert severity="error">
        {t('notifications.loadErrorFull')}
      </Alert>
    )
  }

  return (
    <Box>
      {/* Onglets principaux */}
      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
        <Tabs value={activeTab} onChange={(e, v) => setActiveTab(v)}>
          <Tab 
            icon={<i className="ri-settings-3-line" />} 
            iconPosition="start" 
            label={t('notifications.configuration')} 
          />
          <Tab 
            icon={<i className="ri-palette-line" />} 
            iconPosition="start" 
            label={t('notifications.emailTemplates')} 
          />
        </Tabs>
      </Box>

      {activeTab === 1 ? (
        /* Onglet Templates */
        <EmailTemplateEditor />
      ) : (
        /* Onglet Configuration */
        <Box>
      <Typography variant='body2' sx={{ opacity: 0.7, mb: 3 }}>
        {t('notifications.description')}
      </Typography>

      {message && (
        <Alert severity={message.type} sx={{ mb: 3 }} onClose={() => setMessage(null)}>
          {message.text}
        </Alert>
      )}

      {/* Section Email SMTP */}
      <Card variant='outlined' sx={{ mb: 3 }}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
            <Typography variant='subtitle1' fontWeight={700} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <i className='ri-mail-send-line' style={{ color: '#7c3aed' }} />
              {t('notifications.smtpConfig')}
            </Typography>
            <FormControlLabel
              control={
                <Switch
                  checked={settings.email?.enabled || false}
                  onChange={e => setSettings(s => ({
                    ...s,
                    email: { ...s.email, enabled: e.target.checked }
                  }))}
                  color='primary'
                />
              }
              label={settings.email?.enabled ? t('notifications.enabled') : t('notifications.disabled')}
            />
          </Box>

          <Box sx={{ 
            display: 'grid', 
            gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, 
            gap: 2,
            opacity: settings.email?.enabled ? 1 : 0.5,
            pointerEvents: settings.email?.enabled ? 'auto' : 'none'
          }}>
            <TextField
              fullWidth
              label={t('notifications.smtp.server')}
              placeholder='smtp.example.com'
              value={settings.email?.smtp_host || ''}
              onChange={e => setSettings(s => ({
                ...s,
                email: { ...s.email, smtp_host: e.target.value }
              }))}
              InputProps={{
                startAdornment: (
                  <InputAdornment position='start'>
                    <i className='ri-server-line' style={{ opacity: 0.5 }} />
                  </InputAdornment>
                )
              }}
            />

            <TextField
              fullWidth
              type='number'
              label={t('notifications.smtp.port')}
              value={settings.email?.smtp_port || 587}
              onChange={e => setSettings(s => ({
                ...s,
                email: { ...s.email, smtp_port: parseInt(e.target.value) || 587 }
              }))}
              helperText={t('notifications.smtp.portHelper')}
            />

            <TextField
              fullWidth
              label={t('notifications.smtp.username')}
              placeholder='user@example.com'
              value={settings.email?.smtp_user || ''}
              onChange={e => setSettings(s => ({
                ...s,
                email: { ...s.email, smtp_user: e.target.value }
              }))}
            />

            <TextField
              fullWidth
              type={showPassword ? 'text' : 'password'}
              label={t('notifications.smtp.password')}
              placeholder='••••••••'
              value={settings.email?.smtp_password || ''}
              onChange={e => setSettings(s => ({
                ...s,
                email: { ...s.email, smtp_password: e.target.value }
              }))}
              InputProps={{
                endAdornment: (
                  <InputAdornment position='end'>
                    <IconButton size='small' onClick={() => setShowPassword(!showPassword)}>
                      <i className={showPassword ? 'ri-eye-off-line' : 'ri-eye-line'} />
                    </IconButton>
                  </InputAdornment>
                )
              }}
            />

            <TextField
              fullWidth
              label={t('notifications.smtp.senderEmail')}
              placeholder='noreply@proxcenter.io'
              value={settings.email?.smtp_from || ''}
              onChange={e => setSettings(s => ({
                ...s,
                email: { ...s.email, smtp_from: e.target.value }
              }))}
            />

            <TextField
              fullWidth
              label={t('notifications.smtp.senderName')}
              placeholder='ProxCenter'
              value={settings.email?.smtp_from_name || ''}
              onChange={e => setSettings(s => ({
                ...s,
                email: { ...s.email, smtp_from_name: e.target.value }
              }))}
            />
          </Box>

          {/* Options TLS */}
          <Divider sx={{ my: 2 }} />
          <Typography variant='body2' fontWeight={600} sx={{ mb: 1.5 }}>
            {t('notifications.smtp.connectionSecurity')}
          </Typography>
          <Box sx={{ 
            display: 'flex', 
            flexWrap: 'wrap', 
            gap: 2,
            opacity: settings.email?.enabled ? 1 : 0.5,
            pointerEvents: settings.email?.enabled ? 'auto' : 'none'
          }}>
            <FormControlLabel
              control={
                <Switch
                  checked={settings.email?.use_starttls ?? true}
                  onChange={e => setSettings(s => ({
                    ...s,
                    email: { ...s.email, use_starttls: e.target.checked, use_tls: false }
                  }))}
                />
              }
              label={t('notifications.smtp.starttls')}
            />
            <FormControlLabel
              control={
                <Switch
                  checked={settings.email?.use_tls || false}
                  onChange={e => setSettings(s => ({
                    ...s,
                    email: { ...s.email, use_tls: e.target.checked, use_starttls: false }
                  }))}
                />
              }
              label={t('notifications.smtp.tlsDirect')}
            />
            <FormControlLabel
              control={
                <Switch
                  checked={settings.email?.skip_verify || false}
                  onChange={e => setSettings(s => ({
                    ...s,
                    email: { ...s.email, skip_verify: e.target.checked }
                  }))}
                />
              }
              label={
                <Tooltip title={t('notifications.smtp.skipCertWarning')}>
                  <span>{t('notifications.smtp.skipCertErrors')}</span>
                </Tooltip>
              }
            />
          </Box>

          {/* Test de connexion */}
          <Divider sx={{ my: 2 }} />
          <Box sx={{ 
            display: 'flex', 
            alignItems: 'flex-end', 
            gap: 2, 
            flexWrap: 'wrap',
            opacity: settings.email?.enabled ? 1 : 0.5,
            pointerEvents: settings.email?.enabled ? 'auto' : 'none'
          }}>
            <Button
              variant='outlined'
              onClick={testConnection}
              disabled={testingConnection || !settings.email?.smtp_host}
              startIcon={testingConnection ? <CircularProgress size={16} /> : <i className='ri-link' />}
            >
              {t('notifications.smtp.testConnection')}
            </Button>

            <TextField
              size='small'
              label={t('notifications.smtp.testEmail')}
              placeholder='test@example.com'
              value={testEmail}
              onChange={e => setTestEmail(e.target.value)}
              sx={{ minWidth: 250 }}
            />

            <Button
              variant='contained'
              onClick={sendTestEmail}
              disabled={testing || !testEmail || !settings.email?.smtp_host}
              startIcon={testing ? <CircularProgress size={16} /> : <i className='ri-send-plane-line' />}
            >
              {t('notifications.smtp.sendTest')}
            </Button>
          </Box>
        </CardContent>
      </Card>

      {/* Section Destinataires */}
      <Card variant='outlined' sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant='subtitle1' fontWeight={700} sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
            <i className='ri-group-line' style={{ color: '#3b82f6' }} />
            {t('notifications.defaultRecipients')}
          </Typography>

          <TextField
            fullWidth
            label={t('notifications.emailAddresses')}
            placeholder='admin@example.com, ops@example.com'
            value={(settings.email?.default_recipients || []).join(', ')}
            onChange={e => {
              const emails = e.target.value.split(',').map(s => s.trim()).filter(Boolean)

              setSettings(s => ({
                ...s,
                email: { ...s.email, default_recipients: emails }
              }))
            }}
            helperText={t('notifications.separateByComma')}
          />

          {settings.email?.default_recipients?.length > 0 && (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 2 }}>
              {settings.email.default_recipients.map((email, idx) => (
                <Chip
                  key={idx}
                  label={email}
                  size='small'
                  onDelete={() => {
                    const newRecipients = [...settings.email.default_recipients]

                    newRecipients.splice(idx, 1)
                    setSettings(s => ({
                      ...s,
                      email: { ...s.email, default_recipients: newRecipients }
                    }))
                  }}
                />
              ))}
            </Box>
          )}
        </CardContent>
      </Card>

      {/* Section Types de notifications */}
      <Card variant='outlined' sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant='subtitle1' fontWeight={700} sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
            <i className='ri-notification-3-line' style={{ color: '#f59e0b' }} />
            {t('notifications.title')}
          </Typography>

          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: '1fr 1fr 1fr' }, gap: 1 }}>
            <FormControlLabel
              control={
                <Switch
                  checked={settings.enable_alerts ?? true}
                  onChange={e => setSettings(s => ({ ...s, enable_alerts: e.target.checked }))}
                />
              }
              label={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <i className='ri-alarm-warning-line' style={{ color: '#ef4444' }} />
                  {t('notifications.alerts')}
                </Box>
              }
            />
            <FormControlLabel
              control={
                <Switch
                  checked={settings.enable_migrations ?? true}
                  onChange={e => setSettings(s => ({ ...s, enable_migrations: e.target.checked }))}
                />
              }
              label={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <i className='ri-swap-line' style={{ color: '#3b82f6' }} />
                  {t('notifications.migrations')}
                </Box>
              }
            />
            <FormControlLabel
              control={
                <Switch
                  checked={settings.enable_backups ?? true}
                  onChange={e => setSettings(s => ({ ...s, enable_backups: e.target.checked }))}
                />
              }
              label={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <i className='ri-hard-drive-2-line' style={{ color: '#10b981' }} />
                  {t('notifications.backups')}
                </Box>
              }
            />
            <FormControlLabel
              control={
                <Switch
                  checked={settings.enable_maintenance ?? true}
                  onChange={e => setSettings(s => ({ ...s, enable_maintenance: e.target.checked }))}
                />
              }
              label={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <i className='ri-tools-line' style={{ color: '#8b5cf6' }} />
                  {t('notifications.maintenance')}
                </Box>
              }
            />
            <FormControlLabel
              control={
                <Switch
                  checked={settings.enable_reports ?? true}
                  onChange={e => setSettings(s => ({ ...s, enable_reports: e.target.checked }))}
                />
              }
              label={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <i className='ri-file-chart-line' style={{ color: '#06b6d4' }} />
                  {t('notifications.reports')}
                </Box>
              }
            />
          </Box>
        </CardContent>
      </Card>

      {/* Section Filtres */}
      <Card variant='outlined' sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant='subtitle1' fontWeight={700} sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
            <i className='ri-filter-3-line' style={{ color: '#6366f1' }} />
            {t('notifications.filtersAndLimits')}
          </Typography>

          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
            <FormControl fullWidth>
              <InputLabel>{t('notifications.minSeverity')}</InputLabel>
              <Select
                value={settings.min_severity || 'warning'}
                label={t('notifications.minSeverity')}
                onChange={e => setSettings(s => ({ ...s, min_severity: e.target.value }))}
              >
                <MenuItem value='info'>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Chip size='small' label='Info' sx={{ bgcolor: '#eff6ff', color: '#3b82f6' }} />
                    {t('notifications.allNotifications')}
                  </Box>
                </MenuItem>
                <MenuItem value='success'>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Chip size='small' label='Success' sx={{ bgcolor: '#ecfdf5', color: '#10b981' }} />
                    {t('notifications.successAndMore')}
                  </Box>
                </MenuItem>
                <MenuItem value='warning'>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Chip size='small' label='Warning' sx={{ bgcolor: '#fffbeb', color: '#f59e0b' }} />
                    {t('notifications.warningsAndCritical')}
                  </Box>
                </MenuItem>
                <MenuItem value='critical'>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Chip size='small' label='Critical' sx={{ bgcolor: '#fef2f2', color: '#ef4444' }} />
                    {t('notifications.criticalOnly')}
                  </Box>
                </MenuItem>
              </Select>
            </FormControl>

            <TextField
              fullWidth
              type='number'
              label={t('notifications.rateLimit')}
              value={settings.rate_limit_per_hour || 100}
              onChange={e => setSettings(s => ({ ...s, rate_limit_per_hour: parseInt(e.target.value) || 100 }))}
              InputProps={{
                endAdornment: <InputAdornment position='end'>emails/h</InputAdornment>
              }}
              helperText={t('notifications.rateLimitHelper')}
            />
          </Box>
        </CardContent>
      </Card>

      {/* Boutons de sauvegarde */}
      <Card variant='outlined'>
        <CardContent>
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
            <Button
              variant='contained'
              onClick={saveSettings}
              disabled={saving}
              startIcon={saving ? <CircularProgress size={16} /> : <i className='ri-save-line' />}
            >
              {saving ? t('common.saving') : t('common.save')}
            </Button>

            <Button
              variant='outlined'
              onClick={loadSettings}
              disabled={saving}
              startIcon={<i className='ri-refresh-line' />}
            >
              {t('common.reset')}
            </Button>
          </Box>
        </CardContent>
      </Card>
        </Box>
      )}
    </Box>
  )
}
