// src/components/settings/ConnectionDialog.tsx
// Dialog pour ajouter/modifier une connexion PVE/PBS avec support SSH
'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'

import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
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
  behindProxy: boolean
  insecureTLS: boolean
  hasCeph: boolean
  apiToken: string
  // VMware fields
  vmwareUser: string
  vmwarePassword: string
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
  sshUseSudo: boolean
}

type ConnectionDialogProps = {
  open: boolean
  onClose: () => void
  onSave: (data: ConnectionFormData) => Promise<void>
  type: 'pve' | 'pbs' | 'vmware' | 'xcpng'
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
  behindProxy: false,
  insecureTLS: true,
  hasCeph: false,
  apiToken: '',
  vmwareUser: 'root',
  vmwarePassword: '',
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
  sshUseSudo: false,
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
  const [tokenId, setTokenId] = useState('')
  const [tokenSecret, setTokenSecret] = useState('')
  const [showTokenSecret, setShowTokenSecret] = useState(false)
  
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
          behindProxy: initialData.behindProxy ?? false,
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
        setForm({
          ...defaultFormData,
          vmwareUser: type === 'xcpng' ? 'admin@admin.net' : 'root',
        })
      }
      setError(null)
      setSshTestResult(null)
      setTokenId('')
      setTokenSecret('')
      setShowTokenSecret(false)
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
    
    // Assemble API token from split fields if they were used (PVE/PBS only)
    if (!isExternalHypervisor && tokenId.trim() && tokenSecret.trim()) {
      const separator = type === 'pbs' ? ':' : '='
      form.apiToken = `${tokenId.trim()}${separator}${tokenSecret.trim()}`
    }

    if (!isExternalHypervisor && mode === 'create' && !form.apiToken.trim()) {
      setError(t('settings.errorTokenRequired'))
      return
    }

    // VMware / XCP-ng validation
    if (isExternalHypervisor) {
      if (mode === 'create' && !form.vmwarePassword) {
        setError(t('settings.errorPasswordRequired'))
        return
      }
    }

    // SSH Validation (PVE only)
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

    // Auto-append default port if not specified (PVE/PBS only, external hypervisors use 443)
    const defaultPort = isExternalHypervisor ? '443' : type === 'pbs' ? '8007' : '8006'
    let finalForm = { ...form }
    // For VMware, auto-prefix https://; for XCP-ng, auto-prefix http:// (XO often runs on HTTP)
    if (isExternalHypervisor && finalForm.baseUrl && !finalForm.baseUrl.match(/^https?:\/\//)) {
      finalForm.baseUrl = isXcpng ? `http://${finalForm.baseUrl}` : `https://${finalForm.baseUrl}`
    }
    try {
      const url = new URL(finalForm.baseUrl)
      if (!url.port && !isExternalHypervisor) {
        url.port = defaultPort
        finalForm.baseUrl = url.toString().replace(/\/$/, '')
      }
    } catch {
      if (finalForm.baseUrl && !finalForm.baseUrl.match(/:\d+/) && !isExternalHypervisor) {
        finalForm.baseUrl = finalForm.baseUrl.replace(/\/$/, '') + ':' + defaultPort
      }
    }

    setSaving(true)
    setError(null)

    try {
      await onSave(finalForm)
      onClose()
    } catch (e: any) {
      setError(e.message || 'Error saving connection')
    } finally {
      setSaving(false)
    }
  }

  const isPbs = type === 'pbs'
  const isVmware = type === 'vmware'
  const isXcpng = type === 'xcpng'
  const isExternalHypervisor = isVmware || isXcpng
  const port = isExternalHypervisor ? '443' : isPbs ? '8007' : '8006'
  const isEdit = mode === 'edit'

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        {isXcpng ? (
          <><img src="/images/xcpng-logo.svg" alt="" width={20} height={20} /> {isEdit ? t('settings.editXcpngServer') : t('settings.addXcpngServer')}</>
        ) : isVmware ? (
          <><i className="ri-cloud-line" style={{ color: '#638C1C' }} /> {isEdit ? t('settings.editVmwareServer') : t('settings.addVmwareServer')}</>
        ) : isPbs ? (
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

        {(isXcpng || isVmware) && (
          <Alert severity="info" sx={{ mb: 2 }}>
            {isXcpng
              ? t.rich('settings.xcpngPortInfo', { b: (chunks: any) => <b>{chunks}</b> })
              : t.rich('settings.vmwarePortInfo', { b: (chunks: any) => <b>{chunks}</b> })
            }
          </Alert>
        )}

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
          label={isExternalHypervisor ? (isXcpng ? t('settings.xcpngHostLabel') : t('settings.esxiHostLabel')) : t('settings.baseUrlLabel', { port })}
          value={form.baseUrl}
          onChange={e => handleChange('baseUrl', e.target.value)}
          placeholder={isXcpng ? 'http://10.99.99.196' : isVmware ? '192.168.1.100' : t('settings.baseUrlPlaceholder', { port })}
          helperText={isXcpng ? t('settings.xcpngHostHelper') : isVmware ? t('settings.esxiHostHelper') : undefined}
          sx={{ mt: 2 }}
          required
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

        {!isExternalHypervisor && (
          <FormControlLabel
            sx={{ mt: 1 }}
            control={
              <Switch
                checked={form.behindProxy}
                onChange={e => handleChange('behindProxy', e.target.checked)}
              />
            }
            label={
              <Box>
                <Typography variant="body2">{t('settings.behindProxy')}</Typography>
                <Typography variant="caption" color="text.secondary">{t('settings.behindProxyHelper')}</Typography>
              </Box>
            }
          />
        )}

        <Divider sx={{ my: 3 }} />

        {/* Section: Authentication */}
        <Typography variant="subtitle2" sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
          <i className="ri-key-2-line" />
          {isExternalHypervisor ? (isXcpng ? t('settings.xcpngAuthentication') : t('settings.vmwareAuthentication')) : t('settings.apiAuthentication')}
        </Typography>

        {isExternalHypervisor ? (
          <>
            <TextField
              fullWidth
              label={isXcpng ? t('settings.xcpngUsername') : t('settings.vmwareUsername')}
              value={form.vmwareUser}
              onChange={e => handleChange('vmwareUser', e.target.value)}
              placeholder={isXcpng ? 'admin@admin.net' : 'root'}
              sx={{ mt: 1 }}
              required
            />
            <TextField
              fullWidth
              label={isXcpng ? t('settings.xcpngPasswordLabel') : t('settings.vmwarePasswordLabel')}
              value={form.vmwarePassword}
              onChange={e => handleChange('vmwarePassword', e.target.value)}
              type={showPassword ? 'text' : 'password'}
              helperText={isEdit ? t('settings.vmwarePasswordHelperEdit') : (isXcpng ? t('settings.xcpngPasswordHelper') : t('settings.vmwarePasswordHelper'))}
              sx={{ mt: 1.5 }}
              required={!isEdit}
              slotProps={{
                input: {
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton size="small" onClick={() => setShowPassword(!showPassword)} edge="end">
                        <i className={showPassword ? 'ri-eye-off-line' : 'ri-eye-line'} />
                      </IconButton>
                    </InputAdornment>
                  )
                }
              }}
            />
          </>
        ) : (
          <>
            <TextField
              fullWidth
              label={t('settings.apiTokenId')}
              value={tokenId}
              onChange={e => setTokenId(e.target.value)}
              placeholder="user@realm!tokenid"
              helperText={isEdit ? t('settings.apiTokenHelperEdit') : t('settings.apiTokenIdHelper')}
              sx={{ mt: 1 }}
              required={!isEdit}
            />
            <TextField
              fullWidth
              label={t('settings.apiTokenSecret')}
              value={tokenSecret}
              onChange={e => setTokenSecret(e.target.value)}
              type={showTokenSecret ? 'text' : 'password'}
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              helperText={isEdit ? t('settings.apiTokenHelperEdit') : t('settings.apiTokenSecretHelper')}
              sx={{ mt: 1.5 }}
              required={!isEdit}
              slotProps={{
                input: {
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton size="small" onClick={() => setShowTokenSecret(!showTokenSecret)} edge="end">
                        <i className={showTokenSecret ? 'ri-eye-off-line' : 'ri-eye-line'} />
                      </IconButton>
                    </InputAdornment>
                  )
                }
              }}
            />

            <Accordion
              disableGutters
              elevation={0}
              sx={{
                mt: 2,
                border: '1px solid',
                borderColor: 'info.main',
                borderRadius: '8px !important',
                '&::before': { display: 'none' },
                bgcolor: 'transparent',
              }}
            >
              <AccordionSummary
                expandIcon={<i className="ri-arrow-down-s-line" style={{ fontSize: 18 }} />}
                sx={{ minHeight: 40, '& .MuiAccordionSummary-content': { my: 0.5 } }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <i className="ri-terminal-line" style={{ fontSize: 16, opacity: 0.7 }} />
                  <Typography variant="body2" fontWeight={600}>
                    {t('settings.tokenSetupGuide')}
                  </Typography>
                </Box>
              </AccordionSummary>
              <AccordionDetails sx={{ pt: 0, pb: 1.5 }}>
                <Typography variant="caption" sx={{ display: 'block', mb: 1, opacity: 0.7 }}>
                  {isPbs ? t('settings.pbsTokenSetupDesc') : t('settings.pveTokenSetupDesc')}
                </Typography>
                <Box
                  component="pre"
                  sx={{
                    bgcolor: 'grey.900',
                    color: 'grey.100',
                    p: 1.5,
                    borderRadius: 1,
                    fontSize: '0.75rem',
                    fontFamily: '"JetBrains Mono", monospace',
                    overflow: 'auto',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                    position: 'relative',
                    m: 0,
                  }}
                >
                  <IconButton
                    size="small"
                    onClick={() => {
                      const text = isPbs
                        ? `proxmox-backup-manager user create proxcenter@pbs --comment "ProxCenter service account"\nproxmox-backup-manager user generate-token proxcenter@pbs proxcenter\nproxmox-backup-manager acl update / DatastoreReader --auth-id proxcenter@pbs\nproxmox-backup-manager acl update / DatastoreReader --auth-id 'proxcenter@pbs!proxcenter'`
                        : `pveum user add proxcenter@pve --comment "ProxCenter service account"\npveum user token add proxcenter@pve proxcenter-token --privsep=0\npveum aclmod / -user proxcenter@pve -role PVEAdmin`
                      navigator.clipboard.writeText(text)
                    }}
                    sx={{
                      position: 'absolute',
                      top: 4,
                      right: 4,
                      color: 'grey.400',
                      '&:hover': { color: 'grey.100' },
                    }}
                  >
                    <i className="ri-file-copy-line" style={{ fontSize: 14 }} />
                  </IconButton>
                  {isPbs ? (
                    <>
                      <Box component="span" sx={{ color: 'grey.500' }}># {t('settings.pbsStep1')}</Box>{'\n'}
                      proxmox-backup-manager user create proxcenter@pbs \{'\n'}
                      {'  '}--comment &quot;ProxCenter service account&quot;{'\n\n'}
                      <Box component="span" sx={{ color: 'grey.500' }}># {t('settings.pbsStep2')}</Box>{'\n'}
                      proxmox-backup-manager user generate-token \{'\n'}
                      {'  '}proxcenter@pbs proxcenter{'\n\n'}
                      <Box component="span" sx={{ color: 'grey.500' }}># {t('settings.pbsStep3')}</Box>{'\n'}
                      proxmox-backup-manager acl update / DatastoreReader \{'\n'}
                      {'  '}--auth-id proxcenter@pbs{'\n'}
                      proxmox-backup-manager acl update / DatastoreReader \{'\n'}
                      {'  '}--auth-id &apos;proxcenter@pbs!proxcenter&apos;
                    </>
                  ) : (
                    <>
                      <Box component="span" sx={{ color: 'grey.500' }}># {t('settings.pveStep1')}</Box>{'\n'}
                      pveum user add proxcenter@pve \{'\n'}
                      {'  '}--comment &quot;ProxCenter service account&quot;{'\n\n'}
                      <Box component="span" sx={{ color: 'grey.500' }}># {t('settings.pveStep2')}</Box>{'\n'}
                      pveum user token add proxcenter@pve proxcenter-token \{'\n'}
                      {'  '}--privsep=0{'\n\n'}
                      <Box component="span" sx={{ color: 'grey.500' }}># {t('settings.pveStep3')}</Box>{'\n'}
                      pveum aclmod / -user proxcenter@pve -role PVEAdmin
                    </>
                  )}
                </Box>
              </AccordionDetails>
            </Accordion>
          </>
        )}

        {!isPbs && !isXcpng && (
          <>
        <Divider sx={{ my: 3 }} />

        {/* Section: SSH access (PVE + VMware/ESXi) */}
        <Typography variant="subtitle2" sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
          <i className="ri-terminal-line" />
          {t('settings.sshAccess')}
          <Chip label={t('common.optional')} size="small" variant="outlined" sx={{ ml: 1 }} />
        </Typography>

        <Alert severity="info" sx={{ mb: 2 }}>
          <Typography variant="body2">
            {t('settings.sshInfo')}
          </Typography>
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
                onChange={e => handleChange('sshPort', Number.parseInt(e.target.value) || 22)}
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

            {/* Use sudo for privileged commands */}
            <FormControlLabel
              control={
                <Switch
                  checked={form.sshUseSudo}
                  onChange={e => setForm({ ...form, sshUseSudo: e.target.checked })}
                />
              }
              label={
                <Box>
                  <Typography variant="body2">{t('settings.sshUseSudo')}</Typography>
                  <Typography variant="caption" color="text.secondary">{t('settings.sshUseSudoHelper')}</Typography>
                </Box>
              }
              sx={{ mt: 1, ml: 0 }}
            />

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
          </>
        )}

        {!isExternalHypervisor && (
          <>
            <Divider sx={{ my: 3 }} />

            {/* Section: Location (optionnelle) — PVE/PBS only */}
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
                onChange={e => handleChange('latitude', e.target.value.replaceAll(',', '.'))}
                placeholder="48.8566"
                sx={{ flex: 1 }}
                InputProps={{ inputProps: { min: -90, max: 90, step: 'any' } }}
              />
              <TextField
                label={t('settings.longitude')}
                value={form.longitude}
                onChange={e => handleChange('longitude', e.target.value.replaceAll(',', '.'))}
                placeholder="2.3522"
                sx={{ flex: 1 }}
                InputProps={{ inputProps: { min: -180, max: 180, step: 'any' } }}
              />
            </Box>
          </>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          {t('common.cancel')}
        </Button>
        <Button
          variant="contained"
          color={isPbs ? 'secondary' : 'primary'}
          onClick={handleSave}
          disabled={saving || !form.name.trim() || !form.baseUrl.trim() || (!isExternalHypervisor && !isEdit && !tokenId.trim() && !tokenSecret.trim() && !form.apiToken.trim()) || (isExternalHypervisor && !isEdit && !form.vmwarePassword)}
          startIcon={saving ? <CircularProgress size={16} /> : <i className="ri-save-line" />}
        >
          {t('common.save')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
