'use client'

import { useEffect, useState } from 'react'

import { useTranslations } from 'next-intl'

import MappingOrderButtons from './MappingOrderButtons'
import { moveMappingRow } from '@/lib/settings/mappingOrder'

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

// Mapping rows are a grid, not three content-sized boxes: without a fixed width
// each Select sizes itself on its own value ("Tenant Operator" vs "Viewer") and
// the columns stop lining up from one row to the next.
const SCOPE_FIELD_WIDTH = 170

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
    default_role: 'role_viewer',
    show_local_login: true,
    force_sso_redirect: false,
    group_role_mapping: '[]',
    group_mapping_strategy: 'first_match',
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
  const [availableRoles, setAvailableRoles] = useState([])
  // Tenant / vDC pickers are served by the OIDC config route itself: it gates on
  // ADMIN_SETTINGS like this tab, while /api/v1/tenants needs ADMIN_TENANTS.
  const [tenants, setTenants] = useState([])
  const [vdcs, setVdcs] = useState([])
  // Served by the route: it is the origin the server itself uses towards the
  // IdP, which is what the admin has to register.
  const [appOrigin, setAppOrigin] = useState('')

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
        // Normalize legacy role values (e.g. "viewer" -> "role_viewer")
        const normalizeRole = r => (r && !r.startsWith('role_') ? `role_${r}` : r)

        setConfig(prev => ({
          ...prev,
          ...data.data,
          client_secret: '',
          default_role: normalizeRole(data.data.default_role) || 'role_viewer',
        }))
        setHasClientSecret(data.data.hasClientSecret || false)

        setTenants(data.data.tenants || [])
        setVdcs(data.data.vdcs || [])
        setAppOrigin(data.data.app_origin || '')

        // Parse the group mapping. The route always answers the entry-list
        // shape, but a flat { group: role } object is still accepted so a stale
        // cached payload cannot wipe the mapping on the next save.
        try {
          const mapping = JSON.parse(data.data.group_role_mapping || '[]')
          const entries = Array.isArray(mapping)
            ? mapping.map(m => ({
                group: m.group || '',
                tenant: m.tenant || m.tenantId || 'default',
                vdc: m.vdc || m.vdcId || '',
                role: normalizeRole(m.role),
              }))
            : Object.entries(mapping).map(([group, role]) => ({
                group,
                tenant: 'default',
                vdc: '',
                role: normalizeRole(role),
              }))
          setGroupMappings(entries)
        } catch {
          setGroupMappings([])
        }
      }
      // Fetch available RBAC roles
      try {
        const rolesRes = await fetch('/api/v1/rbac/roles')
        if (rolesRes.ok) {
          const rolesData = await rolesRes.json()
          setAvailableRoles(rolesData.data || [])
        }
      } catch {}
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
      // Build the group mapping entry list. Trim group names so a stray
      // leading/trailing space pasted from the IdP doesn't silently break
      // the mapping at login time. A half-filled row is dropped rather than
      // saved as a grant nobody asked for.
      const mapping = []
      groupMappings.forEach(({ group, tenant, vdc, role }) => {
        const key = (group || '').trim()
        if (!key || !role) return
        mapping.push({ group: key, tenant: tenant || 'default', vdc: vdc || '', role })
      })

      const res = await fetch('/api/v1/auth/oidc', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...config,
          group_role_mapping: JSON.stringify(mapping),
          group_mapping_strategy: config.group_mapping_strategy || 'first_match',
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
    setGroupMappings([...groupMappings, { group: '', tenant: 'default', vdc: '', role: 'role_viewer' }])
  }

  const removeGroupMapping = (index) => {
    setGroupMappings(groupMappings.filter((_, i) => i !== index))
  }

  // The rows are read from the top down at login time, so their order is part
  // of the configuration and has to be editable (issue #992).
  const moveGroupMapping = (index, delta) => {
    setGroupMappings(rows => moveMappingRow(rows, index, delta))
  }

  const updateGroupMapping = (index, field, value) => {
    setGroupMappings(
      groupMappings.map((m, i) => {
        if (i !== index) return m
        // A vDC belongs to one tenant, so moving the row to another tenant
        // invalidates the current selection instead of silently keeping a vDC
        // the backend would then reject.
        if (field === 'tenant') return { ...m, tenant: value, vdc: '' }
        return { ...m, [field]: value }
      })
    )
  }

  // Nothing to choose on a single-tenant install with no vDC: keep the mapping
  // rows at their historical two fields rather than showing two inert pickers.
  const showScopePickers = tenants.length > 1 || vdcs.length > 0

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

          {/* The two URLs the admin has to declare on the IdP side. The callback
              one was always implicit; the post-logout one is a hard requirement
              since ProxCenter ends the IdP session on sign-out, and a provider
              rejects an unregistered one outright. */}
          <Alert severity='info' variant='outlined' sx={{ mt: 3 }}>
            <Typography variant='body2' fontWeight={600} sx={{ mb: 1 }}>
              {t('oidc.registerUrlsTitle')}
            </Typography>
            <Typography variant='body2' sx={{ mb: 0.5 }}>
              {t('oidc.registerCallbackUrl')} : {appOrigin}/api/auth/callback/oidc
            </Typography>
            <Typography variant='body2'>
              {t('oidc.registerPostLogoutUrl')} : {appOrigin}/login
            </Typography>
            <Typography variant='caption' sx={{ display: 'block', mt: 1, opacity: 0.75 }}>
              {t('oidc.registerPostLogoutHelp')}
            </Typography>
          </Alert>
        </CardContent>
      </Card>

      {/* Login Page Behavior */}
      <Card variant='outlined'>
        <CardContent>
          <Typography variant='subtitle1' fontWeight={700} sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
            <i className='ri-login-box-line' style={{ color: '#3b82f6' }} />
            {t('oidc.loginBehaviorSection')}
          </Typography>

          <FormControlLabel
            control={
              <Switch
                checked={config.show_local_login}
                onChange={e => setConfig({ ...config, show_local_login: e.target.checked })}
                disabled={!config.enabled}
              />
            }
            label={
              <Box>
                <Typography variant='body1' fontWeight={600}>
                  {t('oidc.showLocalLogin')}
                </Typography>
                <Typography variant='body2' sx={{ opacity: 0.6 }}>
                  {t('oidc.showLocalLoginDesc')}
                </Typography>
              </Box>
            }
            sx={{ mb: 2, alignItems: 'flex-start' }}
          />

          <FormControlLabel
            control={
              <Switch
                checked={config.force_sso_redirect}
                onChange={e => setConfig({ ...config, force_sso_redirect: e.target.checked })}
                disabled={!config.enabled}
              />
            }
            label={
              <Box>
                <Typography variant='body1' fontWeight={600}>
                  {t('oidc.forceSsoRedirect')}
                </Typography>
                <Typography variant='body2' sx={{ opacity: 0.6 }}>
                  {t('oidc.forceSsoRedirectDesc')}
                </Typography>
              </Box>
            }
            sx={{ alignItems: 'flex-start' }}
          />

          <Alert severity='info' sx={{ mt: 2 }} icon={<i className='ri-key-2-line' />}>
            {t('oidc.escapeHatchInfo')}
          </Alert>
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
              {availableRoles.map(role => (
                <MenuItem key={role.id} value={role.id}>{role.is_system ? t(`rbac.roles.${role.id}`) : role.name}</MenuItem>
              ))}
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
            {showScopePickers ? t('oidc.groupMappingScopedDesc') : t('oidc.groupMappingDesc')}
          </Typography>

          <FormControl size='small' sx={{ mb: 2, maxWidth: 420 }} disabled={!config.enabled}>
            <InputLabel>{t('oidc.mappingStrategy')}</InputLabel>
            <Select
              value={config.group_mapping_strategy || 'first_match'}
              label={t('oidc.mappingStrategy')}
              onChange={e => setConfig({ ...config, group_mapping_strategy: e.target.value })}
            >
              <MenuItem value='first_match'>{t('oidc.mappingStrategyFirstMatch')}</MenuItem>
              <MenuItem value='cumulative'>{t('oidc.mappingStrategyCumulative')}</MenuItem>
            </Select>
            <Typography variant='caption' sx={{ mt: 0.5, opacity: 0.6, display: 'block' }}>
              {config.group_mapping_strategy === 'cumulative'
                ? t('oidc.mappingStrategyCumulativeHelper')
                : t('oidc.mappingStrategyFirstMatchHelper')}
            </Typography>
          </FormControl>

          {groupMappings.map((mapping, index) => {
            const rowTenant = mapping.tenant || 'default'
            const tenantVdcs = vdcs.filter(v => v.tenantId === rowTenant)
            // A mapping written before a tenant or vDC was deleted keeps its id
            // as an option, so the Select stays controlled and the stale value
            // is visible instead of silently blanking on load.
            const tenantMissing = rowTenant && !tenants.some(x => x.id === rowTenant)
            const vdcMissing = mapping.vdc && !tenantVdcs.some(v => v.id === mapping.vdc)

            return (
              <Box key={index} sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 1, alignItems: 'center' }}>
                <MappingOrderButtons
                  index={index}
                  count={groupMappings.length}
                  disabled={!config.enabled}
                  onMove={moveGroupMapping}
                  upLabel={t('common.moveUp')}
                  downLabel={t('common.moveDown')}
                />
                <TextField
                  size='small'
                  label={t('oidc.groupName')}
                  value={mapping.group}
                  onChange={e => updateGroupMapping(index, 'group', e.target.value)}
                  disabled={!config.enabled}
                  sx={{ flex: '1 1 200px', minWidth: 200 }}
                  placeholder='admins, devops, viewers...'
                />
                {showScopePickers && (
                  <>
                    <FormControl size='small' sx={{ width: SCOPE_FIELD_WIDTH }} disabled={!config.enabled}>
                      <InputLabel>{t('oidc.tenant')}</InputLabel>
                      <Select
                        value={rowTenant}
                        label={t('oidc.tenant')}
                        onChange={e => updateGroupMapping(index, 'tenant', e.target.value)}
                      >
                        {tenantMissing && <MenuItem value={rowTenant}>{rowTenant}</MenuItem>}
                        {tenants.map(tenant => (
                          <MenuItem key={tenant.id} value={tenant.id}>{tenant.name}</MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                    <FormControl size='small' sx={{ width: SCOPE_FIELD_WIDTH }} disabled={!config.enabled}>
                      <InputLabel shrink>{t('oidc.vdc')}</InputLabel>
                      <Select
                        value={mapping.vdc || ''}
                        label={t('oidc.vdc')}
                        displayEmpty
                        notched
                        onChange={e => updateGroupMapping(index, 'vdc', e.target.value)}
                      >
                        <MenuItem value=''>{t('oidc.vdcWholeTenant')}</MenuItem>
                        {vdcMissing && <MenuItem value={mapping.vdc}>{mapping.vdc}</MenuItem>}
                        {tenantVdcs.map(vdc => (
                          <MenuItem key={vdc.id} value={vdc.id}>{vdc.name}</MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </>
                )}
                <FormControl size='small' sx={{ width: SCOPE_FIELD_WIDTH }} disabled={!config.enabled}>
                  <InputLabel>{t('oidc.role')}</InputLabel>
                  <Select
                    value={mapping.role}
                    label={t('oidc.role')}
                    onChange={e => updateGroupMapping(index, 'role', e.target.value)}
                  >
                    {availableRoles.map(role => (
                      <MenuItem key={role.id} value={role.id}>{role.is_system ? t(`rbac.roles.${role.id}`) : role.name}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <IconButton size='small' onClick={() => removeGroupMapping(index)} disabled={!config.enabled}>
                  <i className='ri-delete-bin-line' />
                </IconButton>
              </Box>
            )
          })}

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
