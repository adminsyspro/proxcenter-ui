// src/lib/tls/secrets.ts
//
// The secrets of the `tls` row: the EAB HMAC key and the secret fields of the
// DNS provider. They are sealed with APP_SECRET before they reach the
// database, never leave the server (GET blanks them and reports which ones
// are set), and an empty value on the way in means "keep the stored one".
// A DNS token can rewrite a whole zone, so it gets the treatment connection
// passwords get.

import { decryptSecret, encryptSecret } from '@/lib/crypto/secret'
import { findDnsProvider, secretFieldKeys } from '@/lib/tls/dns/catalog'
import type { TlsSettings } from '@/lib/tls/schema'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Turn the body of a PUT into what may be stored: fresh secrets sealed, blank
 * ones replaced by the sealed value already stored, fields the provider does
 * not declare dropped. Runs BEFORE validation, because the schema wants a
 * non-empty HMAC key whenever `eab` is set, and the form never has it.
 *
 * Only the HMAC key is substituted, never the whole `eab` object: the kid is
 * not a secret, always arrives intact, and an operator correcting just the kid
 * must see the change stick.
 */
export function sealIncomingSecrets(body: unknown, current: TlsSettings): unknown {
  if (!isRecord(body) || !isRecord(body.acme)) return body

  const acme: Record<string, unknown> = { ...body.acme }
  const eab = acme.eab

  if (isRecord(eab) && typeof eab.hmacKey === 'string') {
    if (eab.hmacKey === '') {
      // With nothing stored there is nothing to keep: the blank goes through
      // and the schema refuses it, since EAB cannot work without its secret.
      if (current.acme.eab) acme.eab = { ...eab, hmacKey: current.acme.eab.hmacKey }
    } else {
      acme.eab = { ...eab, hmacKey: encryptSecret(eab.hmacKey.trim()) }
    }
  }

  const dns = acme.dns

  if (isRecord(dns)) {
    const provider = typeof dns.provider === 'string' ? findDnsProvider(dns.provider) : undefined
    const incoming = isRecord(dns.credentials) ? dns.credentials : {}
    // Credentials belong to one provider. Switching provider starts from a
    // blank sheet rather than carrying a PowerDNS key into an acme-dns form.
    const stored = provider && current.acme.dns.provider === provider.id ? current.acme.dns.credentials : {}
    const credentials: Record<string, string> = {}

    for (const field of provider?.fields ?? []) {
      const raw = incoming[field.key]
      const value = typeof raw === 'string' ? raw.trim() : ''

      if (field.kind === 'secret') {
        if (value) credentials[field.key] = encryptSecret(value)
        else if (stored[field.key]) credentials[field.key] = stored[field.key]
      } else if (value) {
        credentials[field.key] = value
      }
    }

    acme.dns = { ...dns, credentials }
  }

  return { ...body, acme }
}

/** What GET sends: every secret blanked. */
export function redactSecrets(settings: TlsSettings): TlsSettings {
  const secretKeys = new Set(secretFieldKeys(settings.acme.dns.provider ?? ''))
  const credentials = Object.fromEntries(
    Object.entries(settings.acme.dns.credentials).map(([key, value]) => [key, secretKeys.has(key) ? '' : value]),
  )

  return {
    ...settings,
    acme: {
      ...settings.acme,
      eab: settings.acme.eab ? { kid: settings.acme.eab.kid, hmacKey: '' } : null,
      dns: { ...settings.acme.dns, credentials },
    },
  }
}

/** The secret DNS fields that hold a value, so the form can say "stored, leave blank to keep". */
export function configuredDnsSecrets(settings: TlsSettings): string[] {
  return secretFieldKeys(settings.acme.dns.provider ?? '').filter(key => Boolean(settings.acme.dns.credentials[key]))
}

export function unsealEab(settings: TlsSettings): { kid: string; hmacKey: string } | null {
  const { eab } = settings.acme

  return eab ? { kid: eab.kid, hmacKey: decryptSecret(eab.hmacKey) } : null
}

/** Plain field values for the provider, secrets opened. Server side only, never logged. */
export function unsealDnsCredentials(settings: TlsSettings): Record<string, string> {
  const secretKeys = new Set(secretFieldKeys(settings.acme.dns.provider ?? ''))

  return Object.fromEntries(
    Object.entries(settings.acme.dns.credentials).map(([key, value]) => [key, secretKeys.has(key) ? decryptSecret(value) : value]),
  )
}
