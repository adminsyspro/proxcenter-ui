'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'

import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'

import AppDialogTitle from '@/components/ui/AppDialogTitle'

export default function TwoFactorReauthDialog({
  open,
  onClose,
  onConfirm,
  title,
}) {
  const t = useTranslations()
  const [mode, setMode] = useState('password') // 'password' | 'totp'
  const [value, setValue] = useState('')
  const [loading, setLoading] = useState(false)

  const handleModeChange = (_, next) => {
    if (next !== null) {
      setMode(next)
      setValue('')
    }
  }

  // Reset local state every time the dialog transitions to closed. Covers
  // both `handleClose` and the parent closing it via the `open` prop after
  // confirm, so sensitive credentials never linger across openings.
  useEffect(() => {
    if (!open) {
      setValue('')
      setMode('password')
    }
  }, [open])

  const handleConfirm = async () => {
    setLoading(true)
    const cred = mode === 'password' ? { password: value } : { totpCode: value }
    try {
      await onConfirm(cred)
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    setValue('')
    setMode('password')
    onClose()
  }

  const isValid = mode === 'password' ? value.length > 0 : value.length === 6

  return (
    <Dialog open={open} onClose={handleClose} maxWidth='xs' fullWidth>
      <AppDialogTitle
        onClose={handleClose}
        icon={<i className='ri-lock-password-line' style={{ fontSize: 20 }} />}
      >
        {title || t('twoFactor.reauthTitle')}
      </AppDialogTitle>

      <DialogContent sx={{ pt: 2, pb: 1 }}>
        <Typography variant='body2' color='text.secondary' sx={{ mb: 2 }}>
          {t('twoFactor.reauthDesc')}
        </Typography>

        <ToggleButtonGroup
          value={mode}
          exclusive
          onChange={handleModeChange}
          size='small'
          fullWidth
          sx={{ mb: 2 }}
        >
          <ToggleButton value='password'>
            {t('twoFactor.reauthModePassword')}
          </ToggleButton>
          <ToggleButton value='totp'>
            {t('twoFactor.reauthModeTotp')}
          </ToggleButton>
        </ToggleButtonGroup>

        {mode === 'password' ? (
          <TextField
            fullWidth
            size='small'
            type='password'
            label={t('twoFactor.reauthPasswordLabel')}
            value={value}
            onChange={e => setValue(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && isValid) handleConfirm() }}
            autoFocus
          />
        ) : (
          <TextField
            fullWidth
            size='small'
            label={t('twoFactor.reauthTotpLabel')}
            value={value}
            onChange={e => setValue(e.target.value.replace(/\D/g, '').slice(0, 6))}
            inputProps={{ inputMode: 'numeric', pattern: '\\d{6}', maxLength: 6 }}
            onKeyDown={e => { if (e.key === 'Enter' && isValid) handleConfirm() }}
            autoFocus
          />
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2, gap: 1 }}>
        <Button variant='outlined' color='inherit' onClick={handleClose} disabled={loading}>
          {t('common.cancel')}
        </Button>
        <Button
          variant='contained'
          onClick={handleConfirm}
          disabled={loading || !isValid}
        >
          {loading
            ? <CircularProgress size={18} sx={{ color: 'inherit' }} />
            : t('twoFactor.reauthConfirm')
          }
        </Button>
      </DialogActions>
    </Dialog>
  )
}
