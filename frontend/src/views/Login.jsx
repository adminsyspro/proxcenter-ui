'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { signIn } from 'next-auth/react'
import { useTranslations } from 'next-intl'
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography
} from '@mui/material'
import LoginShell from '@components/login/LoginShell'
import { useBranding } from '@/contexts/BrandingContext'

export default function LoginPage({ forceLocal = false }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const callbackUrl = searchParams.get('callbackUrl') || '/'
  const errorParam = searchParams.get('error')
  const t = useTranslations()
  const { branding, loading: brandingLoading } = useBranding()

  const [authMethod, setAuthMethod] = useState('local')
  const [isPasswordShown, setIsPasswordShown] = useState(false)
  const [loading, setLoading] = useState(false)
  const [checkingSetup, setCheckingSetup] = useState(true)
  const [error, setError] = useState('')
  const [ldapEnabled, setLdapEnabled] = useState(false)
  const [oidcEnabled, setOidcEnabled] = useState(false)
  const [oidcProviderName, setOidcProviderName] = useState('SSO')
  // SSO-only login behavior (from /api/v1/auth/providers).
  const [showLocalLogin, setShowLocalLogin] = useState(true)
  const [forceSsoRedirect, setForceSsoRedirect] = useState(false)
  // Gate the form render until providers are known, so the local form never
  // flashes before an auto-redirect or a hide decision.
  const [providersLoaded, setProvidersLoaded] = useState(false)
  const [redirectingSso, setRedirectingSso] = useState(false)
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [rememberMe, setRememberMe] = useState(false)
  const [capsLock, setCapsLock] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [totpStep, setTotpStep] = useState(false)
  const [totpCode, setTotpCode] = useState('')
  const [totpError, setTotpError] = useState('')
  const [totpLoading, setTotpLoading] = useState(false)

  useEffect(() => { setMounted(true) }, [])

  const handleKeyEvent = useCallback((e) => {
    if (e.getModifierState) setCapsLock(e.getModifierState('CapsLock'))
  }, [])

  useEffect(() => {
    fetch('/api/v1/app/status')
      .then(res => res.json())
      .then(data => {
        if (data.setupRequired) router.push('/setup')
        else setCheckingSetup(false)
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
        setShowLocalLogin(data.showLocalLogin !== false)
        setForceSsoRedirect(data.forceSsoRedirect || false)
      })
      .catch(() => {})
      // Always mark providers as resolved (even on failure) so the form falls
      // back to visible rather than spinning forever — never lock the admin out.
      .finally(() => setProvidersLoaded(true))
    if (errorParam) setError(decodeURIComponent(errorParam))
  }, [errorParam])

  // Auto-redirect to the IdP when forced. Skipped on the /access escape hatch
  // and whenever an OIDC error bounced us back (?error=), to avoid a loop.
  useEffect(() => {
    if (
      providersLoaded &&
      oidcEnabled &&
      forceSsoRedirect &&
      !forceLocal &&
      !errorParam &&
      !redirectingSso
    ) {
      setRedirectingSso(true)
      signIn('oidc', { callbackUrl })
    }
  }, [providersLoaded, oidcEnabled, forceSsoRedirect, forceLocal, errorParam, redirectingSso, callbackUrl])

  const handleLogin = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const result = authMethod === 'local'
        ? await signIn('credentials', { email, password, redirect: false, callbackUrl })
        : await signIn('ldap', { username, password, redirect: false, callbackUrl })
      if (result?.error === 'TOTP_REQUIRED') {
        setTotpStep(true)
        setTotpError('')
        setTotpCode('')
      } else if (result?.error) {
        setError(result.error)
      } else if (result?.ok) {
        router.push(callbackUrl)
        router.refresh()
      }
    } catch {
      setError(t('auth.loginError'))
    } finally {
      setLoading(false)
    }
  }, [authMethod, email, password, username, callbackUrl, router, t])

  const handleTotpSubmit = useCallback(async (e) => {
    e?.preventDefault?.()
    if (!totpCode.trim()) return
    setTotpLoading(true)
    setTotpError('')
    try {
      const result = authMethod === 'local'
        ? await signIn('credentials', {
            email, password, totpCode: totpCode.trim(),
            redirect: false, callbackUrl
          })
        : await signIn('ldap', {
            username, password, totpCode: totpCode.trim(),
            redirect: false, callbackUrl
          })
      if (result?.error) {
        setTotpError(t('twoFactor.loginTotpInvalid'))
      } else if (result?.ok) {
        router.push(callbackUrl)
        router.refresh()
      }
    } catch {
      setTotpError(t('twoFactor.loginTotpInvalid'))
    } finally {
      setTotpLoading(false)
    }
  }, [authMethod, email, password, username, totpCode, callbackUrl, router, t])

  const handleTotpCancel = useCallback(() => {
    setTotpStep(false)
    setTotpCode('')
    setTotpError('')
    setPassword('')
  }, [])

  const handleSso = useCallback(() => {
    signIn('oidc', { callbackUrl })
  }, [callbackUrl])

  // Hold the full-screen spinner until setup + providers are known, and while
  // an SSO auto-redirect is in flight, so the local form never flashes.
  if (checkingSetup || !providersLoaded || redirectingSso) {
    return (
      <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <CircularProgress />
      </Box>
    )
  }

  // On /access (forceLocal) the local form is always shown. Otherwise it
  // follows the showLocalLogin flag.
  const showLocalForm = forceLocal || showLocalLogin

  return (
    <>
      <LoginShell
        branding={branding}
        brandingLoading={brandingLoading}
        ldapEnabled={ldapEnabled}
        oidcEnabled={oidcEnabled}
        oidcProviderName={oidcProviderName}
        showLocalForm={showLocalForm}
        authMethod={authMethod}
        setAuthMethod={setAuthMethod}
        email={email} setEmail={setEmail}
        username={username} setUsername={setUsername}
        password={password} setPassword={setPassword}
        isPasswordShown={isPasswordShown} setIsPasswordShown={setIsPasswordShown}
        rememberMe={rememberMe} setRememberMe={setRememberMe}
        capsLock={capsLock} onPasswordKey={handleKeyEvent}
        loading={loading}
        error={error}
        mounted={mounted}
        onSubmit={handleLogin}
        onSso={handleSso}
      />
      <Dialog open={totpStep} onClose={handleTotpCancel} fullWidth maxWidth='xs'>
        <DialogTitle>{t('twoFactor.loginTotpTitle')}</DialogTitle>
        <DialogContent>
          <Box component='form' onSubmit={handleTotpSubmit} sx={{ pt: 1 }}>
            <TextField
              autoFocus
              fullWidth
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value)}
              placeholder='123456'
              inputProps={{ maxLength: 11, autoComplete: 'one-time-code' }}
              error={!!totpError}
              helperText={totpError || t('twoFactor.loginRecoveryHint')}
              disabled={totpLoading}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleTotpCancel} disabled={totpLoading}>
            {t('twoFactor.loginBack')}
          </Button>
          <Button
            onClick={handleTotpSubmit}
            variant='contained'
            disabled={!totpCode.trim() || totpLoading}
          >
            {totpLoading ? <CircularProgress size={18} sx={{ color: 'inherit' }} /> : t('twoFactor.wizardVerify')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
