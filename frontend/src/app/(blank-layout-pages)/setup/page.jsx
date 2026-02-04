'use client'

import { useState, useEffect } from 'react'

import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'

// MUI Imports
import {
  Alert,
  Box,
  Button,
  IconButton,
  InputAdornment,
  TextField,
  Typography,
  CircularProgress,
} from '@mui/material'

// Component Imports
import Logo from '@components/layout/shared/Logo'

export default function SetupPage() {
  const router = useRouter()
  const t = useTranslations()
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [setupRequired, setSetupRequired] = useState(false)
  const [isPasswordShown, setIsPasswordShown] = useState(false)

  // Form
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [name, setName] = useState('')

  useEffect(() => {
    // Vérifier si le setup est nécessaire
    fetch('/api/v1/auth/setup')
      .then(res => res.json())
      .then(data => {
        setSetupRequired(data.setupRequired)

        if (!data.setupRequired) {
          // Rediriger vers login si déjà configuré
          router.push('/login')
        }
      })
      .catch(() => setSetupRequired(true))
      .finally(() => setLoading(false))
  }, [router])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    // Validation
    if (password !== confirmPassword) {
      setError(t('setup.passwordMismatch'))

return
    }

    if (password.length < 8) {
      setError(t('setup.passwordMinLength'))

return
    }

    setSubmitting(true)

    try {
      const res = await fetch('/api/v1/auth/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, name }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || t('setup.creationError'))

return
      }

      setSuccess(true)
      setTimeout(() => router.push('/login'), 2000)
    } catch (err) {
      setError(t('setup.serverError'))
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <Box
        sx={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <CircularProgress />
      </Box>
    )
  }

  if (!setupRequired) {
    return null
  }

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: 'background.default',
        p: 2,
      }}
    >
      <Box
        sx={{
          width: '100%',
          maxWidth: 480,
          bgcolor: 'background.paper',
          borderRadius: 2,
          p: 4,
          boxShadow: 3,
        }}
      >
        {/* Logo */}
        <Box sx={{ display: 'flex', justifyContent: 'center', mb: 4 }}>
          <Logo />
        </Box>

        {/* Titre */}
        <Typography variant='h5' sx={{ fontWeight: 700, textAlign: 'center', mb: 1 }}>
          {t('setup.title')}
        </Typography>
        <Typography variant='body2' sx={{ opacity: 0.6, textAlign: 'center', mb: 3 }}>
          {t('setup.subtitle')}
        </Typography>

        {/* Success */}
        {success && (
          <Alert severity='success' sx={{ mb: 3 }}>
            {t('setup.successMessage')}
          </Alert>
        )}

        {/* Erreur */}
        {error && (
          <Alert severity='error' sx={{ mb: 3 }}>
            {error}
          </Alert>
        )}

        {/* Formulaire */}
        {!success && (
          <form onSubmit={handleSubmit}>
            <TextField
              fullWidth
              label={t('setup.nameLabel')}
              value={name}
              onChange={e => setName(e.target.value)}
              sx={{ mb: 2 }}
              placeholder={t('setup.namePlaceholder')}
            />
            <TextField
              fullWidth
              label={t('setup.emailLabel')}
              type='email'
              value={email}
              onChange={e => setEmail(e.target.value)}
              sx={{ mb: 2 }}
              required
              autoFocus
              placeholder='admin@example.com'
            />
            <TextField
              fullWidth
              label={t('setup.passwordLabel')}
              type={isPasswordShown ? 'text' : 'password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              sx={{ mb: 2 }}
              required
              helperText={t('setup.passwordHelper')}
              InputProps={{
                endAdornment: (
                  <InputAdornment position='end'>
                    <IconButton
                      size='small'
                      edge='end'
                      onClick={() => setIsPasswordShown(!isPasswordShown)}
                    >
                      <i className={isPasswordShown ? 'ri-eye-off-line' : 'ri-eye-line'} />
                    </IconButton>
                  </InputAdornment>
                ),
              }}
            />
            <TextField
              fullWidth
              label={t('setup.confirmPasswordLabel')}
              type={isPasswordShown ? 'text' : 'password'}
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              sx={{ mb: 3 }}
              required
              error={confirmPassword !== '' && password !== confirmPassword}
              helperText={
                confirmPassword !== '' && password !== confirmPassword
                  ? t('setup.passwordMismatch')
                  : ''
              }
            />

            <Button
              fullWidth
              variant='contained'
              type='submit'
              disabled={submitting}
              sx={{ py: 1.5 }}
            >
              {submitting ? t('setup.creating') : t('setup.createAccount')}
            </Button>
          </form>
        )}

        {/* Info */}
        <Alert severity='info' sx={{ mt: 3 }}>
          {t('setup.adminRightsInfo')}
        </Alert>
      </Box>
    </Box>
  )
}
