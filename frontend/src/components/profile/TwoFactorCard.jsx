'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { useSession } from 'next-auth/react'

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  Divider,
  Stack,
  Typography,
} from '@mui/material'

import AppDialogTitle from '@/components/ui/AppDialogTitle'
import TwoFactorEnrollWizard from './TwoFactorEnrollWizard'
import TwoFactorReauthDialog from './TwoFactorReauthDialog'

// ---- Small inline recovery-codes viewer after regeneration ------

function RecoveryCodesViewer({ codes, onClose }) {
  const t = useTranslations()

  const handleDownload = () => {
    const date = new Date().toISOString().split('T')[0]
    const blob = new Blob([codes.join('\n')], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `proxcenter-recovery-codes-${date}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Dialog open onClose={onClose} maxWidth='sm' fullWidth>
      <AppDialogTitle
        onClose={onClose}
        icon={<i className='ri-key-2-line' style={{ fontSize: 20 }} />}
      >
        {t('twoFactor.newCodesTitle')}
      </AppDialogTitle>
      <DialogContent sx={{ pt: 1 }}>
        <Alert severity='warning' sx={{ mb: 2 }}>
          {t('twoFactor.newCodesWarning')}
        </Alert>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2 }}>
          {codes.map(code => (
            <Chip
              key={code}
              label={code}
              size='small'
              variant='outlined'
              sx={{ fontSize: '0.8125rem', letterSpacing: '0.03em' }}
            />
          ))}
        </Box>
        <Button
          variant='outlined'
          size='small'
          startIcon={<i className='ri-download-line' />}
          onClick={handleDownload}
        >
          {t('twoFactor.wizardDownloadCodes')}
        </Button>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button variant='contained' onClick={onClose}>
          {t('common.close')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

// ---- Main card --------------------------------------------------

export default function TwoFactorCard() {
  const t = useTranslations()
  const { data: session } = useSession()

  const [status, setStatus] = useState(null)   // { enabled, enrolledAt, recoveryCodesRemaining }
  const [statusLoading, setStatusLoading] = useState(true)
  const [statusError, setStatusError] = useState('')

  // dialog states
  const [wizardOpen, setWizardOpen] = useState(false)
  const [regenReauthOpen, setRegenReauthOpen] = useState(false)
  const [disableReauthOpen, setDisableReauthOpen] = useState(false)
  const [newCodes, setNewCodes] = useState(null)       // string[] | null
  const [policyLockError, setPolicyLockError] = useState('')

  const fetchStatus = useCallback(async () => {
    setStatusLoading(true)
    setStatusError('')
    try {
      const res = await fetch('/api/v1/auth/2fa/status')
      const data = await res.json()
      if (res.ok) {
        setStatus(data.data)
      } else {
        setStatusError(data?.error || t('common.error'))
      }
    } catch {
      setStatusError(t('settings.connectionError'))
    } finally {
      setStatusLoading(false)
    }
  }, [t])

  useEffect(() => { fetchStatus() }, [fetchStatus])

  // ---- OIDC notice -----------------------------------------------
  if (session?.user?.authProvider === 'oidc') {
    return (
      <Card variant='outlined'>
        <CardContent sx={{ p: 3 }}>
          <Typography variant='h6' sx={{ fontWeight: 600, mb: 2 }}>
            {t('twoFactor.cardTitle')}
          </Typography>
          <Alert severity='info'>
            {t('twoFactor.oidcNotice')}
          </Alert>
        </CardContent>
      </Card>
    )
  }

  // ---- Loading / error -------------------------------------------
  if (statusLoading) {
    return (
      <Card variant='outlined'>
        <CardContent sx={{ p: 3, display: 'flex', alignItems: 'center', gap: 2 }}>
          <CircularProgress size={20} />
          <Typography variant='body2' color='text.secondary'>
            {t('twoFactor.cardTitle')}
          </Typography>
        </CardContent>
      </Card>
    )
  }

  // ---- Handlers --------------------------------------------------

  const handleWizardDone = () => {
    setWizardOpen(false)
    fetchStatus()
  }

  const handleRegen = async (cred) => {
    setRegenReauthOpen(false)
    try {
      const res = await fetch('/api/v1/auth/2fa/recovery-codes/regenerate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cred),
      })
      const data = await res.json()
      if (res.ok) {
        setNewCodes(data.data.recoveryCodes)
        fetchStatus()
      } else {
        // surface error inline, not critical enough for a crash
        setStatusError(data?.error || t('common.error'))
      }
    } catch {
      setStatusError(t('settings.connectionError'))
    }
  }

  const handleDisable = async (cred) => {
    setDisableReauthOpen(false)
    setPolicyLockError('')
    try {
      const res = await fetch('/api/v1/auth/2fa/disable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cred),
      })
      const data = await res.json()
      if (res.ok) {
        fetchStatus()
      } else if (data?.error === 'POLICY_LOCK' || res.status === 409) {
        setPolicyLockError(t('twoFactor.policyLockError'))
      } else {
        setStatusError(data?.error || t('common.error'))
      }
    } catch {
      setStatusError(t('settings.connectionError'))
    }
  }

  // ---- Render card body ------------------------------------------

  const codesLow = status?.recoveryCodesRemaining < 3

  return (
    <>
      <Card variant='outlined'>
        <CardContent sx={{ p: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <i className='ri-shield-keyhole-line' style={{ fontSize: 20, opacity: 0.7 }} />
              <Typography variant='h6' sx={{ fontWeight: 600 }}>
                {t('twoFactor.cardTitle')}
              </Typography>
            </Box>
            {status?.enabled && (
              <Chip
                label={t('twoFactor.statusEnabled')}
                color='success'
                size='small'
                icon={<i className='ri-shield-check-line' style={{ fontSize: 14 }} />}
              />
            )}
          </Box>

          {statusError && (
            <Alert severity='error' sx={{ mb: 2 }} onClose={() => setStatusError('')}>
              {statusError}
            </Alert>
          )}

          {policyLockError && (
            <Alert severity='warning' sx={{ mb: 2 }} onClose={() => setPolicyLockError('')}>
              {policyLockError}
            </Alert>
          )}

          {!status?.enabled ? (
            // ---- Not enrolled ----
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Typography variant='body2' color='text.secondary'>
                {t('twoFactor.cardDisabledHelper')}
              </Typography>
              <Box>
                <Button
                  variant='contained'
                  startIcon={<i className='ri-shield-keyhole-line' />}
                  onClick={() => setWizardOpen(true)}
                >
                  {t('twoFactor.enableButton')}
                </Button>
              </Box>
            </Box>
          ) : (
            // ---- Enrolled ----
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Stack
                direction='row'
                divider={<Divider orientation='vertical' flexItem />}
                spacing={3}
                sx={{ flexWrap: 'wrap', rowGap: 1.5 }}
              >
                <Box>
                  <Typography variant='caption' color='text.secondary' display='block'>
                    {t('twoFactor.enabledSince')}
                  </Typography>
                  <Typography variant='body2' sx={{ fontWeight: 500 }}>
                    {status.enrolledAt
                      ? new Date(status.enrolledAt).toLocaleDateString()
                      : t('common.unknown')
                    }
                  </Typography>
                </Box>
                <Box>
                  <Typography variant='caption' color='text.secondary' display='block'>
                    {t('twoFactor.recoveryCodesRemaining')}
                  </Typography>
                  <Typography
                    variant='body2'
                    sx={{ fontWeight: codesLow ? 600 : 500, color: codesLow ? 'warning.main' : 'text.primary' }}
                  >
                    {status.recoveryCodesRemaining ?? 0}
                    {codesLow && ` (${t('twoFactor.recoveryCodesLow')})`}
                  </Typography>
                </Box>
              </Stack>

              <Divider />

              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                <Button
                  variant='outlined'
                  size='small'
                  startIcon={<i className='ri-refresh-line' />}
                  onClick={() => setRegenReauthOpen(true)}
                >
                  {t('twoFactor.regenCodesButton')}
                </Button>
                <Button
                  variant='outlined'
                  color='error'
                  size='small'
                  startIcon={<i className='ri-shield-cross-line' />}
                  onClick={() => setDisableReauthOpen(true)}
                >
                  {t('twoFactor.disableButton')}
                </Button>
              </Box>
            </Box>
          )}
        </CardContent>
      </Card>

      {/* Enroll wizard */}
      <TwoFactorEnrollWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onDone={handleWizardDone}
      />

      {/* Reauth for regenerate */}
      <TwoFactorReauthDialog
        open={regenReauthOpen}
        onClose={() => setRegenReauthOpen(false)}
        onConfirm={handleRegen}
        title={t('twoFactor.regenReauthTitle')}
      />

      {/* Reauth for disable */}
      <TwoFactorReauthDialog
        open={disableReauthOpen}
        onClose={() => setDisableReauthOpen(false)}
        onConfirm={handleDisable}
        title={t('twoFactor.disableReauthTitle')}
      />

      {/* New codes viewer after regeneration */}
      {newCodes && (
        <RecoveryCodesViewer
          codes={newCodes}
          onClose={() => setNewCodes(null)}
        />
      )}
    </>
  )
}
