import { generateKeyPairSync } from 'node:crypto'

import { describe, expect, it, vi } from 'vitest'

import { ACME_POLL_TIMEOUT_MS, AcmeClient, dns01Value, generateAccountKeyPem, jwkThumbprint } from '@/lib/tls/acmeClient'
import { createFakeCa, DIRECTORY_URL } from '@/lib/tls/__tests__/fakeAcmeCa'

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Replay-Nonce': 'n', ...headers } })

/** A CA answering from a table of url → response, for the edge cases the fake CA does not play. */
function scripted(routes: Record<string, () => Response>) {
  return vi.fn(async (url: string | URL | Request) => {
    const route = routes[String(url)]

    if (!route) throw new Error(`unexpected ${String(url)}`)

    return route()
  }) as unknown as typeof fetch
}

const DIRECTORY = { newNonce: 'https://ca.test/nonce', newAccount: 'https://ca.test/account', newOrder: 'https://ca.test/order' }

function client(fetchImpl: typeof fetch, sleep = vi.fn(async () => {})) {
  return new AcmeClient({ directoryUrl: DIRECTORY_URL, accountKeyPem: generateAccountKeyPem(), fetch: fetchImpl, sleep })
}

describe('AcmeClient', () => {
  it('derives the RFC 7638 thumbprint and the RFC 8555 DNS-01 digest', () => {
    // RFC 7638 §3.1 orders the members; the digest (RFC 8555 §8.4) is checked against openssl.
    expect(jwkThumbprint({ crv: 'P-256', kty: 'EC', x: 'x', y: 'y' })).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(dns01Value('token.thumb')).toBe('lCdftpJCXapaZHkBGIZbcubeKW8RmA0jSG_aZN01zbU')
  })

  it('refuses an account key that is not EC P-256', () => {
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()

    expect(() => new AcmeClient({ directoryUrl: DIRECTORY_URL, accountKeyPem: rsa })).toThrow('must be EC P-256')
  })

  it('says when the URL is not an ACME directory, or the directory fails', async () => {
    await expect(client(scripted({ [DIRECTORY_URL]: () => json(200, { hello: 'world' }) })).register('', null))
      .rejects.toThrow('does not point at an ACME directory')
    await expect(client(scripted({ [DIRECTORY_URL]: () => json(503, {}) })).register('', null))
      .rejects.toThrow('the ACME directory answered HTTP 503')
  })

  it('fails clearly when the CA hands out no nonce', async () => {
    const fetchImpl = scripted({
      [DIRECTORY_URL]: () => json(200, DIRECTORY),
      'https://ca.test/nonce': () => new Response(null, { status: 200 }),
    })

    await expect(client(fetchImpl).register('', null)).rejects.toThrow('the CA returned no nonce')
  })

  it('quotes the CA problem and its subproblems', async () => {
    const fetchImpl = scripted({
      [DIRECTORY_URL]: () => json(200, DIRECTORY),
      'https://ca.test/nonce': () => new Response(null, { headers: { 'Replay-Nonce': 'n0' } }),
      'https://ca.test/account': () => json(400, {
        type: 'urn:ietf:params:acme:error:rejectedIdentifier', detail: 'Error creating new order',
        subproblems: [{ detail: 'pcx.lab is on a blocklist' }],
      }, { 'Content-Type': 'application/problem+json' }),
    })

    await expect(client(fetchImpl).register('', null)).rejects.toMatchObject({
      message: 'Error creating new order: pcx.lab is on a blocklist',
      type: 'urn:ietf:params:acme:error:rejectedIdentifier',
      status: 400,
    })
  })

  it('needs an account before any order', async () => {
    const ca = createFakeCa()

    await expect(client(ca.fetch).newOrder([{ type: 'dns', value: 'pcx.lab' }])).rejects.toThrow('no ACME account yet')
  })

  it('reports an authorization that ends without a challenge error', async () => {
    const ca = createFakeCa()
    const c = client(ca.fetch)

    await c.register('', null)

    const fetchImpl = vi.fn(async (url: any, init: any) => (String(url).includes('/authz/') ? json(200, { status: 'deactivated', identifier: { value: 'pcx.lab' }, challenges: [] }) : ca.fetch(url, init)))
    const deactivated = new AcmeClient({ directoryUrl: DIRECTORY_URL, accountKeyPem: generateAccountKeyPem(), fetch: fetchImpl as unknown as typeof fetch })

    await deactivated.register('', null)
    const { order } = await deactivated.newOrder([{ type: 'dns', value: 'pcx.lab' }])

    await expect(deactivated.waitForAuthorization(order.authorizations[0])).rejects.toThrow('pcx.lab: authorization deactivated')
  })

  it('gives up on a CA that never settles, and on a valid order without certificate', async () => {
    const pending = json(200, { status: 'pending', identifier: { value: 'pcx.lab' }, challenges: [] })
    const sleep = vi.fn(async () => {})
    const ca = createFakeCa()
    const fetchImpl = vi.fn(async (url: any, init: any) => (String(url) === 'https://ca.test/authz/x' ? pending.clone() : ca.fetch(url, init)))
    const c = client(fetchImpl as unknown as typeof fetch, sleep)
    const now = vi.spyOn(Date, 'now')
    let t = 0

    now.mockImplementation(() => (t += ACME_POLL_TIMEOUT_MS / 4))
    await c.register('', null)
    await expect(c.waitForAuthorization('https://ca.test/authz/x')).rejects.toThrow('still pending after 5 minutes')
    now.mockRestore()

    await expect(c.downloadCertificate({ status: 'valid', authorizations: [], finalize: '' })).rejects.toThrow('carries no certificate URL')
  })

  it('reports an order the CA marks invalid after finalization', async () => {
    const ca = createFakeCa()
    const c = client(ca.fetch)

    await c.register('', null)
    const { url, order } = await c.newOrder([{ type: 'dns', value: 'pcx.lab' }])
    const fetchImpl = vi.fn(async (u: any, init: any) => (String(u) === url ? json(200, { ...order, status: 'invalid', error: { detail: 'CAA forbids issuance' } }) : ca.fetch(u, init)))
    const failing = new AcmeClient({ directoryUrl: DIRECTORY_URL, accountKeyPem: generateAccountKeyPem(), fetch: fetchImpl as unknown as typeof fetch })

    await failing.register('', null)
    await expect(failing.finalize({ ...order, finalize: 'https://ca.test/order/0/finalize' }, url, Buffer.from('csr'))).rejects.toThrow()
  })
})
