// src/lib/tls/schema.ts
//
// Shape and validation of the `tls` row of the settings table. A setting with
// no validator never leaves the form, so every field the TLS tab writes is
// declared here and nowhere else.

import { z } from 'zod'

import { DEFAULT_DNS_VALIDATION_DELAY_S, DNS_PROVIDER_IDS, MAX_DNS_VALIDATION_DELAY_S } from '@/lib/tls/dns/catalog'

export const TLS_SETTINGS_KEY = 'tls'

export const ACME_DIRECTORIES = {
  letsencrypt: 'https://acme-v02.api.letsencrypt.org/directory',
  'letsencrypt-staging': 'https://acme-staging-v02.api.letsencrypt.org/directory',
  zerossl: 'https://acme.zerossl.com/v2/DV90',
} as const

/** RFC 1123 hostname, optionally a wildcard label. No scheme, no port, no path. */
const hostname = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .regex(/^(\*\.)?([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i, 'invalid hostname')

export const tlsSettingsSchema = z.object({
  enabled: z.boolean(),
  redirectHttp: z.boolean(),
  minVersion: z.enum(['TLSv1.2', 'TLSv1.3']),
  source: z.enum(['self_signed', 'uploaded', 'acme']),
  hsts: z.object({
    enabled: z.boolean(),
    // Below an hour HSTS buys nothing and only makes a rollback painful.
    maxAge: z.number().int().min(3600).max(63072000),
    includeSubDomains: z.boolean(),
    preload: z.boolean(),
  }),
  acme: z.object({
    directoryUrl: z.string().url().startsWith('https://', 'the ACME directory must be https'),
    email: z.string().email().or(z.literal('')),
    domains: z.array(hostname).max(20),
    // Let's Encrypt issues for 90 days; renewing later than 85 days in leaves
    // no room for a retry.
    renewBeforeDays: z.number().int().min(1).max(85),
    // At rest the HMAC key is sealed with APP_SECRET (src/lib/tls/secrets.ts),
    // hence the room above a raw key's length.
    eab: z
      .object({ kid: z.string().trim().min(1).max(256), hmacKey: z.string().trim().min(1).max(2048) })
      .nullable(),
    // HTTP-01 needs port 80 reachable from the CA; DNS-01 publishes a TXT
    // record through the provider's API instead, which is the only way to a
    // wildcard and the way in for an install the internet cannot reach.
    // Defaulted so a row saved before DNS-01 existed still validates.
    challenge: z.enum(['http-01', 'dns-01']).default('http-01'),
    dns: z
      .object({
        provider: z.enum(DNS_PROVIDER_IDS).nullable(),
        // Field values keyed as in catalog.ts. The secret ones are sealed at
        // rest; which keys are required is checked when an order or a test
        // runs, not here, because the form saves one field at a time.
        credentials: z.record(z.string().max(64), z.string().max(8192)),
        validationDelaySeconds: z.number().int().min(0).max(MAX_DNS_VALIDATION_DELAY_S),
      })
      .default({ provider: null, credentials: {}, validationDelaySeconds: DEFAULT_DNS_VALIDATION_DELAY_S }),
  }),
  // Progress of the running ACME order. In the settings row and not in process
  // memory because in HA the UI may poll a different replica than the one that
  // is ordering.
  order: z.object({
    status: z.enum(['idle', 'pending', 'ok', 'error']),
    step: z.string().max(200),
    startedAt: z.string().nullable(),
    finishedAt: z.string().nullable(),
    message: z.string().max(2000).nullable(),
  }),
  lastError: z.object({ at: z.string(), message: z.string().max(2000) }).nullable(),
  failureCount: z.number().int().min(0),
  nextAttemptAt: z.string().nullable(),
})

export type TlsSettings = z.infer<typeof tlsSettingsSchema>

export const DEFAULT_TLS_SETTINGS: TlsSettings = {
  enabled: false,
  redirectHttp: false,
  minVersion: 'TLSv1.2',
  source: 'self_signed',
  hsts: { enabled: false, maxAge: 15552000, includeSubDomains: false, preload: false },
  acme: {
    directoryUrl: ACME_DIRECTORIES.letsencrypt,
    email: '',
    domains: [],
    renewBeforeDays: 30,
    eab: null,
    challenge: 'http-01',
    dns: { provider: null, credentials: {}, validationDelaySeconds: DEFAULT_DNS_VALIDATION_DELAY_S },
  },
  order: { status: 'idle', step: '', startedAt: null, finishedAt: null, message: null },
  lastError: null,
  failureCount: 0,
  nextAttemptAt: null,
}

export const DEFAULT_TLS_PORT = 8443

/**
 * The container-side listening port comes from the environment, never from the
 * database: it has to stay in step with the compose port mapping, which a write
 * to the settings table cannot update.
 */
export function resolveTlsPort(): number {
  const raw = Number.parseInt(process.env.TLS_PORT ?? '', 10)

  if (!Number.isInteger(raw) || raw < 1 || raw > 65535) return DEFAULT_TLS_PORT

  return raw
}
