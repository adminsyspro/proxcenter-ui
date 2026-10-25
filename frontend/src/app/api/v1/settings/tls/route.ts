// src/app/api/v1/settings/tls/route.ts
//
// Read and write of the TLS settings. The secrets in the blob (EAB HMAC key,
// DNS provider credentials) are handled by src/lib/tls/secrets.ts: sealed at
// rest, blanked on the way out, and kept when they come back blank.

import { NextResponse } from 'next/server'

import { audit } from '@/lib/audit'
import { withAudit } from '@/lib/audit/withAudit'
import { applyActiveCertificate } from '@/lib/tls/bootstrap'
import { requireTlsAdmin } from '@/lib/tls/guard'
import { configuredDnsSecrets, redactSecrets, sealIncomingSecrets } from '@/lib/tls/secrets'
import { DEFAULT_TLS_SETTINGS, type TlsSettings, resolveTlsPort, tlsSettingsSchema } from '@/lib/tls/schema'
import { loadTlsSettings, saveTlsSettings } from '@/lib/tls/settings'
import { getActiveSummary } from '@/lib/tls/store'
import { checkPublicUrlCoherence } from '@/lib/tls/urlCoherence'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * The four fields src/lib/tls/renew.ts writes on its own (order progress and
 * backoff) come from the stored row, never from the tab, which only sends back
 * what it last loaded. And once the CA, the method or the names change, the
 * last outcome no longer describes this setup: a tab switched from an internal
 * CA to Let's Encrypt kept saying "issued and activated" for a certificate
 * Let's Encrypt never issued. So that outcome and its backoff are cleared,
 * unless an order is still running.
 */
function withServerOwnedState(current: TlsSettings, next: TlsSettings): TlsSettings {
  const sameTarget =
    current.acme.directoryUrl === next.acme.directoryUrl &&
    current.acme.challenge === next.acme.challenge &&
    current.acme.domains.join('\n') === next.acme.domains.join('\n')

  const { order, lastError, failureCount, nextAttemptAt } =
    sameTarget || current.order.status === 'pending' ? current : DEFAULT_TLS_SETTINGS

  return { ...next, order, lastError, failureCount, nextAttemptAt }
}

export async function GET() {
  const { denied } = await requireTlsAdmin()

  if (denied) return denied

  try {
    const settings = await loadTlsSettings()
    const state = (globalThis as any).__proxcenterTls?.state?.() ?? { listening: false, port: null }

    return NextResponse.json({
      settings: redactSecrets(settings),
      eabConfigured: Boolean(settings.acme.eab),
      dnsSecretsConfigured: configuredDnsSecrets(settings),
      active: await getActiveSummary(),
      listener: { listening: state.listening, port: state.port },
      tlsPort: resolveTlsPort(),
      urlCoherence: checkPublicUrlCoherence(),
    })
  } catch (error: any) {
    console.error('Erreur GET settings/tls:', error)

    return NextResponse.json({ error: error?.message || 'Erreur serveur' }, { status: 500 })
  }
}

async function handlePut(request: Request) {
  const { denied } = await requireTlsAdmin()

  if (denied) return denied

  try {
    const body = await request.json()
    const current = await loadTlsSettings()

    const bodyForValidation = sealIncomingSecrets(body, current)

    const parsed = tlsSettingsSchema.safeParse(bodyForValidation)

    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid payload', details: parsed.error.flatten() }, { status: 400 })
    }

    // Public URLs still on http:// while HTTPS goes on is worth a warning, and
    // the tab renders one (GET reports `urlCoherence`), but NOT a refusal. The
    // refusal used to be here, and it pushed the operator into the one order of
    // operations that locks them out: an HTTP install told to set APP_URL and
    // NEXTAUTH_URL to https and restart gets `secure` session cookies that a
    // plain-HTTP browser will not send back, before any HTTPS listener exists
    // to log in through. The listener comes first, the URLs after.
    const saved = await saveTlsSettings(withServerOwnedState(current, parsed.data))

    // Applying the change can tear down the very connection carrying this
    // response: disabling HTTPS, or moving the protocol floor, stops the
    // listener (bootstrap.ts), and start.js destroys what is left of its
    // connections after a short grace. Awaited, a request submitted over that
    // listener dies before the response is written and the operator sees a
    // network error with no way to tell whether the change applied. So the
    // teardown cases are started and left to run: the save is already
    // committed, the grace in start.js is long enough for this response to
    // reach the wire, and the tab reloads GET right after. Everything else
    // (enabling, a certificate swap, HSTS, redirect) keeps the listener up and
    // stays awaited, so a listener that fails to come up still surfaces here.
    const state = (globalThis as any).__proxcenterTls?.state?.() ?? { listening: false, minVersion: null }
    const tearsDownListener = Boolean(state.listening) && (!saved.enabled || state.minVersion !== saved.minVersion)

    if (tearsDownListener) {
      void applyActiveCertificate().catch(err => console.error('[tls] applying the listener change failed:', err))
    } else {
      await applyActiveCertificate()
    }

    await audit({
      action: 'tls.settings',
      category: 'security',
      resourceType: 'tls_settings',
      status: 'success',
      details: {
        enabled: saved.enabled,
        source: saved.source,
        redirectHttp: saved.redirectHttp,
        hsts: saved.hsts.enabled,
        minVersion: saved.minVersion,
        directoryUrl: saved.acme.directoryUrl,
        domains: saved.acme.domains,
        challenge: saved.acme.challenge,
        dnsProvider: saved.acme.challenge === 'dns-01' ? saved.acme.dns.provider : null,
      },
    })

    return NextResponse.json({ settings: redactSecrets(saved), eabConfigured: Boolean(saved.acme.eab), dnsSecretsConfigured: configuredDnsSecrets(saved) })
  } catch (error: any) {
    console.error('Erreur PUT settings/tls:', error)

    return NextResponse.json({ error: error?.message || 'Erreur serveur' }, { status: 500 })
  }
}

// The handler writes its own, richer audit row on every path it controls;
// the wrapper only catches what it cannot (an unexpected throw, a refusal).
export const PUT = withAudit({ category: 'security', action: 'update', resourceType: 'tls_settings' }, handlePut)
