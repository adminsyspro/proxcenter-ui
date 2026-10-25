// src/lib/tls/dns/solver.ts
//
// DNS-01 as the ACME order sees it: publish the TXT value, wait until the
// authoritative servers serve it, wait the operator's extra delay, and clean
// up afterwards. Also the dry run behind the "test" button and the preflight.

import { findDnsProvider } from '@/lib/tls/dns/catalog'
import { type PropagationOptions, waitForTxtPropagation } from '@/lib/tls/dns/propagation'
import { DNS_PROVIDER_FACTORIES } from '@/lib/tls/dns/registry'
import { type DnsProvider, DnsProviderError } from '@/lib/tls/dns/types'
import { challengeRecordName } from '@/lib/tls/dns/util'
import type { TlsSettings } from '@/lib/tls/schema'
import { unsealDnsCredentials } from '@/lib/tls/secrets'

export interface DnsSolverDeps {
  fetch?: typeof fetch
  propagation?: PropagationOptions
  sleep?: (ms: number) => Promise<void>
  log?: (message: string) => void
}

/** Builds the configured provider, with every required field checked up front. */
export function buildDnsProvider(settings: TlsSettings, deps: DnsSolverDeps = {}): DnsProvider {
  const { provider: providerId } = settings.acme.dns
  const descriptor = providerId ? findDnsProvider(providerId) : undefined

  if (!providerId || !descriptor) throw new DnsProviderError('no DNS provider selected for DNS-01')

  const credentials = unsealDnsCredentials(settings)
  const missing = descriptor.fields.filter(f => f.required && !credentials[f.key]?.trim()).map(f => f.key)

  if (missing.length > 0) throw new DnsProviderError(`${descriptor.label}: missing ${missing.join(', ')}`)

  return DNS_PROVIDER_FACTORIES[providerId](credentials, { fetch: deps.fetch ?? fetch })
}

export interface DnsChallengeHandlers {
  create(domain: string, value: string): Promise<void>
  remove(domain: string, value: string): Promise<void>
}

const defaultSleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

export function createDnsChallengeHandlers(settings: TlsSettings, deps: DnsSolverDeps = {}): DnsChallengeHandlers {
  const provider = buildDnsProvider(settings, deps)
  const sleep = deps.sleep ?? defaultSleep
  const log = deps.log ?? ((message: string) => console.log(`[tls] ${message}`))

  // The ACME client publishes every authorization of an order at once. A
  // wildcard and its apex write two values at ONE name, and several providers
  // only offer a read-modify-write of the whole record set, so two concurrent
  // writes would each drop the other's value. Writes go through one at a time.
  let queue: Promise<unknown> = Promise.resolve()
  const serialized = <T>(work: () => Promise<T>): Promise<T> => {
    const run = queue.then(work, work)

    queue = run.catch(() => {})

    return run
  }

  return {
    async create(domain, value) {
      const fqdn = challengeRecordName(domain)

      await serialized(() => provider.addTxtRecord(fqdn, value))

      const outcome = await waitForTxtPropagation(fqdn, value, { sleep, ...deps.propagation })

      if (outcome === 'unverifiable') {
        log(`no authoritative server of ${fqdn} answers from here; relying on the validation delay alone`)
      }

      const delayS = settings.acme.dns.validationDelaySeconds

      if (delayS > 0) await sleep(delayS * 1000)
    },

    async remove(domain, value) {
      await serialized(() => provider.removeTxtRecord(challengeRecordName(domain), value))
    },
  }
}

export interface DnsCheckResult {
  ok: boolean
  failures: { domain: string; reason: string }[]
}

/** Read-only: can the credentials manage the zone of every domain? */
export async function checkDnsAccess(settings: TlsSettings, domains: string[], deps: DnsSolverDeps = {}): Promise<DnsCheckResult> {
  let provider: DnsProvider

  try {
    provider = buildDnsProvider(settings, deps)
  } catch (err: any) {
    return { ok: false, failures: domains.map(domain => ({ domain, reason: String(err?.message || err) })) }
  }

  const failures: DnsCheckResult['failures'] = []

  for (const domain of domains) {
    try {
      await provider.checkAccess(challengeRecordName(domain))
    } catch (err: any) {
      failures.push({ domain, reason: String(err?.message || err) })
    }
  }

  return { ok: failures.length === 0, failures }
}
