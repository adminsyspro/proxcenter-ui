'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Box, Card, CardContent, Typography, TextField, Button, Switch,
  FormControlLabel, Alert, CircularProgress, Divider, IconButton,
  Tooltip, alpha, useTheme
} from '@mui/material'
import { useTranslations } from 'next-intl'
import { useBranding } from '@/contexts/BrandingContext'

const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB

export default function WhiteLabelTab() {
  const t = useTranslations()
  const theme = useTheme()
  const { branding, refresh } = useBranding()

  const [config, setConfig] = useState({
    enabled: false,
    appName: '',
    logoUrl: '',
    faviconUrl: '',
    loginLogoUrl: '',
    primaryColor: '',
    footerText: '',
    browserTitle: '',
    poweredByVisible: true,
    showGithubStars: true,
    showWhatsNew: true,
    showAbout: true,
    showSubscription: true,
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState('')
  const [success, setSuccess] = useState('')
  const [error, setError] = useState('')

  const logoInputRef = useRef(null)
  const faviconInputRef = useRef(null)
  const loginLogoInputRef = useRef(null)

  // Load settings
  useEffect(() => {
    fetch('/api/v1/settings/branding')
      .then(r => r.json())
      .then(data => {
        if (!data.error) setConfig(prev => ({ ...prev, ...data }))
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const handleSave = useCallback(async () => {
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      const res = await fetch('/api/v1/settings/branding', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setSuccess('Branding settings saved successfully')
      await refresh()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }, [config, refresh])

  const handleUpload = useCallback(async (file, type) => {
    if (!file) return
    if (file.size > MAX_FILE_SIZE) {
      setError('File too large (max 5MB)')
      return
    }

    setUploading(type)
    setError('')
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('type', type)

      const res = await fetch('/api/v1/settings/branding/logo', {
        method: 'POST',
        body: formData,
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)

      const urlField = type === 'favicon' ? 'faviconUrl' : type === 'loginLogo' ? 'loginLogoUrl' : 'logoUrl'
      setConfig(prev => ({ ...prev, [urlField]: data.imageUrl }))
    } catch (e) {
      setError(e.message)
    } finally {
      setUploading('')
    }
  }, [])

  const handleRemoveImage = useCallback(async (type) => {
    setError('')
    try {
      await fetch('/api/v1/settings/branding/logo', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type }),
      })
      const urlField = type === 'favicon' ? 'faviconUrl' : type === 'loginLogo' ? 'loginLogoUrl' : 'logoUrl'
      setConfig(prev => ({ ...prev, [urlField]: '' }))
    } catch (e) {
      setError(e.message)
    }
  }, [])

  const handleReset = useCallback(() => {
    setConfig({
      enabled: false,
      appName: 'ProxCenter',
      logoUrl: '',
      faviconUrl: '',
      loginLogoUrl: '',
      primaryColor: '',
      footerText: '',
      browserTitle: '',
      poweredByVisible: true,
    })
  }, [])

  if (loading) {
    return <Box sx={{ p: 4, textAlign: 'center' }}><CircularProgress size={32} /></Box>
  }

  return (
    <Box sx={{ p: 3, maxWidth: 800 }}>
      <Typography variant="h6" sx={{ mb: 0.5, fontWeight: 700 }}>
        <i className="ri-pantone-line" style={{ marginRight: 8, opacity: 0.7 }} />
        White Label / Branding
      </Typography>
      <Typography variant="body2" sx={{ mb: 3, opacity: 0.6 }}>
        Customize the application branding for your organization. Replace the logo, name, colors and footer to match your brand.
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>{success}</Alert>}

      {/* Master Switch */}
      <Card variant="outlined" sx={{ mb: 2 }}>
        <CardContent sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: 2, '&:last-child': { pb: 2 } }}>
          <Box>
            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
              <i className="ri-toggle-line" style={{ marginRight: 8, opacity: 0.7 }} />
              Enable White Label
            </Typography>
            <Typography variant="caption" sx={{ opacity: 0.6 }}>
              When enabled, your custom branding replaces the default ProxCenter branding across the entire application.
            </Typography>
          </Box>
          <Switch
            checked={config.enabled}
            onChange={e => setConfig(prev => ({ ...prev, enabled: e.target.checked }))}
          />
        </CardContent>
      </Card>

      <Box sx={{ opacity: config.enabled ? 1 : 0.4, pointerEvents: config.enabled ? 'auto' : 'none', transition: 'opacity 0.3s' }}>
      {/* Application Name */}
      <Card variant="outlined" sx={{ mb: 2 }}>
        <CardContent>
          <Typography variant="subtitle2" sx={{ mb: 2, fontWeight: 600 }}>
            <i className="ri-text" style={{ marginRight: 8, opacity: 0.7 }} />
            Application Name
          </Typography>
          <TextField
            fullWidth
            size="small"
            label="App Name"
            placeholder="ProxCenter"
            value={config.appName}
            onChange={e => setConfig(prev => ({ ...prev, appName: e.target.value }))}
            helperText="Displayed in sidebar, login page, footer, and browser title"
          />
          <TextField
            fullWidth
            size="small"
            label="Browser Tab Title"
            placeholder="PROXCENTER"
            value={config.browserTitle}
            onChange={e => setConfig(prev => ({ ...prev, browserTitle: e.target.value }))}
            sx={{ mt: 2 }}
            helperText="Text shown in the browser tab. Leave empty to use the app name."
          />
        </CardContent>
      </Card>

      {/* Logos */}
      <Card variant="outlined" sx={{ mb: 2 }}>
        <CardContent>
          <Typography variant="subtitle2" sx={{ mb: 2, fontWeight: 600 }}>
            <i className="ri-image-line" style={{ marginRight: 8, opacity: 0.7 }} />
            Logos
          </Typography>

          {/* Sidebar Logo */}
          <Box sx={{ mb: 3 }}>
            <Typography variant="body2" sx={{ mb: 1, fontWeight: 500 }}>Sidebar Logo</Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Box sx={{
                width: 120, height: 48, border: '1px dashed', borderColor: 'divider',
                borderRadius: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                bgcolor: alpha(theme.palette.background.paper, 0.5), overflow: 'hidden',
              }}>
                {config.logoUrl ? (
                  <img src={config.logoUrl} alt="Logo" style={{ maxHeight: 40, maxWidth: 110, objectFit: 'contain' }} />
                ) : (
                  <Typography variant="caption" sx={{ opacity: 0.4 }}>Default</Typography>
                )}
              </Box>
              <Button size="small" variant="outlined" onClick={() => logoInputRef.current?.click()}
                disabled={uploading === 'logo'} startIcon={uploading === 'logo' ? <CircularProgress size={14} /> : <i className="ri-upload-line" />}>
                Upload
              </Button>
              {config.logoUrl && (
                <Tooltip title="Remove">
                  <IconButton size="small" color="error" onClick={() => handleRemoveImage('logo')}>
                    <i className="ri-delete-bin-line" />
                  </IconButton>
                </Tooltip>
              )}
              <input ref={logoInputRef} type="file" hidden accept="image/png,image/jpeg,image/svg+xml,image/webp"
                onChange={e => handleUpload(e.target.files?.[0], 'logo')} />
            </Box>
            <Typography variant="caption" sx={{ opacity: 0.5, mt: 0.5, display: 'block' }}>
              Recommended: 200x50px, PNG or SVG with transparent background
            </Typography>
          </Box>

          <Divider sx={{ my: 2 }} />

          {/* Login Logo */}
          <Box sx={{ mb: 3 }}>
            <Typography variant="body2" sx={{ mb: 1, fontWeight: 500 }}>Login Page Logo</Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Box sx={{
                width: 120, height: 48, border: '1px dashed', borderColor: 'divider',
                borderRadius: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                bgcolor: alpha(theme.palette.background.paper, 0.5), overflow: 'hidden',
              }}>
                {config.loginLogoUrl ? (
                  <img src={config.loginLogoUrl} alt="Login Logo" style={{ maxHeight: 40, maxWidth: 110, objectFit: 'contain' }} />
                ) : (
                  <Typography variant="caption" sx={{ opacity: 0.4 }}>Same as sidebar</Typography>
                )}
              </Box>
              <Button size="small" variant="outlined" onClick={() => loginLogoInputRef.current?.click()}
                disabled={uploading === 'loginLogo'} startIcon={uploading === 'loginLogo' ? <CircularProgress size={14} /> : <i className="ri-upload-line" />}>
                Upload
              </Button>
              {config.loginLogoUrl && (
                <Tooltip title="Remove">
                  <IconButton size="small" color="error" onClick={() => handleRemoveImage('loginLogo')}>
                    <i className="ri-delete-bin-line" />
                  </IconButton>
                </Tooltip>
              )}
              <input ref={loginLogoInputRef} type="file" hidden accept="image/png,image/jpeg,image/svg+xml,image/webp"
                onChange={e => handleUpload(e.target.files?.[0], 'loginLogo')} />
            </Box>
            <Typography variant="caption" sx={{ opacity: 0.5, mt: 0.5, display: 'block' }}>
              Optional. If not set, the sidebar logo is used on the login page.
            </Typography>
          </Box>

          <Divider sx={{ my: 2 }} />

          {/* Favicon */}
          <Box>
            <Typography variant="body2" sx={{ mb: 1, fontWeight: 500 }}>Favicon</Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Box sx={{
                width: 40, height: 40, border: '1px dashed', borderColor: 'divider',
                borderRadius: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                bgcolor: alpha(theme.palette.background.paper, 0.5), overflow: 'hidden',
              }}>
                {config.faviconUrl ? (
                  <img src={config.faviconUrl} alt="Favicon" style={{ width: 32, height: 32, objectFit: 'contain' }} />
                ) : (
                  <Typography variant="caption" sx={{ opacity: 0.4, fontSize: 10 }}>Default</Typography>
                )}
              </Box>
              <Button size="small" variant="outlined" onClick={() => faviconInputRef.current?.click()}
                disabled={uploading === 'favicon'} startIcon={uploading === 'favicon' ? <CircularProgress size={14} /> : <i className="ri-upload-line" />}>
                Upload
              </Button>
              {config.faviconUrl && (
                <Tooltip title="Remove">
                  <IconButton size="small" color="error" onClick={() => handleRemoveImage('favicon')}>
                    <i className="ri-delete-bin-line" />
                  </IconButton>
                </Tooltip>
              )}
              <input ref={faviconInputRef} type="file" hidden accept="image/png,image/svg+xml,image/x-icon,image/vnd.microsoft.icon"
                onChange={e => handleUpload(e.target.files?.[0], 'favicon')} />
            </Box>
            <Typography variant="caption" sx={{ opacity: 0.5, mt: 0.5, display: 'block' }}>
              Recommended: 32x32px or 48x48px, PNG or ICO
            </Typography>
          </Box>
        </CardContent>
      </Card>

      {/* Primary Color */}
      <Card variant="outlined" sx={{ mb: 2 }}>
        <CardContent>
          <Typography variant="subtitle2" sx={{ mb: 2, fontWeight: 600 }}>
            <i className="ri-palette-line" style={{ marginRight: 8, opacity: 0.7 }} />
            Primary Color
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Box sx={{ position: 'relative' }}>
              <Box
                sx={{
                  width: 44, height: 44, borderRadius: 1.5,
                  border: '2px solid', borderColor: 'divider',
                  bgcolor: config.primaryColor || theme.palette.primary.main,
                  cursor: 'pointer', transition: 'box-shadow 0.2s',
                  '&:hover': { boxShadow: `0 0 0 3px ${alpha(config.primaryColor || theme.palette.primary.main, 0.3)}` },
                }}
                onClick={() => document.getElementById('branding-color-input')?.click()}
              />
              <input
                id="branding-color-input"
                type="color"
                value={config.primaryColor || theme.palette.primary.main}
                onChange={e => setConfig(prev => ({ ...prev, primaryColor: e.target.value }))}
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer' }}
              />
            </Box>
            <TextField
              size="small"
              label="Hex Color"
              placeholder="#7C4DFF"
              value={config.primaryColor}
              onChange={e => setConfig(prev => ({ ...prev, primaryColor: e.target.value }))}
              sx={{ width: 160 }}
              inputProps={{ maxLength: 7 }}
            />
            {config.primaryColor && (
              <Tooltip title="Reset to default">
                <IconButton size="small" onClick={() => setConfig(prev => ({ ...prev, primaryColor: '' }))}>
                  <i className="ri-refresh-line" />
                </IconButton>
              </Tooltip>
            )}
          </Box>
          <Typography variant="caption" sx={{ opacity: 0.5, mt: 1, display: 'block' }}>
            Overrides the primary color across the entire application (buttons, links, active states, etc.)
          </Typography>
        </CardContent>
      </Card>

      {/* Footer */}
      <Card variant="outlined" sx={{ mb: 2 }}>
        <CardContent>
          <Typography variant="subtitle2" sx={{ mb: 2, fontWeight: 600 }}>
            <i className="ri-layout-bottom-line" style={{ marginRight: 8, opacity: 0.7 }} />
            Footer
          </Typography>
          <TextField
            fullWidth
            size="small"
            label="Footer Text"
            placeholder={`© ${new Date().getFullYear()} ${config.appName || 'ProxCenter'}`}
            value={config.footerText}
            onChange={e => setConfig(prev => ({ ...prev, footerText: e.target.value }))}
            helperText="Custom footer text. Leave empty for default."
          />
          <FormControlLabel
            control={
              <Switch
                checked={config.poweredByVisible}
                onChange={e => setConfig(prev => ({ ...prev, poweredByVisible: e.target.checked }))}
              />
            }
            label={
              <Typography variant="body2">
                Show "Powered by ProxCenter" in footer
              </Typography>
            }
            sx={{ mt: 1.5 }}
          />
        </CardContent>
      </Card>

      {/* UI Elements Visibility */}
      <Card variant="outlined" sx={{ mb: 2 }}>
        <CardContent>
          <Typography variant="subtitle2" sx={{ mb: 2, fontWeight: 600 }}>
            <i className="ri-eye-off-line" style={{ marginRight: 8, opacity: 0.7 }} />
            {t('settings.whiteLabel.uiVisibility')}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t('settings.whiteLabel.uiVisibilityDesc')}
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            <FormControlLabel
              control={<Switch checked={config.showGithubStars} onChange={e => setConfig(c => ({ ...c, showGithubStars: e.target.checked }))} />}
              label={<Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}><i className="ri-github-fill" style={{ fontSize: 16, opacity: 0.6 }} /><Typography variant="body2">{t('settings.whiteLabel.showGithubStars')}</Typography></Box>}
            />
            <FormControlLabel
              control={<Switch checked={config.showWhatsNew} onChange={e => setConfig(c => ({ ...c, showWhatsNew: e.target.checked }))} />}
              label={<Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}><i className="ri-megaphone-line" style={{ fontSize: 16, opacity: 0.6 }} /><Typography variant="body2">{t('settings.whiteLabel.showWhatsNew')}</Typography></Box>}
            />
            <FormControlLabel
              control={<Switch checked={config.showAbout} onChange={e => setConfig(c => ({ ...c, showAbout: e.target.checked }))} />}
              label={<Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}><i className="ri-information-line" style={{ fontSize: 16, opacity: 0.6 }} /><Typography variant="body2">{t('settings.whiteLabel.showAbout')}</Typography></Box>}
            />
            <FormControlLabel
              control={<Switch checked={config.showSubscription} onChange={e => setConfig(c => ({ ...c, showSubscription: e.target.checked }))} />}
              label={<Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}><i className="ri-vip-crown-line" style={{ fontSize: 16, opacity: 0.6 }} /><Typography variant="body2">{t('settings.whiteLabel.showSubscription')}</Typography></Box>}
            />
          </Box>
        </CardContent>
      </Card>

      {/* Preview */}
      <Card variant="outlined" sx={{ mb: 2, bgcolor: alpha(theme.palette.primary.main, 0.03) }}>
        <CardContent>
          <Typography variant="subtitle2" sx={{ mb: 2, fontWeight: 600 }}>
            <i className="ri-eye-line" style={{ marginRight: 8, opacity: 0.7 }} />
            Preview
          </Typography>
          <Box sx={{
            p: 2, borderRadius: 1, bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider',
          }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
              {config.logoUrl ? (
                <img src={config.logoUrl} alt="" style={{ height: 28, objectFit: 'contain' }} />
              ) : (
                <Box sx={{ width: 28, height: 22, bgcolor: 'primary.main', borderRadius: 0.5, opacity: 0.7 }} />
              )}
              <Typography variant="subtitle1" sx={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                {config.appName || 'ProxCenter'}
              </Typography>
            </Box>
            <Divider sx={{ my: 1.5 }} />
            <Typography variant="caption" sx={{ opacity: 0.5 }}>
              {config.footerText || `© ${new Date().getFullYear()} ${config.appName || 'ProxCenter'}`}
              {config.poweredByVisible && config.appName && config.appName !== 'ProxCenter' && (
                <span style={{ marginLeft: 8, opacity: 0.6 }}>Powered by ProxCenter</span>
              )}
            </Typography>
          </Box>
        </CardContent>
      </Card>

      </Box>

      {/* Actions */}
      <Box sx={{ display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
        <Button variant="outlined" color="secondary" onClick={handleReset} startIcon={<i className="ri-refresh-line" />}>
          Reset to Default
        </Button>
        <Button variant="contained" onClick={handleSave} disabled={saving}
          startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <i className="ri-save-line" />}>
          Save Changes
        </Button>
      </Box>
    </Box>
  )
}
