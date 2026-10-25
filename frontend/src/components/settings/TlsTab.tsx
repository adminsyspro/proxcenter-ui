'use client'

import { useCallback, useEffect, useState } from 'react'

import {
  Alert, Box, Button, Card, CardContent, FormControlLabel, Radio, RadioGroup, Snackbar, Stack, Typography,
} from '@mui/material'
import { useTranslations } from 'next-intl'

import CertificateStatusCard from '@/components/settings/tls/CertificateStatusCard'
import AcmeForm from '@/components/settings/tls/AcmeForm'
import HistoryCard from '@/components/settings/tls/HistoryCard'
import ListenerCard from '@/components/settings/tls/ListenerCard'
import UploadForm from '@/components/settings/tls/UploadForm'
import type { TlsPayload } from '@/components/settings/tls/types'
import type { TlsSettings } from '@/lib/tls/schema'

/**
 * The fields the server writes on its own while the tab is open: the progress
 * of an ACME order and the backoff around it, exactly the four that
 * src/lib/tls/renew.ts claims ownership of. They refresh into the form on every
 * reload; everything else belongs to whoever is typing and is left alone.
 */
function serverOwned(settings: TlsSettings) {
  const { order, lastError, failureCount, nextAttemptAt } = settings

  return { order, lastError, failureCount, nextAttemptAt }
}

export default function TlsTab() {
  const t = useTranslations()
  const [payload, setPayload] = useState<TlsPayload | null>(null)
  const [draft, setDraft] = useState<TlsSettings | null>(null)
  // Keys, not translated strings: `load` runs from a `useEffect` keyed on it,
  // so it must stay referentially stable across renders. Depending on `t`
  // there instead would make that effect re-fire whenever the translator's
  // identity changes -- exactly the unstable-dependency trap this tab's ACME
  // polling effect (see AcmeForm) has to avoid, just one level up. Rendering
  // the message from a key sidesteps it entirely: `load` and `save` below
  // never need to name `t` in a dependency array.
  const [toastKey, setToastKey] = useState<string | null>(null)
  const [errorKey, setErrorKey] = useState<string | null>(null)
  // Bumped on every reload, and handed to the cards that hold state of their
  // own so they can refresh with the payload instead of only on mount.
  const [payloadVersion, setPayloadVersion] = useState(0)

  const load = useCallback(async () => {
    const res = await fetch('/api/v1/settings/tls')

    if (!res.ok) {
      setErrorKey('settings.tls.saveFailed')

      return
    }

    const body: TlsPayload = await res.json()

    setPayload(body)

    // Keeping the whole draft as it was left the ACME form reading a frozen
    // `order`: an order started from this tab showed idle for ever, and the
    // polling that watches it never began. Server-owned state refreshes in,
    // the fields being edited do not.
    setDraft(current => (current ? { ...current, ...serverOwned(body.settings) } : body.settings))
    setPayloadVersion(version => version + 1)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const save = async (next: TlsSettings) => {
    setDraft(next)

    const res = await fetch('/api/v1/settings/tls', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(next),
    })

    if (!res.ok) {
      setErrorKey('settings.tls.saveFailed')

      return
    }

    setErrorKey(null)
    setToastKey('settings.tls.saved')
    await load()
  }

  const selfSign = async () => {
    await fetch('/api/v1/settings/tls/self-signed', { method: 'POST' })
    await load()
  }

  if (!payload || !draft) return null

  return (
    <Stack spacing={3} sx={{ width: '100%', minWidth: 0 }}>
      <Box>
        <Typography variant='h5' fontWeight={600}>{t('settings.tls.title')}</Typography>
        <Typography variant='body2' color='text.secondary'>{t('settings.tls.desc')}</Typography>
      </Box>

      {errorKey && <Alert severity='error' onClose={() => setErrorKey(null)}>{t(errorKey)}</Alert>}

      <CertificateStatusCard certificate={payload.active} />

      <ListenerCard
        settings={draft} listener={payload.listener} tlsPort={payload.tlsPort}
        urlCoherence={payload.urlCoherence} onChange={save}
      />

      <Card variant='outlined'>
        <CardContent>
          <Stack spacing={3}>
            <Box>
              <Typography id='tls-source-label' variant='subtitle1' fontWeight={600} sx={{ mb: 2 }}>
                {t('settings.tls.sourceTitle')}
              </Typography>
              <RadioGroup
                row aria-labelledby='tls-source-label' value={draft.source}
                sx={{ columnGap: 4, rowGap: 1 }}
                onChange={(_e, value) => save({ ...draft, source: value as TlsSettings['source'] })}
              >
                <FormControlLabel value='self_signed' control={<Radio size='small' />} label={
                  <Box component='span' sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
                    <i className='ri-key-2-line' aria-hidden='true' style={{ fontSize: 18, opacity: 0.7 }} />
                    {t('settings.tls.sourceSelfSigned')}
                  </Box>
                } />
                <FormControlLabel value='uploaded' control={<Radio size='small' />} label={
                  <Box component='span' sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
                    <i className='ri-upload-2-line' aria-hidden='true' style={{ fontSize: 18, opacity: 0.7 }} />
                    {t('settings.tls.sourceUploaded')}
                  </Box>
                } />
                <FormControlLabel value='acme' control={<Radio size='small' />} label={
                  <Box component='span' sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
                    <i className='ri-refresh-line' aria-hidden='true' style={{ fontSize: 18, opacity: 0.7 }} />
                    {t('settings.tls.sourceAcme')}
                  </Box>
                } />
              </RadioGroup>
            </Box>

            {draft.source === 'self_signed' && (
              <Button variant='outlined' onClick={selfSign} sx={{ alignSelf: 'flex-start' }}>
                {t('settings.tls.generateSelfSigned')}
              </Button>
            )}

            {draft.source === 'uploaded' && <UploadForm onDone={load} />}

            {draft.source === 'acme' && (
              <AcmeForm
                settings={draft} eabConfigured={payload.eabConfigured} dnsSecretsConfigured={payload.dnsSecretsConfigured}
                onChange={save} onRefresh={load}
              />
            )}
          </Stack>
        </CardContent>
      </Card>

      <HistoryCard onActivated={load} reloadToken={payloadVersion} />

      <Snackbar open={Boolean(toastKey)} autoHideDuration={4000} onClose={() => setToastKey(null)} message={toastKey ? t(toastKey) : ''} />
    </Stack>
  )
}
