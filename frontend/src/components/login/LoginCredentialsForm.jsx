'use client'

import { useCallback, useRef } from 'react'

import {
  Box, Button, Checkbox, CircularProgress, FormControlLabel,
  IconButton, InputAdornment, TextField, Typography,
} from '@mui/material'
import { useTranslations } from 'next-intl'

export default function LoginCredentialsForm({
  authMethod,
  email, setEmail,
  username, setUsername,
  password, setPassword,
  isPasswordShown, setIsPasswordShown,
  rememberMe, setRememberMe,
  capsLock, onPasswordKey,
  loading,
  onSubmit,
}) {
  const t = useTranslations()
  const passwordRef = useRef(null)

  const handleSubmit = useCallback((e) => {
    e.preventDefault()
    onSubmit()
  }, [onSubmit])

  return (
    <Box component='form' onSubmit={handleSubmit}>
      {authMethod === 'local' ? (
        <TextField
          fullWidth
          label='Email'
          type='email'
          value={email}
          onChange={e => setEmail(e.target.value)}
          sx={{ mb: 2 }}
          autoFocus={!email}
          required
          disabled={loading}
        />
      ) : (
        <TextField
          fullWidth
          label={t('auth.username')}
          value={username}
          onChange={e => setUsername(e.target.value)}
          sx={{ mb: 2 }}
          autoFocus
          required
          disabled={loading}
          placeholder={t('auth.usernamePlaceholder')}
        />
      )}
      <TextField
        fullWidth
        label={t('auth.password')}
        type={isPasswordShown ? 'text' : 'password'}
        value={password}
        onChange={e => setPassword(e.target.value)}
        onKeyDown={onPasswordKey}
        onKeyUp={onPasswordKey}
        inputRef={passwordRef}
        autoFocus={!!email && authMethod === 'local'}
        sx={{ mb: capsLock ? 1 : 2 }}
        required
        disabled={loading}
        InputProps={{
          endAdornment: (
            <InputAdornment position='end'>
              <IconButton
                size='small'
                edge='end'
                onClick={() => setIsPasswordShown(!isPasswordShown)}
                aria-label={isPasswordShown ? 'Hide password' : 'Show password'}
              >
                <i className={isPasswordShown ? 'ri-eye-off-line' : 'ri-eye-line'} />
              </IconButton>
            </InputAdornment>
          ),
        }}
      />
      {capsLock && (
        <Typography
          variant='caption'
          sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: 'warning.main', mb: 2 }}
        >
          <i className='ri-lock-unlock-line' style={{ fontSize: 14 }} />
          {t('auth.capsLockOn')}
        </Typography>
      )}
      {authMethod === 'local' && (
        <Box sx={{ mb: 3 }}>
          <FormControlLabel
            control={
              <Checkbox
                checked={rememberMe}
                onChange={e => setRememberMe(e.target.checked)}
                size='small'
                disabled={loading}
              />
            }
            label={<Typography variant='body2'>{t('auth.rememberMe')}</Typography>}
          />
        </Box>
      )}
      {authMethod === 'ldap' && <Box sx={{ mb: 3 }} />}
      <Button
        fullWidth
        variant='contained'
        type='submit'
        disabled={loading}
        size='large'
        sx={{ py: 1.5, fontWeight: 600 }}
      >
        {loading ? <CircularProgress size={20} color='inherit' /> : t('auth.login')}
      </Button>
    </Box>
  )
}
