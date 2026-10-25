import { describe, expect, it, vi } from 'vitest'

import { createAcmeDnsProvider } from '@/lib/tls/dns/providers/acmedns'
import { DnsProviderError } from '@/lib/tls/dns/types'

const credentials = {
  apiUrl: 'https://auth.acme-dns.lab/',
  username: 'c36f50e8-4632-44f0-83fe-e070fef28a10',
  password: 'acmedns-secret',
  subdomain: '8e5700ea-a4bf-41c7-8a77-e990661dcc6a',
}

const respond = (status: number, body?: unknown) => vi.fn(async () => new Response(body === undefined ? null : JSON.stringify(body), { status }))

describe('createAcmeDnsProvider', () => {
  it('posts the value to the account subdomain, whatever name ACME asked for', async () => {
    const fetchImpl = respond(200, { txt: 'tok' })

    await createAcmeDnsProvider(credentials, { fetch: fetchImpl as any }).addTxtRecord('_acme-challenge.lab.example.com', 'tok')

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]

    expect(url).toBe('https://auth.acme-dns.lab/update')
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({ 'X-Api-User': credentials.username, 'X-Api-Key': 'acmedns-secret' })
    expect(JSON.parse(String(init.body))).toEqual({ subdomain: credentials.subdomain, txt: 'tok' })
  })

  it('passes a refused update on, without the password', async () => {
    const fetchImpl = respond(401, { error: 'forbidden' })

    const err = await createAcmeDnsProvider(credentials, { fetch: fetchImpl as any }).addTxtRecord('x', 'tok').catch(e => e)

    expect(err).toBeInstanceOf(DnsProviderError)
    expect(err.message).toContain('HTTP 401')
    expect(err.message).not.toContain('acmedns-secret')
  })

  it('never calls the server to remove a value', async () => {
    const fetchImpl = respond(200)

    await createAcmeDnsProvider(credentials, { fetch: fetchImpl as any }).removeTxtRecord('_acme-challenge.example.com', 'tok')

    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('checks access with a read-only health probe', async () => {
    const fetchImpl = respond(200)

    await createAcmeDnsProvider(credentials, { fetch: fetchImpl as any }).checkAccess('_acme-challenge.example.com')

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]

    expect(url).toBe('https://auth.acme-dns.lab/health')
    expect(init.method ?? 'GET').toBe('GET')
  })

  it('treats a server without /health as reachable', async () => {
    await expect(createAcmeDnsProvider(credentials, { fetch: respond(404) as any }).checkAccess('x')).resolves.toBeUndefined()
  })

  it('reports an unreachable server', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('ECONNREFUSED') })

    await expect(createAcmeDnsProvider(credentials, { fetch: fetchImpl as any }).checkAccess('x'))
      .rejects.toThrow('acme-dns: auth.acme-dns.lab unreachable (ECONNREFUSED)')
  })

  it('refuses an API URL that is not http(s)', () => {
    expect(() => createAcmeDnsProvider({ ...credentials, apiUrl: 'ftp://auth.lab' }, { fetch: vi.fn() as any })).toThrow('http:// or https://')
    expect(() => createAcmeDnsProvider({ ...credentials, apiUrl: 'not a url' }, { fetch: vi.fn() as any })).toThrow('not a valid URL')
  })
})
