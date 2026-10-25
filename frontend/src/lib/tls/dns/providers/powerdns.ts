// src/lib/tls/dns/providers/powerdns.ts
//
// PowerDNS Authoritative HTTP API with the server's api-key. An RRSet is
// replaced as a whole (changetype REPLACE), so every change is a read of the
// set followed by a write of the full merged list; EXTEND and PRUNE would
// avoid that but only exist since 4.9.12 / 5.0.2. Names are canonical, with
// the trailing dot.

import { DnsProviderError, type DnsProviderFactory } from '@/lib/tls/dns/types'
import { dnsHttp, quoteTxt, requireField, unquoteTxt, zoneCandidates } from '@/lib/tls/dns/util'

const LABEL = 'PowerDNS'
const TTL = 60

interface PdnsRecord {
  content: string
  disabled: boolean
}

/** `http://pdns:8081`, `http://pdns:8081/` and `http://pdns:8081/api/v1` all mean the same server. */
function apiRoot(raw: string): string {
  let url: URL

  try {
    url = new URL(raw)
  } catch {
    throw new DnsProviderError(`${LABEL}: the API URL is not a valid URL`)
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new DnsProviderError(`${LABEL}: the API URL must start with http:// or https://`)

  const path = url.pathname.replace(/\/+$/, '').replace(/\/api(\/v1)?$/, '')

  return `${url.origin}${path}/api/v1`
}

export const createPowerDnsProvider: DnsProviderFactory = (credentials, { fetch }) => {
  const root = apiRoot(requireField(credentials, 'apiUrl', LABEL))
  const apiKey = requireField(credentials, 'apiKey', LABEL)
  const serverId = credentials.serverId?.trim() || 'localhost'
  const base = `${root}/servers/${encodeURIComponent(serverId)}/zones`
  const headers = { 'X-API-Key': apiKey, 'Content-Type': 'application/json' }
  const zoneIds = new Map<string, string>()

  async function zoneIdFor(fqdn: string): Promise<string> {
    for (const candidate of zoneCandidates(fqdn)) {
      const cached = zoneIds.get(candidate)

      if (cached) return cached

      // An unknown zone is a 404 on current releases and a 422 on older ones.
      const { status, body } = await dnsHttp(fetch, LABEL, `${base}/${encodeURIComponent(`${candidate}.`)}?rrsets=false`, {
        headers, allowStatus: [404, 422],
      })

      if (status === 200) {
        // The id is what the API wants in later paths (it escapes odd characters).
        const id = String(body?.id || `${candidate}.`)

        zoneIds.set(candidate, id)

        return id
      }
    }

    throw new DnsProviderError(`${LABEL}: no zone on server "${serverId}" for ${fqdn}`)
  }

  async function currentRecords(zoneId: string, name: string): Promise<{ ttl: number; records: PdnsRecord[] } | undefined> {
    // Releases without the rrset_name filter return the whole zone: the
    // lookup below works either way.
    const { body } = await dnsHttp(fetch, LABEL, `${base}/${encodeURIComponent(zoneId)}?rrset_name=${encodeURIComponent(name)}&rrset_type=TXT`, { headers })
    const rrset = (body?.rrsets ?? []).find((r: any) => r?.type === 'TXT' && String(r?.name).toLowerCase() === name)

    if (!rrset) return undefined

    return {
      ttl: Number(rrset.ttl) || TTL,
      records: (rrset.records ?? []).map((r: any) => ({ content: String(r?.content ?? ''), disabled: Boolean(r?.disabled) })),
    }
  }

  async function patch(zoneId: string, rrset: Record<string, unknown>): Promise<void> {
    await dnsHttp(fetch, LABEL, `${base}/${encodeURIComponent(zoneId)}`, {
      method: 'PATCH', headers, body: JSON.stringify({ rrsets: [rrset] }),
    })
  }

  return {
    async addTxtRecord(fqdn, value) {
      const zoneId = await zoneIdFor(fqdn)
      const name = `${fqdn.toLowerCase()}.`
      const current = await currentRecords(zoneId, name)

      if (current?.records.some(r => unquoteTxt(r.content) === value)) return

      await patch(zoneId, {
        name,
        type: 'TXT',
        ttl: current?.ttl ?? TTL,
        changetype: 'REPLACE',
        records: [...(current?.records ?? []), { content: quoteTxt(value), disabled: false }],
      })
    },

    async removeTxtRecord(fqdn, value) {
      const zoneId = await zoneIdFor(fqdn)
      const name = `${fqdn.toLowerCase()}.`
      const current = await currentRecords(zoneId, name)

      if (!current) return

      const rest = current.records.filter(r => unquoteTxt(r.content) !== value)

      if (rest.length === current.records.length) return

      await patch(zoneId, rest.length === 0
        ? { name, type: 'TXT', changetype: 'DELETE' }
        : { name, type: 'TXT', ttl: current.ttl, changetype: 'REPLACE', records: rest })
    },

    async checkAccess(fqdn) {
      await currentRecords(await zoneIdFor(fqdn), `${fqdn.toLowerCase()}.`)
    },
  }
}
