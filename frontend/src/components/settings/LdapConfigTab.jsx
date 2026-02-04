'use client'

import { useEffect, useState } from 'react'

import { useTranslations } from 'next-intl'

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Divider,
  FormControlLabel,
  IconButton,
  InputAdornment,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'

/**
 * LdapConfigTab - Configuration LDAP/Active Directory
 * 
 * L'authentification LDAP est gérée par l'orchestrator Go pour des raisons de sécurité :
 * - Les credentials LDAP ne transitent jamais par le navigateur
 * - Le binding et la recherche sont effectués côté serveur
 * - Le mot de passe bind est chiffré en base de données
 */
export default function LdapConfigTab() {
  const t = useTranslations()
  
  const [config, setConfig] = useState({
    enabled: false,
    url: '',
    bind_dn: '',
    bind_password: '',
    base_dn: '',
    user_filter: '(uid={{username}})',
    email_attribute: 'mail',
    name_attribute: 'cn',
    tls_insecure: false,
  })

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [testResult, setTestResult] = useState(null)
  const [showPassword, setShowPassword] = useState(false)
  const [hasBindPassword, setHasBindPassword] = useState(false)

  useEffect(() => {
    loadConfig()
  }, [])

  const loadConfig = async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/v1/auth/ldap')
      const data = await res.json()

      if (res.ok && data.data) {
        setConfig(prev => ({ 
          ...prev, 
          ...data.data,
          bind_password: '' // Ne jamais pré-remplir le mot de passe
        }))
        setHasBindPassword(data.data.hasBindPassword || false)
      }
    } catch (e) {
      console.error('Error loading LDAP config:', e)
      setError(t('ldap.loadError'))
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
      const res = await fetch('/api/v1/auth/ldap', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || t('ldap.saveError'))
        return
      }

      setSuccess(t('ldap.saveSuccess'))
      
      // Mettre à jour l'indicateur de mot de passe
      if (config.bind_password) {
        setHasBindPassword(true)
        setConfig(prev => ({ ...prev, bind_password: '' }))
      }
    } catch (e) {
      setError(t('ldap.connectionError'))
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
      const res = await fetch('/api/v1/auth/ldap/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })

      const data = await res.json()

      if (res.ok && data.success) {
        setTestResult({ success: true, message: data.message || t('ldap.testSuccess') })
      } else {
        setTestResult({ success: false, message: data.error || data.message || t('ldap.testFailed') })
      }
    } catch (e) {
      setTestResult({ success: false, message: 'Erreur de connexion au serveur' })
    } finally {
      setTesting(false)
    }
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
          {t('ldap.description')}
        </Typography>
        <Alert severity='info' icon={<i className='ri-shield-check-line' />}>
          {t('ldap.securityInfo')}
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
          {testResult.message}
        </Alert>
      )}

      {/* Activation */}
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
                  {t('ldap.enableLdap')}
                </Typography>
                <Typography variant='body2' sx={{ opacity: 0.6 }}>
                  {t('ldap.enableLdapDesc')}
                </Typography>
              </Box>
            }
          />
        </CardContent>
      </Card>

      {/* Configuration Serveur */}
      <Card variant='outlined'>
        <CardContent>
          <Typography variant='subtitle1' fontWeight={700} sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
            <i className='ri-server-line' style={{ color: '#3b82f6' }} />
            {t('ldap.serverSection')}
          </Typography>

          <TextField
            fullWidth
            label={t('ldap.serverUrl')}
            value={config.url}
            onChange={e => setConfig({ ...config, url: e.target.value })}
            placeholder={t('ldap.serverUrlPlaceholder')}
            disabled={!config.enabled}
            helperText={t('ldap.serverUrlHelper')}
            sx={{ mb: 2 }}
          />

          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2, mb: 2 }}>
            <TextField
              fullWidth
              label={t('ldap.bindDn')}
              value={config.bind_dn}
              onChange={e => setConfig({ ...config, bind_dn: e.target.value })}
              placeholder={t('ldap.bindDnPlaceholder')}
              disabled={!config.enabled}
              helperText={t('ldap.bindDnHelper')}
            />

            <TextField
              fullWidth
              label={t('ldap.bindPassword')}
              type={showPassword ? 'text' : 'password'}
              value={config.bind_password}
              onChange={e => setConfig({ ...config, bind_password: e.target.value })}
              disabled={!config.enabled}
              placeholder={hasBindPassword ? '••••••••' : t('ldap.bindPasswordPlaceholder')}
              helperText={hasBindPassword ? t('ldap.bindPasswordKeep') : ''}
              InputProps={{
                endAdornment: (
                  <InputAdornment position='end'>
                    <IconButton size='small' onClick={() => setShowPassword(!showPassword)}>
                      <i className={showPassword ? 'ri-eye-off-line' : 'ri-eye-line'} />
                    </IconButton>
                  </InputAdornment>
                ),
              }}
            />
          </Box>

          <TextField
            fullWidth
            label={t('ldap.baseDn')}
            value={config.base_dn}
            onChange={e => setConfig({ ...config, base_dn: e.target.value })}
            placeholder={t('ldap.baseDnPlaceholder')}
            disabled={!config.enabled}
            helperText={t('ldap.baseDnHelper')}
          />

          <FormControlLabel
            control={
              <Switch
                checked={config.tls_insecure}
                onChange={e => setConfig({ ...config, tls_insecure: e.target.checked })}
                disabled={!config.enabled}
              />
            }
            label={t('ldap.tlsInsecure')}
            sx={{ mt: 2 }}
          />
        </CardContent>
      </Card>

      {/* Configuration Recherche */}
      <Card variant='outlined'>
        <CardContent>
          <Typography variant='subtitle1' fontWeight={700} sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
            <i className='ri-search-line' style={{ color: '#10b981' }} />
            {t('ldap.userSearchSection')}
          </Typography>

          <TextField
            fullWidth
            label={t('ldap.userFilter')}
            value={config.user_filter}
            onChange={e => setConfig({ ...config, user_filter: e.target.value })}
            placeholder={t('ldap.userFilterPlaceholder')}
            disabled={!config.enabled}
            helperText={t('ldap.userFilterHelper')}
            sx={{ mb: 2 }}
          />

          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
            <TextField
              fullWidth
              label={t('ldap.emailAttribute')}
              value={config.email_attribute}
              onChange={e => setConfig({ ...config, email_attribute: e.target.value })}
              placeholder='mail'
              disabled={!config.enabled}
              helperText={t('ldap.emailAttributeHelper')}
            />

            <TextField
              fullWidth
              label={t('ldap.nameAttribute')}
              value={config.name_attribute}
              onChange={e => setConfig({ ...config, name_attribute: e.target.value })}
              placeholder='cn ou displayName'
              disabled={!config.enabled}
              helperText={t('ldap.nameAttributeHelper')}
            />
          </Box>
        </CardContent>
      </Card>

      {/* Aide Active Directory */}
      <Card variant='outlined' sx={{ bgcolor: 'action.hover' }}>
        <CardContent>
          <Typography variant='subtitle1' fontWeight={700} sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
            <i className='ri-windows-line' style={{ color: '#0078d4' }} />
            {t('ldap.adConfigSection')}
          </Typography>

          <Typography variant='body2' sx={{ mb: 1 }}>
            {t('ldap.adConfigDesc')}
          </Typography>

          <Box component='ul' sx={{ pl: 2, '& li': { mb: 0.5 } }}>
            <li>
              <Typography variant='body2'>
                <strong>URL :</strong> <code>ldaps://dc.votredomaine.com:636</code>
              </Typography>
            </li>
            <li>
              <Typography variant='body2'>
                <strong>Bind DN :</strong> <code>CN=Service ProxCenter,OU=Services,DC=votredomaine,DC=com</code>
              </Typography>
            </li>
            <li>
              <Typography variant='body2'>
                <strong>Base DN :</strong> <code>OU=Users,DC=votredomaine,DC=com</code>
              </Typography>
            </li>
            <li>
              <Typography variant='body2'>
                <strong>Filtre :</strong> <code>(sAMAccountName={'{{username}}'})</code> ou <code>(userPrincipalName={'{{username}}'}@votredomaine.com)</code>
              </Typography>
            </li>
            <li>
              <Typography variant='body2'>
                <strong>Attribut email :</strong> <code>mail</code> ou <code>userPrincipalName</code>
              </Typography>
            </li>
            <li>
              <Typography variant='body2'>
                <strong>Attribut nom :</strong> <code>displayName</code>
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
              {saving ? t('ldap.saving') : t('ldap.save')}
            </Button>

            <Button
              variant='outlined'
              onClick={handleTest}
              disabled={testing || !config.enabled || !config.url}
              startIcon={testing ? <CircularProgress size={16} /> : <i className='ri-link' />}
            >
              {testing ? t('ldap.testing') : t('ldap.testConnection')}
            </Button>

            <Button
              variant='outlined'
              color='secondary'
              onClick={loadConfig}
              disabled={saving || testing}
              startIcon={<i className='ri-refresh-line' />}
            >
              {t('ldap.reset')}
            </Button>
          </Box>
        </CardContent>
      </Card>
    </Box>
  )
}
