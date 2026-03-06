'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { signIn } from 'next-auth/react'
import { useTranslations } from 'next-intl'
import {
  Alert, Box, Button, Checkbox, Chip, CircularProgress, Divider, Fade, FormControl, FormControlLabel,
  IconButton, InputAdornment, InputLabel, MenuItem, Select, TextField, Tooltip, Typography, alpha, useTheme
} from '@mui/material'
import Logo from '@components/layout/shared/Logo'
import LoginBackground from '@components/LoginBackground'
import { useSettings } from '@core/hooks/useSettings'

export default function LoginPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const callbackUrl = searchParams.get('callbackUrl') || '/'
  const errorParam = searchParams.get('error')
  const t = useTranslations()
  const theme = useTheme()
  const { settings, updateSettings } = useSettings()

  const [authMethod, setAuthMethod] = useState('local')
  const [isPasswordShown, setIsPasswordShown] = useState(false)
  const [loading, setLoading] = useState(false)
  const [checkingSetup, setCheckingSetup] = useState(true)
  const [error, setError] = useState('')
  const [ldapEnabled, setLdapEnabled] = useState(false)
  const [oidcEnabled, setOidcEnabled] = useState(false)
  const [oidcProviderName, setOidcProviderName] = useState('SSO')
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [rememberMe, setRememberMe] = useState(false)
  const [capsLock, setCapsLock] = useState(false)
  const [mounted, setMounted] = useState(false)
  const passwordRef = useRef(null)

  // Fade-in animation on mount
  useEffect(() => { setMounted(true) }, [])

  // Caps Lock detection
  const handleKeyEvent = useCallback((e) => {
    if (e.getModifierState) setCapsLock(e.getModifierState('CapsLock'))
  }, [])

  // Vérifier si le setup initial est requis
  useEffect(() => {
    fetch('/api/v1/app/status')
      .then(res => res.json())
      .then(data => {
        if (data.setupRequired) {
          router.push('/setup')
        } else {
          setCheckingSetup(false)
        }
      })
      .catch(() => setCheckingSetup(false))
  }, [router])

  useEffect(() => {
    fetch('/api/v1/auth/providers')
      .then(res => res.json())
      .then(data => {
        setLdapEnabled(data.ldapEnabled || false)
        setOidcEnabled(data.oidcEnabled || false)
        setOidcProviderName(data.oidcProviderName || 'SSO')
      })
      .catch(() => {})
    if (errorParam) setError(decodeURIComponent(errorParam))
  }, [errorParam])

  const handleLogin = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const result = authMethod === 'local'
        ? await signIn('credentials', { email, password, redirect: false, callbackUrl })
        : await signIn('ldap', { username, password, redirect: false, callbackUrl })
      if (result?.error) setError(result.error)
      else if (result?.ok) { router.push(callbackUrl); router.refresh() }
    } catch { setError(t('auth.loginError')) }
    finally { setLoading(false) }
  }

  // Afficher un loader pendant la vérification du setup
  if (checkingSetup) {
    return (
      <LoginBackground>
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <CircularProgress />
        </Box>
      </LoginBackground>
    )
  }

  // Theme toggle: cycle light → dark → system
  const nextMode = settings.mode === 'light' ? 'dark' : settings.mode === 'dark' ? 'system' : 'light'
  const modeIcon = settings.mode === 'dark' ? 'ri-moon-clear-line' : settings.mode === 'system' ? 'ri-computer-line' : 'ri-sun-line'

  return (
    <LoginBackground>
      <Fade in={mounted} timeout={600}>
        <Box sx={{
          width: '100%', maxWidth: 440,
          bgcolor: alpha(theme.palette.background.paper, 0.95),
          backdropFilter: 'blur(20px)', borderRadius: 3, p: 4,
          boxShadow: `0 8px 32px ${alpha('#000', 0.3)}`,
          border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
          position: 'relative',
        }}>
          {/* Theme toggle */}
          <Tooltip title={settings.mode === 'light' ? 'Dark' : settings.mode === 'dark' ? 'System' : 'Light'}>
            <IconButton
              size='small'
              onClick={() => updateSettings({ mode: nextMode })}
              sx={{ position: 'absolute', top: 12, right: 12, opacity: 0.5, '&:hover': { opacity: 1 } }}
            >
              <i className={modeIcon} />
            </IconButton>
          </Tooltip>

          <Box sx={{ display: 'flex', justifyContent: 'center', mb: 4 }}><Logo /></Box>
          <Typography variant='h5' sx={{ fontWeight: 700, textAlign: 'center', mb: 1 }}>{t('auth.welcomeTitle')}</Typography>
          <Typography variant='body2' sx={{ opacity: 0.6, textAlign: 'center', mb: 3 }}>{t('auth.loginSubtitle')}</Typography>
          {error && <Alert severity='error' sx={{ mb: 3 }}>{error}</Alert>}
          <form onSubmit={handleLogin}>
            {ldapEnabled && (
              <FormControl fullWidth sx={{ mb: 2 }}>
                <InputLabel>{t('auth.loginMethod')}</InputLabel>
                <Select value={authMethod} label={t('auth.loginMethod')} onChange={e => setAuthMethod(e.target.value)}>
                  <MenuItem value='local'><Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}><i className='ri-user-line' />{t('auth.localAccount')}</Box></MenuItem>
                  <MenuItem value='ldap'><Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}><i className='ri-server-line' />{t('auth.ldapAd')}</Box></MenuItem>
                </Select>
              </FormControl>
            )}
            {authMethod === 'local' ? (
              <TextField fullWidth label='Email' type='email' value={email} onChange={e => setEmail(e.target.value)} sx={{ mb: 2 }} autoFocus={!email} required />
            ) : (
              <TextField fullWidth label={t('auth.username')} value={username} onChange={e => setUsername(e.target.value)} sx={{ mb: 2 }} autoFocus required placeholder={t('auth.usernamePlaceholder')} />
            )}
            <TextField
              fullWidth
              label={t('auth.password')}
              type={isPasswordShown ? 'text' : 'password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={handleKeyEvent}
              onKeyUp={handleKeyEvent}
              inputRef={passwordRef}
              autoFocus={!!email}
              sx={{ mb: capsLock ? 1 : 2 }}
              required
              InputProps={{ endAdornment: (
                <InputAdornment position='end'>
                  <IconButton size='small' edge='end' onClick={() => setIsPasswordShown(!isPasswordShown)}>
                    <i className={isPasswordShown ? 'ri-eye-off-line' : 'ri-eye-line'} />
                  </IconButton>
                </InputAdornment>
              )}}
            />
            {capsLock && (
              <Typography variant='caption' sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: 'warning.main', mb: 2 }}>
                <i className='ri-lock-unlock-line' style={{ fontSize: 14 }} />
                {t('auth.capsLockOn')}
              </Typography>
            )}
            {authMethod === 'local' && (
              <Box sx={{ mb: 3 }}>
                <FormControlLabel control={<Checkbox checked={rememberMe} onChange={e => setRememberMe(e.target.checked)} size='small' />} label={<Typography variant='body2'>{t('auth.rememberMe')}</Typography>} />
              </Box>
            )}
            {authMethod === 'ldap' && <Box sx={{ mb: 3 }} />}
            <Button fullWidth variant='contained' type='submit' disabled={loading} sx={{ py: 1.5 }}>{loading ? t('auth.loggingIn') : t('auth.login')}</Button>
          </form>
          {oidcEnabled && (
            <>
              <Divider sx={{ my: 2 }}>
                <Typography variant='caption' sx={{ opacity: 0.5 }}>{t('auth.or')}</Typography>
              </Divider>
              <Button
                fullWidth
                variant='outlined'
                onClick={() => signIn('oidc', { callbackUrl })}
                startIcon={<i className='ri-shield-keyhole-line' />}
                sx={{ py: 1.5 }}
              >
                {t('auth.signInWithSso', { provider: oidcProviderName })}
              </Button>
            </>
          )}
          <Divider sx={{ my: 3 }} />
          <Typography variant='caption' sx={{ display: 'block', textAlign: 'center', opacity: 0.5 }}>ProxCenter - {t('auth.appSubtitle')}</Typography>
        </Box>
      </Fade>
    </LoginBackground>
  )
}
