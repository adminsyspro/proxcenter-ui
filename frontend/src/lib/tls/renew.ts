// src/lib/tls/renew.ts
//
// The one place that turns settings + an ACME order into a stored, active
// certificate. Shared by the manual button and the hourly reconciler so both
// paths write the same progress, the same audit rows and the same backoff.

import { audit } from '@/lib/audit'
import { orderCertificate } from '@/lib/tls/acme'
import { applyActiveCertificate } from '@/lib/tls/bootstrap'
import { checkDnsAccess, createDnsChallengeHandlers } from '@/lib/tls/dns/solver'
import { RENEW_LEASE_MAX_MS } from '@/lib/tls/lease'
import { preflightHttp01 } from '@/lib/tls/preflight'
import type { TlsSettings } from '@/lib/tls/schema'
import { unsealEab } from '@/lib/tls/secrets'
import { loadTlsSettings, saveTlsSettings } from '@/lib/tls/settings'
import { saveCertificate } from '@/lib/tls/store'

/**
 * Let's Encrypt stops answering after five failures in an hour, so the backoff
 * is capped there rather than growing without bound.
 */
export function nextBackoff(failureCount: number, now: Date = new Date()): Date {
  const minutes = Math.min(60, 5 * 2 ** Math.max(0, failureCount - 1))

  return new Date(now.getTime() + minutes * 60_000)
}

export function shouldRenew(
  settings: TlsSettings,
  active: { source: string; notAfter: Date } | null,
  now: Date = new Date(),
): boolean {
  if (!settings.enabled) return false
  if (settings.source !== 'acme') return false

  // An install switched to ACME but not yet given a domain is an incomplete
  // configuration, not a failure. Without this, every tick would order, every
  // order would fail on "no domain configured", and the audit log would collect
  // a tls.issue FAILURE row in the security category every hour, for ever.
  if (settings.acme.domains.length === 0) return false

  // A backoff from an earlier failure outranks the renewal window: retrying
  // every hour into the same error is how an account gets rate-limited.
  if (settings.nextAttemptAt && new Date(settings.nextAttemptAt).getTime() > now.getTime()) return false

  if (!active) return true
  // An uploaded or self-signed certificate has no CA to ask; replacing it with
  // an ACME one is an explicit decision, never something the timer does.
  if (active.source !== 'acme') return false

  const remainingMs = active.notAfter.getTime() - now.getTime()

  return remainingMs <= settings.acme.renewBeforeDays * 86_400_000
}

/**
 * The four fields an order owns. Everything else in the blob belongs to the
 * operator, and an order must never write it back.
 */
type OrderState = Pick<TlsSettings, 'order' | 'lastError' | 'failureCount' | 'nextAttemptAt'>

/**
 * Write the progress of an order into the CURRENT settings, never into the
 * snapshot the order started from.
 *
 * An ACME order runs for minutes and every write here used to save the whole
 * blob as it looked when the order began: an operator who raised the minimum
 * TLS version, or turned HTTPS off, while an issuance was in flight watched the
 * change revert silently when the order finished, and the reconciler then
 * applied the older configuration to the listener. Re-reading immediately
 * before each write keeps the blast radius to the four fields above.
 */
async function patchOrderState(changes: (current: TlsSettings) => Partial<OrderState>): Promise<void> {
  const current = await loadTlsSettings()

  await saveTlsSettings({ ...current, ...changes(current) })
}

/**
 * True while an order is genuinely in flight. A `pending` row older than the
 * lease ceiling belongs to an order no replica is running any more -- a restart
 * mid-issuance leaves exactly that -- and must be reclaimable, or the feature
 * wedges on a state only a hand-written database update can clear.
 */
export function isOrderRunning(order: TlsSettings['order'], now: Date = new Date()): boolean {
  if (order.status !== 'pending') return false
  if (!order.startedAt) return false

  const startedAt = Date.parse(order.startedAt)

  if (Number.isNaN(startedAt)) return false

  return now.getTime() - startedAt < RENEW_LEASE_MAX_MS
}

export interface AcmeOrderOptions {
  /**
   * Called once, immediately before the issued certificate is written and
   * activated, and expected to throw if this replica is no longer the one
   * entitled to publish. The reconciler passes the renewal lease's handle: an
   * ACME order can outlive its lease (the ACME client has no request timeout),
   * and a certificate published after another replica has taken over is exactly
   * the overlap the lease exists to prevent. A throw here lands in the ordinary
   * failure path below — audit row, backoff, no write.
   */
  assertStillEntitled?: () => void
}

export async function runAcmeOrder(
  trigger: 'manual' | 'renewal',
  options: AcmeOrderOptions = {},
): Promise<{ ok: boolean; message?: string }> {
  // The configuration the order runs against is read once and kept: domains,
  // directory and EAB must not change under an order already on the wire, and
  // the audit row has to describe what was actually ordered. Progress, on the
  // other hand, is written through patchOrderState, against the settings as
  // they are at that moment.
  const settings = await loadTlsSettings()

  const startedAt = new Date().toISOString()

  await patchOrderState(() => ({
    order: { status: 'pending', step: 'preflight', startedAt, finishedAt: null, message: null },
  }))

  const fail = async (message: string) => {
    await patchOrderState(current => ({
      order: { status: 'error', step: '', startedAt, finishedAt: new Date().toISOString(), message },
      lastError: { at: new Date().toISOString(), message },
      failureCount: current.failureCount + 1,
      nextAttemptAt: nextBackoff(current.failureCount + 1).toISOString(),
    }))
    await audit({
      action: 'tls.issue',
      category: 'security',
      resourceType: 'tls_certificate',
      resourceName: settings.acme.domains.join(', '),
      status: 'failure',
      errorMessage: message,
      details: {
        trigger,
        directoryUrl: settings.acme.directoryUrl,
        challenge: settings.acme.challenge,
        dnsProvider: settings.acme.challenge === 'dns-01' ? settings.acme.dns.provider : null,
      },
    })

    return { ok: false, message }
  }

  try {
    if (settings.acme.domains.length === 0) {
      return await fail('no domain configured for the ACME order')
    }

    // DNS-01 has no URL to probe; the dry run is a read of each zone with
    // the provider's credentials, which catches a wrong token or a domain the
    // account does not hold before the CA is involved.
    const dns01 = settings.acme.challenge === 'dns-01'
    const probe = dns01
      ? await checkDnsAccess(settings, settings.acme.domains)
      : await preflightHttp01(settings.acme.domains)

    if (!probe.ok) {
      return await fail(probe.failures.map(f => `${f.domain}: ${f.reason}`).join(' | '))
    }

    await patchOrderState(() => ({
      order: { status: 'pending', step: 'order', startedAt, finishedAt: null, message: null },
    }))

    const issued = await orderCertificate({
      directoryUrl: settings.acme.directoryUrl,
      email: settings.acme.email,
      domains: settings.acme.domains,
      eab: unsealEab(settings),
      challenge: settings.acme.challenge,
      dns: dns01 ? createDnsChallengeHandlers(settings) : undefined,
    })

    // Last gate before anything is persisted or served.
    options.assertStillEntitled?.()

    const saved = await saveCertificate({
      source: 'acme',
      certPem: issued.certPem,
      chainPem: issued.chainPem,
      keyPem: issued.keyPem,
      activate: true,
    })

    await applyActiveCertificate()

    await patchOrderState(() => ({
      order: { status: 'ok', step: 'done', startedAt, finishedAt: new Date().toISOString(), message: null },
      lastError: null,
      failureCount: 0,
      nextAttemptAt: null,
    }))

    await audit({
      action: 'tls.issue',
      category: 'security',
      resourceType: 'tls_certificate',
      resourceId: saved.id,
      resourceName: saved.commonName,
      status: 'success',
      details: {
        trigger,
        directoryUrl: settings.acme.directoryUrl,
        challenge: settings.acme.challenge,
        dnsProvider: settings.acme.challenge === 'dns-01' ? settings.acme.dns.provider : null,
        sanNames: saved.sanNames,
        notAfter: saved.notAfter.toISOString(),
        fingerprint: saved.fingerprint,
      },
    })

    return { ok: true }
  } catch (err: any) {
    return await fail(String(err?.message || err))
  }
}
