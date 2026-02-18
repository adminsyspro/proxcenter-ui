// src/components/settings/ConnectionDialog.tsx
// Dialog pour ajouter/modifier une connexion PVE/PBS avec support SSH
'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'

import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  IconButton,
  InputAdornment,
  InputLabel,
  MenuItem,
  Select,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'

export type ConnectionFormData = {
  name: string
  baseUrl: string
  uiUrl: string
  insecureTLS: boolean
  hasCeph: boolean
  apiToken: string
  // Location fields
  latitude: string
  longitude: string
  locationLabel: string
  // SSH fields
  sshEnabled: boolean
  sshPort: number
  sshUser: string
  sshAuthMethod: 'key' | 'password' | ''
  sshKey: string
  sshPassphrase: string
  sshPassword: string
}

type ConnectionDialogProps = {
  open: boolean
  onClose: () => void
  onSave: (data: ConnectionFormData) => Promise<void>
  type: 'pve' | 'pbs'
  initialData?: Partial<ConnectionFormData> & { 
    id?: string
    sshKeyConfigured?: boolean
    sshPassConfigured?: boolean 
  }
  mode?: 'create' | 'edit'
}

const defaultFormData: ConnectionFormData = {
  name: '',
  baseUrl: '',
  uiUrl: '',
  insecureTLS: true,
  hasCeph: false,
  apiToken: '',
  latitude: '',
  longitude: '',
  locationLabel: '',
  sshEnabled: false,
  sshPort: 22,
  sshUser: 'root',
  sshAuthMethod: '',
  sshKey: '',
  sshPassphrase: '',
  sshPassword: '',
}

export default function ConnectionDialog({
  open,
  onClose,
  onSave,
  type,
  initialData,
  mode = 'create'
}: ConnectionDialogProps) {
  const t = useTranslations()
  const [form, setForm] = useState<ConnectionFormData>(defaultFormData)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showSshKey, setShowSshKey] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  
  // Test SSH
  const [testingSSH, setTestingSSH] = useState(false)
  const [sshTestResult, setSshTestResult] = useState<{
    success: boolean
    nodes?: { node: string; ip: string; status: string; error?: string }[]
    error?: string
  } | null>(null)

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      if (initialData) {
        setForm({
          ...defaultFormData,
          ...initialData,
          // Ne pas pré-remplir les secrets en mode edit
          apiToken: '',
          sshKey: '',
          sshPassphrase: '',
          sshPassword: '',
          sshAuthMethod: initialData.sshAuthMethod || '',
          // Location: convert numbers to strings for text fields
          latitude: initialData.latitude != null ? String(initialData.latitude) : '',
          longitude: initialData.longitude != null ? String(initialData.longitude) : '',
          locationLabel: initialData.locationLabel || '',
        })
      } else {
        setForm(defaultFormData)
      }
      setError(null)
      setSshTestResult(null)
    }
  }, [open, initialData])

  const handleChange = (field: keyof ConnectionFormData, value: any) => {
    setForm(prev => ({ ...prev, [field]: value }))
    setError(null)
  }

  const handleSshEnabledChange = (enabled: boolean) => {
    setForm(prev => ({
      ...prev,
      sshEnabled: enabled,
      // Reset SSH fields when disabled
      ...(enabled ? {} : {
        sshAuthMethod: '',
        sshKey: '',
        sshPassphrase: '',
        sshPassword: '',
      })
    }))
    setSshTestResult(null)
  }

  const handleSshAuthMethodChange = (method: 'key' | 'password' | '') => {
    setForm(prev => ({
      ...prev,
      sshAuthMethod: method,
      // Clear the other method's fields
      sshKey: method === 'key' ? prev.sshKey : '',
      sshPassphrase: method === 'key' ? prev.sshPassphrase : '',
      sshPassword: method === 'password' ? prev.sshPassword : '',
    }))
    setSshTestResult(null)
  }

  const handleTestSSH = async () => {
    if (!initialData?.id) return
    
    setTestingSSH(true)
    setSshTestResult(null)
    
    try {
      const res = await fetch(`/api/v1/connections/${initialData.id}/test-ssh`, {
        method: 'POST'
      })
      
      const json = await res.json()
      
      if (res.ok) {
        setSshTestResult(json)
      } else {
        setSshTestResult({ success: false, error: json.error || 'Test failed' })
      }
    } catch (e: any) {
      setSshTestResult({ success: false, error: e.message || 'Connection error' })
    } finally {
      setTestingSSH(false)
    }
  }

  const handleSave = async () => {
    // Validation
    if (!form.name.trim()) {
      setError(t('settings.errorNameRequired'))
      return
    }
    
    if (!form.baseUrl.trim()) {
      setError(t('settings.errorUrlRequired'))
      return
    }
    
    if (mode === 'create' && !form.apiToken.trim()) {
      setError(t('settings.errorTokenRequired'))
      return
    }

    // SSH Validation
    if (form.sshEnabled) {
      if (!form.sshAuthMethod) {
        setError(t('settings.errorSshAuthMethodRequired'))
        return
      }
      
      if (form.sshAuthMethod === 'key' && !form.sshKey.trim() && !initialData?.sshKeyConfigured) {
        setError(t('settings.errorSshKeyRequired'))
        return
      }
      
      if (form.sshAuthMethod === 'password' && !form.sshPassword.trim() && !initialData?.sshPassConfigured) {
        setError(t('settings.errorSshPasswordRequired'))
        return
      }
    }

    setSaving(true)
    setError(null)
    
    try {
      await onSave(form)
      onClose()
    } catch (e: any) {
      setError(e.message || 'Error saving connection')
    } finally {
      setSaving(false)
    }
  }

  const isPbs = type === 'pbs'
  const port = isPbs ? '8007' : '8006'
  const isEdit = mode === 'edit'

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        {isPbs ? (
          <><i className="ri-hard-drive-2-line" /> {isEdit ? t('settings.editPbsServer') : t('settings.addPbsServer')}</>
        ) : (
          <><i className="ri-server-line" /> {isEdit ? t('settings.editPveServer') : t('settings.addPveServer')}</>
        )}
      </DialogTitle>
      
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2, mt: 1 }}>
            {error}
          </Alert>
        )}

        {/* Section: Informations générales */}
        <Typography variant="subtitle2" sx={{ mt: 1, mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
          <i className="ri-information-line" />
          {t('settings.generalInfo')}
        </Typography>

        <Alert severity="info" sx={{ mb: 2 }}>
          <span dangerouslySetInnerHTML={{ __html: isPbs ? t('settings.pbsPortInfo') : t('settings.pvePortInfo') }} />
        </Alert>

        <TextField
          fullWidth
          label={t('settings.connectionNameLabel')}
          value={form.name}
          onChange={e => handleChange('name', e.target.value)}
          sx={{ mt: 1 }}
          required
        />

        <TextField
          fullWidth
          label={t('settings.baseUrlLabel', { port })}
          value={form.baseUrl}
          onChange={e => handleChange('baseUrl', e.target.value)}
          placeholder={t('settings.baseUrlPlaceholder', { port })}
          sx={{ mt: 2 }}
          required
        />

        <TextField
          fullWidth
          label={t('settings.webInterfaceUrl')}
          value={form.uiUrl}
          onChange={e => handleChange('uiUrl', e.target.value)}
          helperText={t('settings.webInterfaceUrlHelper')}
          sx={{ mt: 2 }}
        />

        <FormControlLabel
          sx={{ mt: 2 }}
          control={
            <Switch
              checked={form.insecureTLS}
              onChange={e => handleChange('insecureTLS', e.target.checked)}
            />
          }
          label={t('settings.ignoreTlsErrors')}
        />

        {!isPbs && (
          <FormControlLabel
            sx={{ mt: 1, display: 'block' }}
            control={
              <Switch
                checked={form.hasCeph}
                onChange={e => handleChange('hasCeph', e.target.checked)}
              />
            }
            label={t('settings.clusterUsesCeph')}
          />
        )}

        <Divider sx={{ my: 3 }} />

        {/* Section: Authentification API */}
        <Typography variant="subtitle2" sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
          <i className="ri-key-2-line" />
          {t('settings.apiAuthentication')}
        </Typography>

        <TextField
          fullWidth
          label={t('settings.apiToken')}
          value={form.apiToken}
          onChange={e => handleChange('apiToken', e.target.value)}
          placeholder={isPbs ? "user@realm!tokenid:xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" : "user@realm!tokenid=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"}
          helperText={isEdit ? t('settings.apiTokenHelperEdit') : t(isPbs ? 'settings.pbsApiTokenHelper' : 'settings.apiTokenHelper')}
          sx={{ mt: 1 }}
          required={!isEdit}
        />

        <Divider sx={{ my: 3 }} />

        {/* Section: Accès SSH (optionnel) */}
        <Typography variant="subtitle2" sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
          <i className="ri-terminal-line" />
          {t('settings.sshAccess')}
          <Chip label={t('common.optional')} size="small" variant="outlined" sx={{ ml: 1 }} />
        </Typography>

        <Alert severity="info" sx={{ mb: 2 }}>
          <Typography variant="body2">
            {t('settings.sshInfo')}
          </Typography>
          <Box sx={{ mt: 1 }}>
            <Typography variant="caption" color="text.secondary">
              {t('settings.sshFeatures')}:
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, mt: 0.5, flexWrap: 'wrap' }}>
              <Chip label="Rolling Upgrade" size="small" icon={<i className="ri-refresh-line" style={{ fontSize: 14 }} />} />
              <Chip label="Node Shell" size="small" icon={<i className="ri-terminal-box-line" style={{ fontSize: 14 }} />} />
              <Chip label="SMBIOS Config" size="small" icon={<i className="ri-settings-3-line" style={{ fontSize: 14 }} />} />
            </Box>
          </Box>
        </Alert>

        <FormControlLabel
          control={
            <Switch
              checked={form.sshEnabled}
              onChange={e => handleSshEnabledChange(e.target.checked)}
            />
          }
          label={t('settings.enableSshAccess')}
        />

        <Collapse in={form.sshEnabled}>
          <Box sx={{ mt: 2, pl: 2, borderLeft: '2px solid', borderColor: 'divider' }}>
            <Box sx={{ display: 'flex', gap: 2 }}>
              <TextField
                label={t('settings.sshPort')}
                type="number"
                value={form.sshPort}
                onChange={e => handleChange('sshPort', parseInt(e.target.value) || 22)}
                sx={{ width: 120 }}
                InputProps={{
                  inputProps: { min: 1, max: 65535 }
                }}
              />
              
              <TextField
                label={t('settings.sshUser')}
                value={form.sshUser}
                onChange={e => handleChange('sshUser', e.target.value)}
                sx={{ flex: 1 }}
                placeholder="root"
              />
            </Box>

            <FormControl fullWidth sx={{ mt: 2 }}>
              <InputLabel>{t('settings.sshAuthMethod')}</InputLabel>
              <Select
                value={form.sshAuthMethod}
                onChange={e => handleSshAuthMethodChange(e.target.value as 'key' | 'password' | '')}
                label={t('settings.sshAuthMethod')}
              >
                <MenuItem value="key">
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <i className="ri-key-line" />
                    {t('settings.sshPrivateKey')}
                  </Box>
                </MenuItem>
                <MenuItem value="password">
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <i className="ri-lock-password-line" />
                    {t('settings.sshPasswordAuth')}
                  </Box>
                </MenuItem>
              </Select>
            </FormControl>

            {/* SSH Key fields */}
            <Collapse in={form.sshAuthMethod === 'key'}>
              <Box sx={{ mt: 2 }}>
                <TextField
                  fullWidth
                  label={t('settings.sshPrivateKey')}
                  value={form.sshKey}
                  onChange={e => handleChange('sshKey', e.target.value)}
                  multiline
                  rows={4}
                  placeholder="-----BEGIN OPENSSH PRIVATE KEY-----&#10;...&#10;-----END OPENSSH PRIVATE KEY-----"
                  helperText={
                    initialData?.sshKeyConfigured 
                      ? t('settings.sshKeyConfiguredHint')
                      : t('settings.sshKeyHint')
                  }
                  InputProps={{
                    sx: { fontFamily: 'monospace', fontSize: '0.85rem' },
                    endAdornment: (
                      <InputAdornment position="end" sx={{ alignSelf: 'flex-start', mt: 1 }}>
                        <Tooltip title={showSshKey ? t('common.hide') : t('common.show')}>
                          <IconButton onClick={() => setShowSshKey(!showSshKey)} size="small">
                            <i className={showSshKey ? "ri-eye-off-line" : "ri-eye-line"} />
                          </IconButton>
                        </Tooltip>
                      </InputAdornment>
                    )
                  }}
                  type={showSshKey ? 'text' : 'password'}
                />
                
                <TextField
                  fullWidth
                  label={t('settings.sshPassphrase')}
                  value={form.sshPassphrase}
                  onChange={e => handleChange('sshPassphrase', e.target.value)}
                  type="password"
                  helperText={t('settings.sshPassphraseHint')}
                  sx={{ mt: 2 }}
                />
              </Box>
            </Collapse>

            {/* SSH Password field */}
            <Collapse in={form.sshAuthMethod === 'password'}>
              <Box sx={{ mt: 2 }}>
                <Alert severity="warning" sx={{ mb: 2 }}>
                  {t('settings.sshPasswordWarning')}
                </Alert>
                
                <TextField
                  fullWidth
                  label={t('settings.sshPassword')}
                  value={form.sshPassword}
                  onChange={e => handleChange('sshPassword', e.target.value)}
                  type={showPassword ? 'text' : 'password'}
                  helperText={
                    initialData?.sshPassConfigured 
                      ? t('settings.sshPasswordConfiguredHint')
                      : undefined
                  }
                  InputProps={{
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton onClick={() => setShowPassword(!showPassword)} size="small">
                          <i className={showPassword ? "ri-eye-off-line" : "ri-eye-line"} />
                        </IconButton>
                      </InputAdornment>
                    )
                  }}
                />
              </Box>
            </Collapse>

            {/* Test SSH Button (only in edit mode with existing connection) */}
            {isEdit && initialData?.id && form.sshEnabled && (
              <Box sx={{ mt: 2 }}>
                <Button
                  variant="outlined"
                  onClick={handleTestSSH}
                  disabled={testingSSH}
                  startIcon={testingSSH ? <CircularProgress size={16} /> : <i className="ri-plug-line" />}
                >
                  {t('settings.testSshConnection')}
                </Button>

                {sshTestResult && (
                  <Box sx={{ mt: 2 }}>
                    {sshTestResult.success ? (
                      <Alert severity="success">
                        <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>
                          {t('settings.sshTestSuccess')}
                        </Typography>
                        {sshTestResult.nodes?.map(node => (
                          <Box key={node.node} sx={{ display: 'flex', alignItems: 'center', gap: 1, ml: 1 }}>
                            <i className={node.status === 'ok' ? "ri-check-line" : "ri-close-line"} 
                               style={{ color: node.status === 'ok' ? '#22c55e' : '#ef4444' }} />
                            <Typography variant="body2">
                              {node.node} ({node.ip})
                            </Typography>
                            {node.error && (
                              <Typography variant="caption" color="error">
                                - {node.error}
                              </Typography>
                            )}
                          </Box>
                        ))}
                      </Alert>
                    ) : (
                      <Alert severity="error">
                        {sshTestResult.error || t('settings.sshTestFailed')}
                      </Alert>
                    )}
                  </Box>
                )}
              </Box>
            )}
          </Box>
        </Collapse>

        <Divider sx={{ my: 3 }} />

        {/* Section: Location (optionnelle) */}
        <Typography variant="subtitle2" sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
          <i className="ri-map-pin-line" />
          {t('settings.location')}
          <Chip label={t('common.optional')} size="small" variant="outlined" sx={{ ml: 1 }} />
        </Typography>

        <Alert severity="info" sx={{ mb: 2 }}>
          <Typography variant="body2">
            {t('settings.locationInfo')}
          </Typography>
        </Alert>

        <TextField
          fullWidth
          label={t('settings.locationLabel')}
          value={form.locationLabel}
          onChange={e => handleChange('locationLabel', e.target.value)}
          placeholder="Paris DC1, Frankfurt, ..."
          sx={{ mt: 1 }}
        />

        <Box sx={{ display: 'flex', gap: 2, mt: 2 }}>
          <TextField
            label={t('settings.latitude')}
            value={form.latitude}
            onChange={e => handleChange('latitude', e.target.value.replace(',', '.'))}
            placeholder="48.8566"
            sx={{ flex: 1 }}
            InputProps={{ inputProps: { min: -90, max: 90, step: 'any' } }}
          />
          <TextField
            label={t('settings.longitude')}
            value={form.longitude}
            onChange={e => handleChange('longitude', e.target.value.replace(',', '.'))}
            placeholder="2.3522"
            sx={{ flex: 1 }}
            InputProps={{ inputProps: { min: -180, max: 180, step: 'any' } }}
          />
        </Box>
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          {t('common.cancel')}
        </Button>
        <Button
          variant="contained"
          color={isPbs ? 'secondary' : 'primary'}
          onClick={handleSave}
          disabled={saving || !form.name.trim() || !form.baseUrl.trim() || (!isEdit && !form.apiToken.trim())}
          startIcon={saving ? <CircularProgress size={16} /> : <i className="ri-save-line" />}
        >
          {t('common.save')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
