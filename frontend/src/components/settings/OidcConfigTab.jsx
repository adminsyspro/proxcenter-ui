'use client'

import { useEffect, useState } from 'react'

import { useTranslations } from 'next-intl'

import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  FormControl,
  FormControlLabel,
  IconButton,
  InputAdornment,
  InputLabel,
  MenuItem,
  Select,
  Switch,
  TextField,
  Typography,
} from '@mui/material'

export default function OidcConfigTab() {
  const t = useTranslations()

  const [config, setConfig] = useState({
    enabled: false,
    provider_name: 'SSO',
    issuer_url: '',
    client_id: '',
    client_secret: '',
    scopes: 'openid profile email',
    authorization_url: '',
    token_url: '',
    userinfo_url: '',
    claim_email: 'email',
    claim_name: 'name',
    claim_groups: 'groups',
    auto_provision: true,
    default_role: 'viewer',
    group_role_mapping: '{}',
  })

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [testResult, setTestResult] = useState(null)
  const [showSecret, setShowSecret] = useState(false)
  const [hasClientSecret, setHasClientSecret] = useState(false)
  const [groupMappings, setGroupMappings] = useState([])

  useEffect(() => {
    loadConfig()
  }, [])

  const loadConfig = async () => {
    try {
      setLoading(true)
      setError('')
      const res = await fetch('/api/v1/auth/oidc')

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        setError(errData.error || t('oidc.loadError'))
        return
      }

      const data = await res.json()

      if (data.data) {
        setConfig(prev => ({
          ...prev,
          ...data.data,
          client_secret: '',
        }))
        setHasClientSecret(data.data.hasClientSecret || false)

        // Parse group role mapping into array
        try {
          const mapping = JSON.parse(data.data.group_role_mapping || '{}')
          setGroupMappings(
            Object.entries(mapping).map(([group, role]) => ({ group, role }))
          )
        } catch {
          setGroupMappings([])
        }
      }
    } catch (e) {
      console.error('Error loading OIDC config:', e)
      setError(t('oidc.loadError'))
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    setError('')
    setSuccess('')
    setTestResult(null)

    try {
      // Build group_role_mapping from array
      const mapping = {}
      groupMappings.forEach(({ group, role }) => {
        if (group && role) mapping[group] = role
      })

      const res = await fetch('/api/v1/auth/oidc', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...config,
          group_role_mapping: JSON.stringify(mapping),
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || t('oidc.saveError'))
        return
      }

      setSuccess(t('oidc.saveSuccess'))

      if (config.client_secret) {
        setHasClientSecret(true)
        setConfig(prev => ({ ...prev, client_secret: '' }))
      }
    } catch (e) {
      setError(t('oidc.saveError'))
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async () => {
    setTesting(true)
    setError('')
    setSuccess('')
    setTestResult(null)

    try {
      const res = await fetch('/api/v1/auth/oidc/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issuer_url: config.issuer_url }),
      })

      const data = await res.json()

      if (res.ok && data.success) {
        setTestResult({
          success: true,
          message: data.message || t('oidc.testSuccess'),
          endpoints: data.endpoints,
        })
      } else {
        setTestResult({
          success: false,
          message: data.error || data.message || t('oidc.testFailed'),
          endpoints: data.endpoints || null,
        })
      }
    } catch (e) {
      setTestResult({ success: false, message: t('oidc.saveError') })
    } finally {
      setTesting(false)
    }
  }

  const addGroupMapping = () => {
    setGroupMappings([...groupMappings, { group: '', role: 'viewer' }])
  }

  const removeGroupMapping = (index) => {
    setGroupMappings(groupMappings.filter((_, i) => i !== index))
  }

  const updateGroupMapping = (index, field, value) => {
    setGroupMappings(
      groupMappings.map((m, i) => (i === index ? { ...m, [field]: value } : m))
    )
  }

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress />
      </Box>
    )
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {/* Header */}
      <Box>
        <Typography variant='body2' sx={{ opacity: 0.7, mb: 1 }}>
          {t('oidc.description')}
        </Typography>
        <Alert severity='info' icon={<i className='ri-shield-keyhole-line' />}>
          {t('oidc.securityInfo')}
        </Alert>
      </Box>

      {/* Messages */}
      {error && <Alert severity='error' onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert severity='success' onClose={() => setSuccess('')}>{success}</Alert>}
      {testResult && (
        <Alert
          severity={testResult.success ? 'success' : 'error'}
          onClose={() => setTestResult(null)}
          icon={testResult.success ? <i className='ri-check-line' /> : <i className='ri-error-warning-line' />}
        >
          <Typography variant='body2'>{testResult.message}</Typography>
          {testResult.endpoints && (
            <Box sx={{ mt: 1, '& code': { fontSize: '0.8rem', bgcolor: 'action.hover', px: 0.5, borderRadius: 0.5 } }}>
              {testResult.endpoints.authorization_endpoint && (
                <Typography variant='caption' display='block'>Authorization: <code>{testResult.endpoints.authorization_endpoint}</code></Typography>
              )}
              {testResult.endpoints.token_endpoint && (
                <Typography variant='caption' display='block'>Token: <code>{testResult.endpoints.token_endpoint}</code></Typography>
              )}
              {testResult.endpoints.userinfo_endpoint && (
                <Typography variant='caption' display='block'>Userinfo: <code>{testResult.endpoints.userinfo_endpoint}</code></Typography>
              )}
            </Box>
          )}
        </Alert>
      )}

      {/* Enable/Disable */}
      <Card variant='outlined'>
        <CardContent>
          <FormControlLabel
            control={
              <Switch
                checked={config.enabled}
                onChange={e => setConfig({ ...config, enabled: e.target.checked })}
              />
            }
            label={
              <Box>
                <Typography variant='body1' fontWeight={600}>
                  {t('oidc.enableOidc')}
                </Typography>
                <Typography variant='body2' sx={{ opacity: 0.6 }}>
                  {t('oidc.enableOidcDesc')}
                </Typography>
              </Box>
            }
          />
        </CardContent>
      </Card>

      {/* Provider Configuration */}
      <Card variant='outlined'>
        <CardContent>
          <Typography variant='subtitle1' fontWeight={700} sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
            <i className='ri-shield-keyhole-line' style={{ color: '#3b82f6' }} />
            {t('oidc.providerSection')}
          </Typography>

          <TextField
            fullWidth
            label={t('oidc.providerName')}
            value={config.provider_name}
            onChange={e => setConfig({ ...config, provider_name: e.target.value })}
            placeholder='Keycloak, Azure AD, Okta...'
            disabled={!config.enabled}
            helperText={t('oidc.providerNameHelper')}
            sx={{ mb: 2 }}
          />

          <TextField
            fullWidth
            label={t('oidc.issuerUrl')}
            value={config.issuer_url}
            onChange={e => setConfig({ ...config, issuer_url: e.target.value })}
            placeholder='https://idp.example.com/realms/myrealm'
            disabled={!config.enabled}
            helperText={t('oidc.issuerUrlHelper')}
            sx={{ mb: 2 }}
          />

          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2, mb: 2 }}>
            <TextField
              fullWidth
              label={t('oidc.clientId')}
              value={config.client_id}
              onChange={e => setConfig({ ...config, client_id: e.target.value })}
              placeholder='proxcenter'
              disabled={!config.enabled}
              helperText={t('oidc.clientIdHelper')}
            />

            <TextField
              fullWidth
              label={t('oidc.clientSecret')}
              type={showSecret ? 'text' : 'password'}
              value={config.client_secret}
              onChange={e => setConfig({ ...config, client_secret: e.target.value })}
              disabled={!config.enabled}
              placeholder={hasClientSecret ? '••••••••' : ''}
              helperText={hasClientSecret ? t('oidc.clientSecretKeep') : t('oidc.clientSecretHelper')}
              InputProps={{
                endAdornment: (
                  <InputAdornment position='end'>
                    <IconButton size='small' onClick={() => setShowSecret(!showSecret)}>
                      <i className={showSecret ? 'ri-eye-off-line' : 'ri-eye-line'} />
                    </IconButton>
                  </InputAdornment>
                ),
              }}
            />
          </Box>

          <TextField
            fullWidth
            label={t('oidc.scopes')}
            value={config.scopes}
            onChange={e => setConfig({ ...config, scopes: e.target.value })}
            placeholder='openid profile email'
            disabled={!config.enabled}
            helperText={t('oidc.scopesHelper')}
          />
        </CardContent>
      </Card>

      {/* Advanced Endpoints (collapsed) */}
      <Accordion variant='outlined' disabled={!config.enabled}>
        <AccordionSummary expandIcon={<i className='ri-arrow-down-s-line' />}>
          <Typography variant='subtitle1' fontWeight={700} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <i className='ri-settings-3-line' style={{ color: '#f59e0b' }} />
            {t('oidc.advancedSection')}
          </Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Typography variant='body2' sx={{ opacity: 0.6, mb: 2 }}>
            {t('oidc.advancedDesc')}
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField
              fullWidth
              label={t('oidc.authorizationUrl')}
              value={config.authorization_url}
              onChange={e => setConfig({ ...config, authorization_url: e.target.value })}
              placeholder='https://idp.example.com/authorize'
              disabled={!config.enabled}
            />
            <TextField
              fullWidth
              label={t('oidc.tokenUrl')}
              value={config.token_url}
              onChange={e => setConfig({ ...config, token_url: e.target.value })}
              placeholder='https://idp.example.com/token'
              disabled={!config.enabled}
            />
            <TextField
              fullWidth
              label={t('oidc.userinfoUrl')}
              value={config.userinfo_url}
              onChange={e => setConfig({ ...config, userinfo_url: e.target.value })}
              placeholder='https://idp.example.com/userinfo'
              disabled={!config.enabled}
            />
          </Box>
        </AccordionDetails>
      </Accordion>

      {/* Claim Mapping */}
      <Card variant='outlined'>
        <CardContent>
          <Typography variant='subtitle1' fontWeight={700} sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
            <i className='ri-exchange-line' style={{ color: '#10b981' }} />
            {t('oidc.claimSection')}
          </Typography>

          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr 1fr' }, gap: 2 }}>
            <TextField
              fullWidth
              label={t('oidc.claimEmail')}
              value={config.claim_email}
              onChange={e => setConfig({ ...config, claim_email: e.target.value })}
              placeholder='email'
              disabled={!config.enabled}
              helperText={t('oidc.claimEmailHelper')}
            />
            <TextField
              fullWidth
              label={t('oidc.claimName')}
              value={config.claim_name}
              onChange={e => setConfig({ ...config, claim_name: e.target.value })}
              placeholder='name'
              disabled={!config.enabled}
              helperText={t('oidc.claimNameHelper')}
            />
            <TextField
              fullWidth
              label={t('oidc.claimGroups')}
              value={config.claim_groups}
              onChange={e => setConfig({ ...config, claim_groups: e.target.value })}
              placeholder='groups'
              disabled={!config.enabled}
              helperText={t('oidc.claimGroupsHelper')}
            />
          </Box>
        </CardContent>
      </Card>

      {/* User Provisioning */}
      <Card variant='outlined'>
        <CardContent>
          <Typography variant='subtitle1' fontWeight={700} sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
            <i className='ri-user-add-line' style={{ color: '#8b5cf6' }} />
            {t('oidc.provisionSection')}
          </Typography>

          <FormControlLabel
            control={
              <Switch
                checked={config.auto_provision}
                onChange={e => setConfig({ ...config, auto_provision: e.target.checked })}
                disabled={!config.enabled}
              />
            }
            label={
              <Box>
                <Typography variant='body1' fontWeight={600}>
                  {t('oidc.autoProvision')}
                </Typography>
                <Typography variant='body2' sx={{ opacity: 0.6 }}>
                  {t('oidc.autoProvisionDesc')}
                </Typography>
              </Box>
            }
            sx={{ mb: 2 }}
          />

          <FormControl fullWidth sx={{ mb: 3 }} disabled={!config.enabled}>
            <InputLabel>{t('oidc.defaultRole')}</InputLabel>
            <Select
              value={config.default_role}
              label={t('oidc.defaultRole')}
              onChange={e => setConfig({ ...config, default_role: e.target.value })}
            >
              <MenuItem value='viewer'>Viewer</MenuItem>
              <MenuItem value='operator'>Operator</MenuItem>
              <MenuItem value='admin'>Admin</MenuItem>
            </Select>
            <Typography variant='caption' sx={{ mt: 0.5, opacity: 0.6 }}>
              {t('oidc.defaultRoleHelper')}
            </Typography>
          </FormControl>

          {/* Group-to-role mapping */}
          <Typography variant='subtitle2' fontWeight={600} sx={{ mb: 1 }}>
            {t('oidc.groupMapping')}
          </Typography>
          <Typography variant='body2' sx={{ opacity: 0.6, mb: 2 }}>
            {t('oidc.groupMappingDesc')}
          </Typography>

          {groupMappings.map((mapping, index) => (
            <Box key={index} sx={{ display: 'flex', gap: 1, mb: 1, alignItems: 'center' }}>
              <TextField
                size='small'
                label={t('oidc.groupName')}
                value={mapping.group}
                onChange={e => updateGroupMapping(index, 'group', e.target.value)}
                disabled={!config.enabled}
                sx={{ flex: 1 }}
                placeholder='admins, devops, viewers...'
              />
              <FormControl size='small' sx={{ minWidth: 140 }} disabled={!config.enabled}>
                <InputLabel>{t('oidc.role')}</InputLabel>
                <Select
                  value={mapping.role}
                  label={t('oidc.role')}
                  onChange={e => updateGroupMapping(index, 'role', e.target.value)}
                >
                  <MenuItem value='super_admin'>Super Admin</MenuItem>
                  <MenuItem value='admin'>Admin</MenuItem>
                  <MenuItem value='operator'>Operator</MenuItem>
                  <MenuItem value='viewer'>Viewer</MenuItem>
                </Select>
              </FormControl>
              <IconButton size='small' onClick={() => removeGroupMapping(index)} disabled={!config.enabled}>
                <i className='ri-delete-bin-line' />
              </IconButton>
            </Box>
          ))}

          <Button
            size='small'
            variant='text'
            onClick={addGroupMapping}
            disabled={!config.enabled}
            startIcon={<i className='ri-add-line' />}
            sx={{ mt: 1 }}
          >
            {t('oidc.addMapping')}
          </Button>
        </CardContent>
      </Card>

      {/* Provider Presets (info card) */}
      <Card variant='outlined' sx={{ bgcolor: 'action.hover' }}>
        <CardContent>
          <Typography variant='subtitle1' fontWeight={700} sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
            <i className='ri-lightbulb-line' style={{ color: '#f59e0b' }} />
            {t('oidc.presetsSection')}
          </Typography>

          <Typography variant='body2' sx={{ mb: 1 }}>
            {t('oidc.presetsDesc')}
          </Typography>

          <Box component='ul' sx={{ pl: 2, '& li': { mb: 0.5 } }}>
            <li>
              <Typography variant='body2'>
                <strong>Keycloak:</strong> <code>https://keycloak.example.com/realms/{'<realm>'}</code>
              </Typography>
            </li>
            <li>
              <Typography variant='body2'>
                <strong>Azure AD / Entra:</strong> <code>{'https://login.microsoftonline.com/<tenant-id>/v2.0'}</code>
              </Typography>
            </li>
            <li>
              <Typography variant='body2'>
                <strong>Okta:</strong> <code>{'https://<org>.okta.com'}</code>
              </Typography>
            </li>
            <li>
              <Typography variant='body2'>
                <strong>Google Workspace:</strong> <code>https://accounts.google.com</code>
              </Typography>
            </li>
            <li>
              <Typography variant='body2'>
                <strong>Auth0:</strong> <code>{'https://<tenant>.auth0.com'}</code>
              </Typography>
            </li>
          </Box>
        </CardContent>
      </Card>

      {/* Actions */}
      <Card variant='outlined'>
        <CardContent>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <Button
              variant='contained'
              onClick={handleSave}
              disabled={saving}
              startIcon={saving ? <CircularProgress size={16} /> : <i className='ri-save-line' />}
            >
              {saving ? t('oidc.saving') : t('oidc.save')}
            </Button>

            <Button
              variant='outlined'
              onClick={handleTest}
              disabled={testing || !config.enabled || !config.issuer_url}
              startIcon={testing ? <CircularProgress size={16} /> : <i className='ri-search-eye-line' />}
            >
              {testing ? t('oidc.testing') : t('oidc.testDiscovery')}
            </Button>

            <Button
              variant='outlined'
              color='secondary'
              onClick={loadConfig}
              disabled={saving || testing}
              startIcon={<i className='ri-refresh-line' />}
            >
              {t('oidc.reset')}
            </Button>
          </Box>
        </CardContent>
      </Card>
    </Box>
  )
}
