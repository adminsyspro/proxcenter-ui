'use client'

import { useEffect, useState } from 'react'

import {
  Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button,
  CircularProgress, MenuItem, Stack, TextField, Typography,
} from '@mui/material'
import { useTranslations } from 'next-intl'

import DnsChallengeForm from '@/components/settings/tls/DnsChallengeForm'
import { FieldHint, hintSlotProps } from '@/components/settings/tls/FieldHint'
import { FORM_GRID_SX, FULL_ROW_SX } from '@/components/settings/tls/layout'
import { ACME_DIRECTORIES, type TlsSettings } from '@/lib/tls/schema'

// A small Select renders 38px tall against a 35.9px input; this puts it back
// in line with the fields around it.
const SMALL_SELECT_SX = {
  '& .MuiInputBase-input.MuiSelect-select': { minHeight: '1.4375em', lineHeight: '1.4375em' },
} as const

const PRESETS = [
  { key: 'letsencrypt', label: 'settings.tls.acmeDirectoryLetsencrypt', url: ACME_DIRECTORIES.letsencrypt },
  { key: 'letsencrypt-staging', label: 'settings.tls.acmeDirectoryStaging', url: ACME_DIRECTORIES['letsencrypt-staging'] },
  { key: 'zerossl', label: 'settings.tls.acmeDirectoryZerossl', url: ACME_DIRECTORIES.zerossl },
  { key: 'custom', label: 'settings.tls.acmeDirectoryCustom', url: '' },
]

export default function AcmeForm({
  settings, eabConfigured, dnsSecretsConfigured = [], onChange, onRefresh,
}: {
  settings: TlsSettings
  eabConfigured: boolean
  dnsSecretsConfigured?: string[]
  onChange: (next: TlsSettings) => void
  onRefresh: () => void
}) {
  const t = useTranslations()
  const [ordering, setOrdering] = useState(false)

  // The EAB HMAC key never comes back from the server (GET always blanks it),
  // and sending a blank key when nothing is stored yet is a 400 from the API.
  // Typing the kid before the key -- or leaving the key blank on purpose once
  // eabConfigured is true, to keep the stored one -- must not fire that
  // request on every keystroke. So these two fields are buffered locally and
  // only pushed up through onChange (which saves immediately) once the pair
  // is actually submittable.
  const [eabKid, setEabKid] = useState(settings.acme.eab?.kid ?? '')
  const [eabHmacKey, setEabHmacKey] = useState('')

  useEffect(() => {
    setEabKid(settings.acme.eab?.kid ?? '')
  }, [settings.acme.eab?.kid])

  // The custom preset carries no URL by design, so a selection derived from the
  // stored directoryUrl alone could never land on it: choosing "custom" did
  // nothing at all, the free-text field never appeared, and an internal CA -- a
  // headline case of this feature -- was unreachable from the UI. What the
  // operator picked is held here and outranks what the URL suggests.
  const [presetChoice, setPresetChoice] = useState<string | null>(null)
  const derivedPreset = PRESETS.find(p => p.url && p.url === settings.acme.directoryUrl)?.key ?? 'custom'
  const presetKey = presetChoice ?? derivedPreset

  // Same treatment for the custom directory: the schema wants a whole https
  // URL, so saving on every keystroke answers 400 to every half-typed one and
  // paints an error over a field that is simply not finished yet.
  const [directoryDraft, setDirectoryDraft] = useState<string | null>(null)
  const directoryText = directoryDraft ?? settings.acme.directoryUrl

  // The domain field keeps its raw text while it is being edited. Normalising
  // on every keystroke deleted the newline the instant Enter produced it, so a
  // second domain could be pasted but never typed. The array in the settings is
  // written on commit, never mid-word.
  const [domainsDraft, setDomainsDraft] = useState<string | null>(null)
  const domainsText = domainsDraft ?? settings.acme.domains.join('\n')
  const status = settings.order.status
  const dns01 = settings.acme.challenge === 'dns-01'

  // Poll only while an order is running. The dependency is the STATUS STRING,
  // never the settings object: an unstable dependency here is a render loop,
  // and a render loop is what takes vitest out on OOM.
  useEffect(() => {
    if (status !== 'pending') return

    const timer = setInterval(onRefresh, 3000)

    return () => clearInterval(timer)
  }, [status, onRefresh])

  const patchAcme = (patch: Partial<TlsSettings['acme']>) =>
    onChange({ ...settings, acme: { ...settings.acme, ...patch } })

  const commitDirectory = () => {
    if (directoryDraft === null) return

    const directoryUrl = directoryDraft.trim()

    setDirectoryDraft(null)

    if (directoryUrl && directoryUrl !== settings.acme.directoryUrl) patchAcme({ directoryUrl })
  }

  const commitDomains = () => {
    if (domainsDraft === null) return

    const domains = domainsDraft.split('\n').map(d => d.trim()).filter(Boolean)

    setDomainsDraft(null)

    const unchanged =
      domains.length === settings.acme.domains.length && domains.every((d, i) => d === settings.acme.domains[i])

    if (!unchanged) patchAcme({ domains })
  }

  const commitEab = (kid: string, hmacKey: string) => {
    const trimmedKid = kid.trim()

    // Nothing to send until there is a kid, and nothing to send for the key
    // unless either it was actually typed or an HMAC key is already stored
    // (a blank key then means "keep it"). Below that, this simply never
    // fires the request rather than surfacing the API's 400 after the fact.
    if (!trimmedKid) return
    if (!hmacKey.trim() && !eabConfigured) return

    patchAcme({ eab: { kid: trimmedKid, hmacKey } })
  }

  const order = async () => {
    setOrdering(true)

    try {
      await fetch('/api/v1/settings/tls/acme/order', { method: 'POST' })
      onRefresh()
    } finally {
      setOrdering(false)
    }
  }

  return (
    <Stack spacing={3} sx={{ width: '100%' }}>
      <Typography variant='subtitle2'>{t('settings.tls.acmeTitle')}</Typography>
      {status === 'ok' && <Alert severity='success'>{t('settings.tls.acmeOrderOk')}</Alert>}

      <Box sx={FORM_GRID_SX}>
        <TextField
          select size='small' fullWidth sx={SMALL_SELECT_SX} value={presetKey}
          label={
            // A select always holds a value, so its label stays raised and can
            // be hovered; an adornment would sit on the dropdown arrow.
            <Box component='span' sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
              {t('settings.tls.acmeAuthority')}
              <FieldHint text={t('settings.tls.acmeAuthorityHint')} />
            </Box>
          }
          onChange={e => {
            const preset = PRESETS.find(p => p.key === e.target.value)

            if (!preset) return

            setPresetChoice(preset.key)

            // Picking custom only reveals the field: whatever URL is stored
            // stays there as the starting point for the operator to edit, and
            // an empty one would not pass the schema anyway.
            if (preset.url && preset.url !== settings.acme.directoryUrl) patchAcme({ directoryUrl: preset.url })
          }}
        >
          {PRESETS.map(p => <MenuItem key={p.key} value={p.key}>{t(p.label)}</MenuItem>)}
        </TextField>

        <TextField
          size='small' label={t('settings.tls.acmeEmail')} value={settings.acme.email} fullWidth
          slotProps={hintSlotProps(t('settings.tls.acmeEmailHint'))}
          onChange={e => patchAcme({ email: e.target.value })}
        />

        {presetKey === 'custom' && (
          <TextField
            size='small' label={t('settings.tls.acmeDirectory')} value={directoryText} fullWidth sx={FULL_ROW_SX}
            slotProps={hintSlotProps(t('settings.tls.acmeDirectoryHint'))}
            onChange={e => setDirectoryDraft(e.target.value)}
            onBlur={commitDirectory}
          />
        )}

        <TextField
          select size='small' fullWidth sx={SMALL_SELECT_SX}
          label={t('settings.tls.acmeChallenge')} value={settings.acme.challenge ?? 'http-01'}
          helperText={t(dns01 ? 'settings.tls.acmeChallengeDnsHelp' : 'settings.tls.acmeChallengeHttpHelp')}
          onChange={e => patchAcme({ challenge: e.target.value as TlsSettings['acme']['challenge'] })}
        >
          <MenuItem value='http-01'>{t('settings.tls.acmeChallengeHttp')}</MenuItem>
          <MenuItem value='dns-01'>{t('settings.tls.acmeChallengeDns')}</MenuItem>
        </TextField>

        <TextField
          size='small' fullWidth
          label={t('settings.tls.acmeRenewBefore')} type='number' value={settings.acme.renewBeforeDays}
          onChange={e => patchAcme({ renewBeforeDays: Number.parseInt(e.target.value, 10) || 30 })}
        />

        <TextField
          size='small' label={t('settings.tls.acmeDomains')}
          helperText={t(dns01 ? 'settings.tls.acmeDomainsHelpDns' : 'settings.tls.acmeDomainsHelp')}
          value={domainsText} multiline minRows={3} fullWidth sx={FULL_ROW_SX}
          onChange={e => setDomainsDraft(e.target.value)}
          onBlur={commitDomains}
        />
      </Box>

      {dns01 && (
        <DnsChallengeForm
          key={settings.acme.dns.provider ?? 'none'} dns={settings.acme.dns} secretsConfigured={dnsSecretsConfigured}
          hasDomains={settings.acme.domains.length > 0}
          onChange={dns => patchAcme({ dns })}
        />
      )}

      <Accordion>
        <AccordionSummary>
          <Box component='span' sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
            {t('settings.tls.acmeEab')}
            <FieldHint text={t('settings.tls.acmeEabHint')} />
          </Box>
        </AccordionSummary>
        <AccordionDetails>
          <Stack spacing={2}>
            {eabConfigured && <Alert severity='info'>{t('settings.tls.acmeEabConfigured')}</Alert>}
            <TextField
              size='small' label={t('settings.tls.acmeEabKid')} value={eabKid} fullWidth
              onChange={e => {
                setEabKid(e.target.value)
                commitEab(e.target.value, eabHmacKey)
              }}
            />
            <TextField
              size='small' label={t('settings.tls.acmeEabHmac')} value={eabHmacKey} fullWidth
              type='password' autoComplete='off'
              onChange={e => {
                setEabHmacKey(e.target.value)
                commitEab(eabKid, e.target.value)
              }}
            />
          </Stack>
        </AccordionDetails>
      </Accordion>

      <Button
        variant='contained' onClick={order} sx={{ alignSelf: 'flex-start' }}
        disabled={ordering || status === 'pending' || settings.acme.domains.length === 0}
        startIcon={status === 'pending' ? <CircularProgress size={16} /> : undefined}
      >
        {status === 'pending' ? t('settings.tls.acmeOrdering') : t('settings.tls.acmeOrder')}
      </Button>
    </Stack>
  )
}
