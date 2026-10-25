'use client'

import { useState } from 'react'

import { Alert, Box, Button, CircularProgress, Link, MenuItem, TextField, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import { hintSlotProps } from '@/components/settings/tls/FieldHint'
import { FORM_GRID_SX, FULL_ROW_SX } from '@/components/settings/tls/layout'
import { DNS_PROVIDERS, type DnsProviderField, MAX_DNS_VALIDATION_DELAY_S, findDnsProvider } from '@/lib/tls/dns/catalog'
import type { TlsSettings } from '@/lib/tls/schema'

// A small Select renders 38px tall against a 35.9px input; this puts it back
// in line with the fields around it.
const SMALL_SELECT_SX = {
  '& .MuiInputBase-input.MuiSelect-select': { minHeight: '1.4375em', lineHeight: '1.4375em' },
} as const

type DnsSettings = TlsSettings['acme']['dns']

/** A select shows its first option before anyone touches it, so that option is stored from the start. */
function selectDefaults(providerId: string): Record<string, string> {
  return Object.fromEntries(
    (findDnsProvider(providerId)?.fields ?? []).flatMap(f => (f.kind === 'select' && f.options?.[0] ? [[f.key, f.options[0]]] : [])),
  )
}

interface TestResult {
  ok: boolean
  failures: { domain: string; reason: string }[]
  error?: string
}

export default function DnsChallengeForm({
  dns, secretsConfigured, hasDomains, onChange,
}: {
  dns: DnsSettings
  secretsConfigured: string[]
  hasDomains: boolean
  onChange: (next: DnsSettings) => void
}) {
  const t = useTranslations()
  const provider = dns.provider ? findDnsProvider(dns.provider) : undefined

  // Every field is edited locally and committed on blur: the form saves on each
  // change, and a token pushed on every keystroke would be sealed and stored
  // once per character. Secrets also never come back from the server, so their
  // drafts start empty and an empty secret on commit means "keep the stored one".
  // The parent keys this component on the provider, so switching provider
  // starts from fresh drafts and no stale test result.
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [delayDraft, setDelayDraft] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<TestResult | null>(null)

  const valueOf = (field: DnsProviderField) =>
    drafts[field.key] ?? (field.kind === 'secret' ? '' : (dns.credentials[field.key] ?? ''))

  const commitField = (field: DnsProviderField, value: string) => {
    setDrafts(current => {
      const { [field.key]: _committed, ...rest } = current

      return rest
    })

    const trimmed = value.trim()

    if (field.kind === 'secret' && !trimmed) return
    if (field.kind !== 'secret' && trimmed === (dns.credentials[field.key] ?? '')) return

    setResult(null)
    onChange({ ...dns, credentials: { ...dns.credentials, [field.key]: trimmed } })
  }

  const commitDelay = () => {
    if (delayDraft === null) return

    const parsed = Number.parseInt(delayDraft, 10)

    setDelayDraft(null)

    if (!Number.isInteger(parsed)) return

    const validationDelaySeconds = Math.min(MAX_DNS_VALIDATION_DELAY_S, Math.max(0, parsed))

    if (validationDelaySeconds !== dns.validationDelaySeconds) onChange({ ...dns, validationDelaySeconds })
  }

  const test = async () => {
    setTesting(true)
    setResult(null)

    try {
      const res = await fetch('/api/v1/settings/tls/acme/dns-test', { method: 'POST' })
      const body = await res.json().catch(() => ({}))

      setResult(res.ok ? body : { ok: false, failures: [], error: body?.error || `HTTP ${res.status}` })
    } catch (err: any) {
      setResult({ ok: false, failures: [], error: String(err?.message || err) })
    } finally {
      setTesting(false)
    }
  }

  const fieldLabel = (field: DnsProviderField) => {
    const label = t(`settings.tls.dns.fields.${field.key}`)

    return field.required ? label : `${label} (${t('settings.tls.dns.optional')})`
  }

  return (
    <Box sx={FORM_GRID_SX}>
      <TextField
        select size='small' fullWidth sx={SMALL_SELECT_SX}
        label={t('settings.tls.dns.provider')} value={dns.provider ?? ''}
        onChange={e => onChange({ ...dns, provider: e.target.value as DnsSettings['provider'], credentials: selectDefaults(e.target.value) })}
      >
        {DNS_PROVIDERS.map(p => <MenuItem key={p.id} value={p.id}>{p.label}</MenuItem>)}
      </TextField>

      {provider && (
        <>
          {/* Next to the provider on a wide screen: it explains what that pick needs. */}
          <Typography variant='body2' color='text.secondary' sx={{ alignSelf: 'center' }}>
            {t(`settings.tls.dns.help.${provider.id}`)}{' '}
            <Link href={provider.docsUrl} target='_blank' rel='noopener noreferrer'>{t('settings.tls.dns.docs')}</Link>
          </Typography>

          {provider.fields.map(field => {
            if (field.kind === 'select') {
              return (
                <TextField
                  key={field.key} select size='small' fullWidth sx={SMALL_SELECT_SX}
                  label={fieldLabel(field)} value={dns.credentials[field.key] ?? field.options?.[0] ?? ''}
                  onChange={e => commitField(field, e.target.value)}
                >
                  {(field.options ?? []).map(option => <MenuItem key={option} value={option}>{option}</MenuItem>)}
                </TextField>
              )
            }

            const stored = field.kind === 'secret' && secretsConfigured.includes(field.key)

            return (
              <TextField
                key={field.key} size='small' fullWidth label={fieldLabel(field)} value={valueOf(field)}
                placeholder={field.placeholder}
                type={field.kind === 'secret' ? 'password' : 'text'} autoComplete='off'
                helperText={stored ? t('settings.tls.dns.secretStored') : undefined}
                slotProps={field.hint ? hintSlotProps(t(`settings.tls.dns.hints.${field.key}`)) : undefined}
                onChange={e => setDrafts(current => ({ ...current, [field.key]: e.target.value }))}
                onBlur={e => commitField(field, e.target.value)}
              />
            )
          })}

          <TextField
            size='small' type='number' fullWidth
            label={t('settings.tls.dns.validationDelay')} helperText={t('settings.tls.dns.validationDelayHelp')}
            value={delayDraft ?? String(dns.validationDelaySeconds)}
            slotProps={{ htmlInput: { min: 0, max: MAX_DNS_VALIDATION_DELAY_S } }}
            onChange={e => setDelayDraft(e.target.value)}
            onBlur={commitDelay}
          />

          <Box sx={FULL_ROW_SX}>
            <Button
              variant='outlined' size='small' onClick={test} disabled={testing || !hasDomains}
              startIcon={testing ? <CircularProgress size={14} /> : <i className='ri-search-eye-line' aria-hidden='true' />}
            >
              {t('settings.tls.dns.test')}
            </Button>
          </Box>

          {result?.ok && <Alert severity='success' sx={FULL_ROW_SX}>{t('settings.tls.dns.testOk')}</Alert>}
          {result && !result.ok && (
            <Alert severity='error' sx={FULL_ROW_SX}>
              {result.error ?? t('settings.tls.dns.testFailed')}
              {result.failures.length > 0 && (
                <Box component='ul' sx={{ m: 0, mt: 0.5, pl: 2.5 }}>
                  {result.failures.map(f => <li key={f.domain}>{f.domain}: {f.reason}</li>)}
                </Box>
              )}
            </Alert>
          )}
        </>
      )}
    </Box>
  )
}
