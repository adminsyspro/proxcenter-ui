'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'

import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  FormControlLabel,
  TextField,
  Typography,
} from '@mui/material'

import AppDialogTitle from '@/components/ui/AppDialogTitle'

// ---- Step 1: Scan QR code ----------------------------------------

function StepScanQr({ onNext, onCancel, forced }) {
  const t = useTranslations()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [enrollData, setEnrollData] = useState(null) // { enrollToken, qrDataUrl, secret }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')

    fetch('/api/v1/auth/2fa/enroll/start', { method: 'POST' })
      .then(res => res.json())
      .then(data => {
        if (cancelled) return
        if (data?.data?.enrollToken) {
          setEnrollData(data.data)
        } else {
          setError(data?.error || t('twoFactor.wizardStartError'))
        }
      })
      .catch(() => {
        if (!cancelled) setError(t('twoFactor.wizardStartError'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [t])

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Typography variant='body2' color='text.secondary'>
        {t('twoFactor.wizardStep1Desc')}
      </Typography>

      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress size={40} />
        </Box>
      )}

      {error && <Alert severity='error'>{error}</Alert>}

      {enrollData && (
        <>
          <Box sx={{ display: 'flex', justifyContent: 'center' }}>
            <img
              src={enrollData.qrDataUrl}
              alt={t('twoFactor.wizardStep1Title')}
              width={256}
              height={256}
              style={{ display: 'block' }}
            />
          </Box>
          <TextField
            fullWidth
            multiline
            size='small'
            label={t('twoFactor.wizardSecretLabel')}
            value={enrollData.secret}
            InputProps={{ readOnly: true }}
            inputProps={{ style: { wordBreak: 'break-all' } }}
          />
        </>
      )}

      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mt: 1 }}>
        {!forced && (
          <Button variant='outlined' color='inherit' onClick={onCancel}>
            {t('common.cancel')}
          </Button>
        )}
        <Button
          variant='contained'
          onClick={() => onNext(enrollData)}
          disabled={!enrollData}
        >
          {t('common.next')}
        </Button>
      </Box>
    </Box>
  )
}

// ---- Step 2: Verify code -----------------------------------------

function StepVerifyCode({ enrollData, onNext, onBack, onRestart, forced }) {
  const t = useTranslations()
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleVerify = async () => {
    if (loading) return
    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/v1/auth/2fa/enroll/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enrollToken: enrollData.enrollToken, code }),
      })

      const data = await res.json()

      if (res.ok) {
        onNext(data.data.recoveryCodes)
        return
      }

      if (data?.error === 'enroll_token_expired') {
        onRestart()
        return
      }

      setError(t('twoFactor.wizardInvalidCode'))
    } catch {
      setError(t('twoFactor.wizardVerifyError'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Typography variant='body2' color='text.secondary'>
        {t('twoFactor.wizardStep2Desc')}
      </Typography>

      {error && <Alert severity='error'>{error}</Alert>}

      <TextField
        fullWidth
        size='small'
        label={t('twoFactor.wizardCodeLabel')}
        value={code}
        onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
        inputProps={{ inputMode: 'numeric', pattern: '\\d{6}', maxLength: 6 }}
        onKeyDown={e => { if (e.key === 'Enter' && code.length === 6) handleVerify() }}
        autoFocus
      />

      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mt: 1 }}>
        {!forced && (
          <Button
            variant='outlined'
            color='inherit'
            onClick={onBack}
            disabled={loading}
          >
            {t('common.back')}
          </Button>
        )}
        <Button
          variant='contained'
          onClick={handleVerify}
          disabled={loading || code.length !== 6}
        >
          {loading ? <CircularProgress size={18} sx={{ color: 'inherit' }} /> : t('twoFactor.wizardVerify')}
        </Button>
      </Box>
    </Box>
  )
}

// ---- Step 3: Save recovery codes ---------------------------------

function StepSaveCodes({ recoveryCodes, onDone }) {
  const t = useTranslations()
  const [confirmed, setConfirmed] = useState(false)

  const handleDownload = () => {
    const date = new Date().toISOString().split('T')[0]
    const blob = new Blob([recoveryCodes.join('\n')], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `proxcenter-recovery-codes-${date}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Alert severity='warning'>
        {t('twoFactor.wizardStep3Warning')}
      </Alert>

      <Typography variant='body2' color='text.secondary'>
        {t('twoFactor.wizardStep3Desc')}
      </Typography>

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
        {recoveryCodes.map(code => (
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
        sx={{ alignSelf: 'flex-start' }}
      >
        {t('twoFactor.wizardDownloadCodes')}
      </Button>

      <FormControlLabel
        control={
          <Checkbox
            checked={confirmed}
            onChange={e => setConfirmed(e.target.checked)}
          />
        }
        label={t('twoFactor.wizardConfirmSaved')}
      />

      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1 }}>
        <Button
          variant='contained'
          color='success'
          onClick={onDone}
          disabled={!confirmed}
        >
          {t('twoFactor.wizardDone')}
        </Button>
      </Box>
    </Box>
  )
}

// ---- Step title helper -------------------------------------------

function stepTitle(step, t) {
  if (step === 1) return t('twoFactor.wizardStep1Title')
  if (step === 2) return t('twoFactor.wizardStep2Title')
  return t('twoFactor.wizardStep3Title')
}

// ---- Wizard body (step switcher) ---------------------------------

function WizardBody({ onClose, onDone, forced }) {
  const t = useTranslations()
  const [step, setStep] = useState(1)
  const [enrollData, setEnrollData] = useState(null)
  const [recoveryCodes, setRecoveryCodes] = useState([])

  const handleStep1Next = data => {
    setEnrollData(data)
    setStep(2)
  }

  const handleStep2Next = codes => {
    setRecoveryCodes(codes)
    setStep(3)
  }

  const handleRestart = () => {
    setEnrollData(null)
    setStep(1)
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Typography variant='overline' color='text.secondary' sx={{ lineHeight: 1.5 }}>
        {t('twoFactor.wizardStepOf', { current: step, total: 3 })}
      </Typography>
      <Typography variant='h6' sx={{ fontWeight: 600, mb: 1 }}>
        {stepTitle(step, t)}
      </Typography>

      {step === 1 && (
        <StepScanQr
          onNext={handleStep1Next}
          onCancel={onClose}
          forced={forced}
        />
      )}
      {step === 2 && (
        <StepVerifyCode
          enrollData={enrollData}
          onNext={handleStep2Next}
          onBack={() => setStep(1)}
          onRestart={handleRestart}
          forced={forced}
        />
      )}
      {step === 3 && (
        <StepSaveCodes
          recoveryCodes={recoveryCodes}
          onDone={onDone}
        />
      )}
    </Box>
  )
}

// ---- Public component -------------------------------------------

export default function TwoFactorEnrollWizard({
  open,
  onClose,
  onDone,
  inline = false,
  forced = false,
}) {
  const t = useTranslations()

  if (inline) {
    return (
      <Box sx={{ p: 2 }}>
        <WizardBody onClose={onClose} onDone={onDone} forced={forced} />
      </Box>
    )
  }

  return (
    <Dialog
      open={open}
      onClose={forced ? undefined : onClose}
      maxWidth='sm'
      fullWidth
      disableEscapeKeyDown={forced}
    >
      <AppDialogTitle
        onClose={forced ? undefined : onClose}
        icon={<i className='ri-shield-keyhole-line' style={{ fontSize: 20 }} />}
      >
        {t('twoFactor.wizardTitle')}
      </AppDialogTitle>
      <DialogContent sx={{ pt: 1 }}>
        <WizardBody onClose={onClose} onDone={onDone} forced={forced} />
      </DialogContent>
    </Dialog>
  )
}
