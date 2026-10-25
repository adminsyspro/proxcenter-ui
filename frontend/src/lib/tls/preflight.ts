// src/lib/tls/preflight.ts
//
// Checking the HTTP-01 path end to end BEFORE placing an order. Let's Encrypt
// stops answering after five failures in an hour, so burning that budget on a
// misconfigured DNS record or a closed port 80 is expensive. Publishing a
// throwaway challenge and fetching it back costs nothing.

import { randomBytes } from 'node:crypto'

import { dropChallenge, putChallenge } from '@/lib/tls/challengeStore'

export interface PreflightResult {
  ok: boolean
  failures: { domain: string; reason: string }[]
}

const PROBE_TIMEOUT_MS = 10_000

export async function preflightHttp01(domains: string[], fetchImpl: typeof fetch = fetch): Promise<PreflightResult> {
  const failures: PreflightResult['failures'] = []

  for (const domain of domains) {
    if (domain.startsWith('*.')) {
      failures.push({ domain, reason: 'a wildcard name can only be validated by DNS-01: switch the validation method to DNS-01' })
      continue
    }

    const token = `proxcenter-preflight-${randomBytes(16).toString('hex')}`
    const keyAuth = randomBytes(32).toString('base64url')

    try {
      await putChallenge(token, keyAuth, domain)

      const res = await fetchImpl(`http://${domain}/.well-known/acme-challenge/${token}`, {
        redirect: 'follow',
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      })

      if (!res.ok) {
        failures.push({ domain, reason: `the probe URL answered HTTP ${res.status}` })
        continue
      }

      const body = (await res.text()).trim()

      if (body !== keyAuth) {
        failures.push({ domain, reason: 'the probe URL is answered by something else than ProxCenter' })
      }
    } catch (err: any) {
      failures.push({ domain, reason: String(err?.message || err) })
    } finally {
      // The probe token must never outlive the probe, whatever happened above.
      await dropChallenge(token)
    }
  }

  return { ok: failures.length === 0, failures }
}
