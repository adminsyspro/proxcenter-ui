import { describe, expect, it, vi } from 'vitest'

import { createPowerDnsProvider } from '@/lib/tls/dns/providers/powerdns'
import { DnsProviderError } from '@/lib/tls/dns/types'

const ZONES = 'http://pdns.lab:8081/api/v1/servers/localhost/zones'
const FQDN = '_acme-challenge.lab.example.com'
const NAME = '_acme-challenge.lab.example.com.'
const READ = `${ZONES}/example.com.?rrset_name=${encodeURIComponent(NAME)}&rrset_type=TXT`

type Answer = { status: number; body?: unknown }

// A fake PowerDNS: routes keyed by "METHOD url", every call recorded.
function fakePdns(routes: Record<string, Answer>) {
  return vi.fn(async (url: string, init: RequestInit = {}) => {
    const key = `${init.method ?? 'GET'} ${url}`
    const route = routes[key] ?? { status: 404, body: { error: 'Not Found' } }

    return new Response(route.body === undefined ? null : JSON.stringify(route.body), { status: route.status })
  })
}

const calls = (fetchImpl: ReturnType<typeof fakePdns>) => fetchImpl.mock.calls.map(([url, init]) => `${init?.method ?? 'GET'} ${url}`)
const patchBody = (fetchImpl: ReturnType<typeof fakePdns>) =>
  JSON.parse(String(fetchImpl.mock.calls.find(([, i]) => i?.method === 'PATCH')![1]!.body))

const zoneRoutes: Record<string, Answer> = {
  [`GET ${ZONES}/_acme-challenge.lab.example.com.?rrsets=false`]: { status: 404, body: { error: 'Could not find domain' } },
  // An older release answers 422 for an unknown zone.
  [`GET ${ZONES}/lab.example.com.?rrsets=false`]: { status: 422, body: { error: 'Could not find domain' } },
  [`GET ${ZONES}/example.com.?rrsets=false`]: { status: 200, body: { id: 'example.com.', name: 'example.com.' } },
}
const txt = (ttl: number, ...contents: string[]): Answer => ({
  status: 200,
  body: {
    id: 'example.com.',
    rrsets: [
      { name: 'www.example.com.', type: 'A', ttl: 300, records: [{ content: '192.0.2.1', disabled: false }] },
      { name: NAME, type: 'TXT', ttl, records: contents.map(content => ({ content, disabled: false })) },
    ],
  },
})
const noTxt: Answer = { status: 200, body: { id: 'example.com.', rrsets: [] } }
const patched: Record<string, Answer> = { [`PATCH ${ZONES}/example.com.`]: { status: 204 } }

const provider = (fetchImpl: ReturnType<typeof fakePdns>, apiUrl = 'http://pdns.lab:8081') =>
  createPowerDnsProvider({ apiUrl, apiKey: 'pdns-secret', serverId: '' }, { fetch: fetchImpl as any })

describe('createPowerDnsProvider', () => {
  it('finds the longest zone, canonical with a trailing dot, with the API key', async () => {
    const fetchImpl = fakePdns({ ...zoneRoutes, [`GET ${READ}`]: noTxt })

    await provider(fetchImpl).checkAccess(FQDN)

    expect(calls(fetchImpl)).toEqual([
      `GET ${ZONES}/_acme-challenge.lab.example.com.?rrsets=false`,
      `GET ${ZONES}/lab.example.com.?rrsets=false`,
      `GET ${ZONES}/example.com.?rrsets=false`,
      `GET ${READ}`,
    ])
    expect((fetchImpl.mock.calls[0][1]!.headers as Record<string, string>)['X-API-Key']).toBe('pdns-secret')
  })

  it.each(['http://pdns.lab:8081/', 'http://pdns.lab:8081/api/v1', 'http://pdns.lab:8081/api/v1/', 'http://pdns.lab:8081/api'])(
    'accepts the API URL written as %s',
    async apiUrl => {
      const fetchImpl = fakePdns({ ...zoneRoutes, [`GET ${READ}`]: noTxt })

      await provider(fetchImpl, apiUrl).checkAccess(FQDN)

      expect(String(fetchImpl.mock.calls[0][0])).toBe(`${ZONES}/_acme-challenge.lab.example.com.?rrsets=false`)
    },
  )

  it('honours a custom server id', async () => {
    const fetchImpl = fakePdns({})
    const p = createPowerDnsProvider({ apiUrl: 'http://pdns.lab:8081', apiKey: 'k', serverId: 'ns2' }, { fetch: fetchImpl as any })

    await expect(p.checkAccess('_acme-challenge.example.com')).rejects.toThrow('PowerDNS: no zone on server "ns2" for _acme-challenge.example.com')
    expect(String(fetchImpl.mock.calls[0][0])).toContain('/api/v1/servers/ns2/zones/')
  })

  it('creates the RRSet with a quoted value', async () => {
    const fetchImpl = fakePdns({ ...zoneRoutes, [`GET ${READ}`]: noTxt, ...patched })

    await provider(fetchImpl).addTxtRecord(FQDN, 'tok')

    expect(patchBody(fetchImpl)).toEqual({
      rrsets: [{ name: NAME, type: 'TXT', ttl: 60, changetype: 'REPLACE', records: [{ content: '"tok"', disabled: false }] }],
    })
  })

  it('replaces with the full merged list, keeping the other values and the TTL', async () => {
    const fetchImpl = fakePdns({ ...zoneRoutes, [`GET ${READ}`]: txt(120, '"other"'), ...patched })

    await provider(fetchImpl).addTxtRecord(FQDN, 'tok')

    expect(patchBody(fetchImpl).rrsets[0]).toEqual({
      name: NAME,
      type: 'TXT',
      ttl: 120,
      changetype: 'REPLACE',
      records: [{ content: '"other"', disabled: false }, { content: '"tok"', disabled: false }],
    })
  })

  it('does not write when the value is already there', async () => {
    const fetchImpl = fakePdns({ ...zoneRoutes, [`GET ${READ}`]: txt(60, '"tok"') })

    await provider(fetchImpl).addTxtRecord(FQDN, 'tok')

    expect(calls(fetchImpl).every(c => c.startsWith('GET'))).toBe(true)
  })

  it('removes only the matching value', async () => {
    const fetchImpl = fakePdns({ ...zoneRoutes, [`GET ${READ}`]: txt(60, '"other"', '"tok"'), ...patched })

    await provider(fetchImpl).removeTxtRecord(FQDN, 'tok')

    expect(patchBody(fetchImpl).rrsets[0]).toEqual({
      name: NAME, type: 'TXT', ttl: 60, changetype: 'REPLACE', records: [{ content: '"other"', disabled: false }],
    })
  })

  it('deletes the RRSet when its last value goes', async () => {
    const fetchImpl = fakePdns({ ...zoneRoutes, [`GET ${READ}`]: txt(60, '"tok"'), ...patched })

    await provider(fetchImpl).removeTxtRecord(FQDN, 'tok')

    expect(patchBody(fetchImpl)).toEqual({ rrsets: [{ name: NAME, type: 'TXT', changetype: 'DELETE' }] })
  })

  it('does nothing when the value or the RRSet is absent', async () => {
    const absentValue = fakePdns({ ...zoneRoutes, [`GET ${READ}`]: txt(60, '"other"') })
    const absentSet = fakePdns({ ...zoneRoutes, [`GET ${READ}`]: noTxt })

    await provider(absentValue).removeTxtRecord(FQDN, 'tok')
    await provider(absentSet).removeTxtRecord(FQDN, 'tok')

    expect(calls(absentValue).every(c => c.startsWith('GET'))).toBe(true)
    expect(calls(absentSet).every(c => c.startsWith('GET'))).toBe(true)
  })

  it('says no zone was found, without the key', async () => {
    const err = await provider(fakePdns({})).checkAccess('_acme-challenge.nope.test').catch(e => e)

    expect(err).toBeInstanceOf(DnsProviderError)
    expect(err.message).toBe('PowerDNS: no zone on server "localhost" for _acme-challenge.nope.test')
    expect(err.message).not.toContain('pdns-secret')
  })

  it('refuses an API URL that is not http(s)', () => {
    expect(() => createPowerDnsProvider({ apiUrl: 'ftp://pdns.lab', apiKey: 'k' }, { fetch: vi.fn() as any })).toThrow('http:// or https://')
  })
})
