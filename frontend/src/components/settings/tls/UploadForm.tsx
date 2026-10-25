'use client'

import { useState } from 'react'

import { Alert, Button, Stack, TextField, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

/**
 * PemError codes carry a locale key so the form points at the right message.
 * Every code pem.ts can raise today has an entry here -- not_a_certificate,
 * key_mismatch, passphrase_protected, unreadable_key, expired, broken_chain
 * and private_key_in_certificate -- so a future addition to that union is the
 * only thing that can fall through to the generic saveFailed message.
 */
const ERROR_KEYS: Record<string, string> = {
  not_a_certificate: 'settings.tls.errorNotACertificate',
  key_mismatch: 'settings.tls.errorKeyMismatch',
  passphrase_protected: 'settings.tls.errorPassphrase',
  unreadable_key: 'settings.tls.errorUnreadableKey',
  expired: 'settings.tls.errorExpired',
  broken_chain: 'settings.tls.errorBrokenChain',
  private_key_in_certificate: 'settings.tls.errorPrivateKeyInCertificate',
}

export default function UploadForm({ onDone }: { onDone: () => void }) {
  const t = useTranslations()
  const [certPem, setCertPem] = useState('')
  const [chainPem, setChainPem] = useState('')
  const [keyPem, setKeyPem] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    setError(null)

    try {
      const res = await fetch('/api/v1/settings/tls/upload', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ certPem, chainPem: chainPem.trim() || null, keyPem }),
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))

        setError(ERROR_KEYS[body?.code] ? t(ERROR_KEYS[body.code]) : body?.error || t('settings.tls.saveFailed'))

        return
      }

      // The key never comes back from the server, so drop it here too rather
      // than leaving it in a React state for the rest of the session.
      setCertPem('')
      setChainPem('')
      setKeyPem('')
      onDone()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Stack spacing={3} sx={{ width: '100%' }}>
      <Typography variant='subtitle2'>{t('settings.tls.uploadTitle')}</Typography>
      {error && <Alert severity='error'>{error}</Alert>}
      <TextField
        label={t('settings.tls.uploadCert')} value={certPem} onChange={e => setCertPem(e.target.value)}
        size='small' multiline minRows={4} fullWidth autoComplete='off'
        slotProps={{ input: { sx: { fontFamily: 'monospace', fontSize: '0.75rem' } } }}
      />
      <TextField
        label={t('settings.tls.uploadChain')} value={chainPem} onChange={e => setChainPem(e.target.value)}
        size='small' multiline minRows={3} fullWidth autoComplete='off'
        slotProps={{ input: { sx: { fontFamily: 'monospace', fontSize: '0.75rem' } } }}
      />
      <TextField
        label={t('settings.tls.uploadKey')} value={keyPem} onChange={e => setKeyPem(e.target.value)}
        size='small' multiline minRows={4} fullWidth autoComplete='off'
        slotProps={{ input: { sx: { fontFamily: 'monospace', fontSize: '0.75rem' } } }}
      />
      <Button
        variant='contained' onClick={submit} sx={{ alignSelf: 'flex-start' }}
        disabled={busy || !certPem.trim() || !keyPem.trim()}
      >
        {t('settings.tls.uploadSubmit')}
      </Button>
    </Stack>
  )
}
