// src/lib/tls/settings.ts
//
// Read and write of the `tls` row, always through the Zod schema so a row
// left over from an older shape can never reach the listener.

import { getSetting, setSetting } from '@/lib/db/settings'
import { findDnsProvider } from '@/lib/tls/dns/catalog'
import { DEFAULT_TLS_SETTINGS, TLS_SETTINGS_KEY, type TlsSettings, tlsSettingsSchema } from '@/lib/tls/schema'

const PROVIDER_TENANT_ID = 'default'

/**
 * A DNS provider that is no longer in the catalog only voids the DNS-01
 * credentials, not the whole row: falling back to the defaults would also turn
 * the listener off and lose the certificate source, and the next save from the
 * form would write those defaults down.
 */
function withoutUnknownDnsProvider(raw: unknown): unknown {
  const dns = (raw as any)?.acme?.dns
  const provider = dns?.provider

  if (typeof provider !== 'string' || findDnsProvider(provider)) return raw
  console.warn(`[tls] DNS provider "${provider}" is no longer available, DNS-01 needs a provider again`)

  return { ...(raw as any), acme: { ...(raw as any).acme, dns: { ...dns, provider: null, credentials: {} } } }
}

export async function loadTlsSettings(): Promise<TlsSettings> {
  const raw = await getSetting<unknown>(TLS_SETTINGS_KEY, PROVIDER_TENANT_ID)

  if (raw == null) {
    // First boot. TLS_ENABLED is read exactly once, here: the installers set
    // it on a fresh install so HTTPS is on from the first request, and it is
    // never consulted again — the UI is the source of truth afterwards.
    const enabled = process.env.TLS_ENABLED === 'true'
    const seeded = { ...DEFAULT_TLS_SETTINGS, enabled }

    // "Exactly once" only holds if the seed is written down. Without this the
    // row stays absent until someone saves the settings page, so every boot
    // re-reads the variable — and dropping it from the .env of a running
    // install would silently turn HTTPS off, which is not what the UI says
    // and not what the design promises.
    try {
      await saveTlsSettings(seeded)
    } catch (err) {
      // A failed write is not worth a failed boot: the value returned here is
      // correct either way, and the next boot simply seeds again.
      console.error('[tls] could not persist the first-boot settings, TLS_ENABLED will be read again next boot:', err)
    }

    return seeded
  }

  const parsed = tlsSettingsSchema.safeParse(withoutUnknownDnsProvider(raw))

  if (!parsed.success) {
    console.error('[tls] stored settings do not validate, falling back to the defaults:', parsed.error.message)

    return { ...DEFAULT_TLS_SETTINGS }
  }

  return parsed.data
}

export async function saveTlsSettings(next: TlsSettings): Promise<TlsSettings> {
  const parsed = tlsSettingsSchema.parse(next)

  await setSetting(TLS_SETTINGS_KEY, PROVIDER_TENANT_ID, parsed)

  return parsed
}
