// src/lib/tls/dns/util.ts
//
// Helpers shared by the DNS providers: record names, zone discovery and one
// bounded HTTP round trip with an error an operator can read.

import { DnsProviderError } from '@/lib/tls/dns/types'

export const DNS_HTTP_TIMEOUT_MS = 30_000

/** `*.example.com` and `example.com` both validate at `_acme-challenge.example.com`. */
export function challengeRecordName(domain: string): string {
  const bare = domain.replace(/^\*\./, '').replace(/\.$/, '').toLowerCase()

  return `_acme-challenge.${bare}`
}

/**
 * Every suffix of `fqdn` that could be a zone apex, longest first, stopping
 * before the bare TLD. Providers try them in order and keep the first one the
 * account owns, so a delegated `lab.example.com` wins over `example.com`.
 */
export function zoneCandidates(fqdn: string): string[] {
  const labels = fqdn.replace(/\.$/, '').toLowerCase().split('.')
  const candidates: string[] = []

  for (let i = 0; i < labels.length - 1; i++) candidates.push(labels.slice(i).join('.'))

  return candidates
}

/** `_acme-challenge.www` for `_acme-challenge.www.example.com` in zone `example.com`, `@` at the apex. */
export function relativeName(fqdn: string, zone: string): string {
  const name = fqdn.replace(/\.$/, '').toLowerCase()
  const apex = zone.replace(/\.$/, '').toLowerCase()

  if (name === apex) return '@'
  if (!name.endsWith(`.${apex}`)) throw new DnsProviderError(`${fqdn} is not inside the zone ${zone}`)

  return name.slice(0, -(apex.length + 1))
}

/** A TXT value as zone files and most APIs want it: quoted, inner quotes escaped. */
export function quoteTxt(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

export function unquoteTxt(value: string): string {
  const trimmed = value.trim()

  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    // A long value may come back as several quoted strings: "abc" "def".
    return trimmed
      .slice(1, -1)
      .split(/"\s+"/)
      .join('')
      .replace(/\\(["\\])/g, '$1')
  }

  return trimmed
}

export function requireField(credentials: Record<string, string>, key: string, providerLabel: string): string {
  const value = credentials[key]?.trim()

  if (!value) throw new DnsProviderError(`${providerLabel}: the "${key}" field is empty`)

  return value
}

export interface DnsHttpResponse<T> {
  status: number
  body: T
}

/**
 * One HTTP call to a DNS API. Bounded, because a provider that accepts the
 * connection and goes quiet would otherwise hold the renewal lease. A non-2xx
 * answer becomes a DnsProviderError carrying the status and the start of the
 * body, which is where every provider puts its explanation; `allowStatus`
 * lets a caller treat, say, a 404 as an answer rather than a failure.
 */
export async function dnsHttp<T = any>(
  fetchImpl: typeof fetch,
  providerLabel: string,
  url: string,
  init: RequestInit & { allowStatus?: number[] } = {},
): Promise<DnsHttpResponse<T>> {
  const { allowStatus = [], ...rest } = init
  let res: Response

  try {
    res = await fetchImpl(url, { ...rest, signal: AbortSignal.timeout(DNS_HTTP_TIMEOUT_MS) })
  } catch (err: any) {
    throw new DnsProviderError(`${providerLabel}: ${new URL(url).host} unreachable (${err?.message || err})`)
  }

  const text = await res.text()
  let body: any = text

  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      // Not JSON (Route 53 answers XML): the caller gets the raw text.
    }
  }

  if (!res.ok && !allowStatus.includes(res.status)) {
    const detail = text.replace(/\s+/g, ' ').trim().slice(0, 300)

    throw new DnsProviderError(`${providerLabel}: HTTP ${res.status} on ${rest.method ?? 'GET'} ${new URL(url).pathname}${detail ? ` (${detail})` : ''}`)
  }

  return { status: res.status, body }
}
