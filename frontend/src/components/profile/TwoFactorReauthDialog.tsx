'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'

import {
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  Stack,
  TextField,
  Typography,
} from '@mui/material'

import AppDialogTitle from '@/components/ui/AppDialogTitle'

import type { ReactNode } from 'react'

// Removing or replacing a second factor asks for both factors (roadmap#280):
// the password (when the account has one) and a current authenticator code
// or an unused recovery code, sent in `totpCode`.
export type ReauthCredential = { password?: string; totpCode: string }

const TOTP_RE = /^\d{6}$/
const RECOVERY_RE = /^[A-Z2-9]{5}-[A-Z2-9]{5}$/

/** A 6-digit authenticator code or a XXXXX-XXXXX recovery code. */
export function isSecondFactorCode(value: string): boolean {
  const code = value.trim().toUpperCase()
  return TOTP_RE.test(code) || RECOVERY_RE.test(code)
}

interface TwoFactorReauthDialogProps {
  open: boolean
  onClose: () => void
  onConfirm: (credential: ReauthCredential) => void | Promise<void>
  title: ReactNode
  /** false for an account without a local password (SSO): the code alone. */
  passwordRequired?: boolean
}

export default function TwoFactorReauthDialog({
  open,
  onClose,
  onConfirm,
  title,
  passwordRequired = true,
}: TwoFactorReauthDialogProps) {
  const t = useTranslations()
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)

  // Reset local state every time the dialog transitions to closed. Covers
  // both `handleClose` and the parent closing it via the `open` prop after
  // confirm, so sensitive credentials never linger across openings.
  useEffect(() => {
    if (!open) {
      setPassword('')
      setCode('')
    }
  }, [open])

  const isValid = (!passwordRequired || password.length > 0) && isSecondFactorCode(code)

  const handleConfirm = async () => {
    if (!isValid) return
    setLoading(true)
    const totpCode = code.trim().toUpperCase()
    const cred: ReauthCredential = passwordRequired ? { password, totpCode } : { totpCode }
    try {
      await onConfirm(cred)
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    setPassword('')
    setCode('')
    onClose()
  }

  const onEnter = (e: { key: string }) => {
    if (e.key === 'Enter') void handleConfirm()
  }

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
          {passwordRequired ? t('twoFactor.reauthDesc') : t('twoFactor.reauthDescCodeOnly')}
        </Typography>

        <Stack spacing={2}>
          {passwordRequired && (
            <TextField
              fullWidth
              size='small'
              type='password'
              label={t('twoFactor.reauthPasswordLabel')}
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={onEnter}
              autoComplete='current-password'
              autoFocus
            />
          )}
          <TextField
            fullWidth
            size='small'
            label={t('twoFactor.reauthTotpLabel')}
            value={code}
            onChange={e => setCode(e.target.value.replace(/[^0-9A-Za-z-]/g, '').slice(0, 11))}
            slotProps={{ htmlInput: { maxLength: 11, autoCapitalize: 'characters', spellCheck: false } }}
            onKeyDown={onEnter}
            autoComplete='one-time-code'
            autoFocus={!passwordRequired}
          />
        </Stack>
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
