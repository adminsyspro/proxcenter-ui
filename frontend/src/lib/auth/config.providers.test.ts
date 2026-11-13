/**
 * getAuthOptions builds one NextAuth provider per live OIDC connection
 * (issue #1289): the provider IdP keeps "oidc", a tenant IdP gets
 * "oidc-<tenant>". A tenant IdP is registered only for the request that
 * addresses it, endpoints come from our own discovery, and each connection's
 * HTTP options are set on its own openid-client instances, never as the
 * process-wide defaults two concurrent sign-ins would race on.
 */
import https from 'node:https'

import { custom } from 'openid-client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { listActiveMock, metadataMock } = vi.hoisted(() => ({ listActiveMock: vi.fn(), metadataMock: vi.fn() }))

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }))
vi.mock('./oidcConnections', async () => {
  const actual = await vi.importActual<typeof import('./oidcConnections')>('./oidcConnections')
  return { ...actual, listActiveOidcConnections: listActiveMock }
})
vi.mock('./oidcMetadata', async () => {
  const actual = await vi.importActual<typeof import('./oidcMetadata')>('./oidcMetadata')
  return { ...actual, resolveOidcMetadata: metadataMock }
})

import { getAuthOptions } from './config'

const signinAt = (id: string) => new Request(`http://pxc.test/api/auth/signin/${id}`, { method: 'POST' })
const callbackAt = (id: string) => new Request(`http://pxc.test/api/auth/callback/${id}?code=c&state=s`)

function connection(id: string, issuer: string, clientId: string, over: Record<string, unknown> = {}) {
  return {
    id, tenantId: id, enabled: true, providerName: `IdP ${id}`, issuerUrl: issuer, clientId, clientSecret: 's',
    scopes: 'openid profile email', authorizationUrl: null, tokenUrl: null, userinfoUrl: null, claimEmail: 'email', claimName: 'name',
    proxyUrl: null, proxyUsername: null, proxyPassword: null, proxyBypass: null, strictUrls: false, ...over,
  }
}

const metadataOf = (issuer: string) => ({
  issuer,
  authorization_endpoint: `${issuer}/auth`,
  token_endpoint: `${issuer}/token`,
  userinfo_endpoint: `${issuer}/userinfo`,
  jwks_uri: `${issuer}/certs`,
})

const oidcProviders = async (req?: Request) =>
  ((await getAuthOptions(req)).providers as any[]).filter(p => String(p.id).startsWith('oidc'))

beforeEach(() => {
  vi.clearAllMocks()
  metadataMock.mockImplementation(async (c: any) => metadataOf(c.issuerUrl.replace(/\/+$/, '')))
  listActiveMock.mockResolvedValue([
    connection('default', 'https://idp.provider.test/realm', 'pxc'),
    connection('t-acme', 'https://idp.acme.test/realm/', 'acme-pxc'),
    connection('t-beta', 'https://idp.beta.test/realm', 'beta-pxc', { strictUrls: true }),
  ])
})

describe('which providers a request registers', () => {
  it('lists only the provider IdP on /api/auth/providers, without any discovery', async () => {
    expect((await oidcProviders(new Request('http://pxc.test/api/auth/providers'))).map(p => p.id)).toEqual(['oidc'])
    expect(metadataMock).not.toHaveBeenCalled()
  })

  it('registers the one tenant IdP a sign-in or callback addresses', async () => {
    expect((await oidcProviders(signinAt('oidc-t-beta'))).map(p => p.id)).toEqual(['oidc', 'oidc-t-beta'])
    expect((await oidcProviders(callbackAt('oidc-t-acme'))).map(p => p.id)).toEqual(['oidc', 'oidc-t-acme'])
  })

  it('registers no tenant IdP for other routes or without a request', async () => {
    expect((await oidcProviders(new Request('http://pxc.test/api/auth/session'))).map(p => p.id)).toEqual(['oidc'])
    expect((await oidcProviders()).map(p => p.id)).toEqual(['oidc'])
  })

  it('registers no OIDC provider when no connection is live', async () => {
    listActiveMock.mockResolvedValue([])
    expect(await oidcProviders(signinAt('oidc'))).toEqual([])
  })
})

describe('the provider a request addresses', () => {
  it('gets explicit endpoints from our discovery, and no wellKnown NextAuth would discover itself', async () => {
    const p = (await oidcProviders(signinAt('oidc-t-acme'))).find(x => x.id === 'oidc-t-acme')
    expect(metadataMock).toHaveBeenCalledWith(expect.objectContaining({ id: 't-acme' }))
    expect(p).toMatchObject({
      name: 'IdP t-acme',
      clientId: 'acme-pxc',
      issuer: 'https://idp.acme.test/realm',
      jwks_endpoint: 'https://idp.acme.test/realm/certs',
    })
    expect(p.wellKnown).toBeUndefined()
    expect(p.authorization.url).toBe('https://idp.acme.test/realm/auth')
    expect(p.token.url).toBe('https://idp.acme.test/realm/token')
  })

  it('never sets the process-wide openid-client defaults', async () => {
    for (const p of await oidcProviders(signinAt('oidc-t-beta'))) expect(p.httpOptions).toBeUndefined()
  })

  it("exchanges the code with the connection's own agent set on its client and issuer", async () => {
    const p = (await oidcProviders(callbackAt('oidc-t-beta'))).find(x => x.id === 'oidc-t-beta')
    const client: any = { issuer: {}, callback: vi.fn(async () => ({ access_token: 'a', id_token: 'i' })) }
    const out = await p.token.request({ client, params: { code: 'c' }, checks: { state: 's' }, provider: { callbackUrl: 'http://pxc.test/cb' } })

    expect(client.callback).toHaveBeenCalledWith('http://pxc.test/cb', { code: 'c' }, { state: 's' })
    expect(out).toEqual({ tokens: { access_token: 'a', id_token: 'i' } })
    const url = new URL('https://idp.beta.test/realm/token')
    expect(client[custom.http_options](url, {}).agent).toBeInstanceOf(https.Agent)
    expect(client.issuer[custom.http_options](url, {}).agent).toBeInstanceOf(https.Agent)
  })

  it("keeps a plain connection's one-off direct agent on its own client", async () => {
    const p = (await oidcProviders(callbackAt('oidc'))).find(x => x.id === 'oidc')
    const client: any = { issuer: {}, callback: vi.fn(async () => ({})) }
    await p.token.request({ client, params: {}, checks: {}, provider: { callbackUrl: 'x' } })
    expect(client[custom.http_options](new URL('https://idp.provider.test/realm/token'), {}).agent).toBe(false)
  })

  it('stamps the tenant on the profile so the account lands in the right tenant', async () => {
    const p = (await oidcProviders(signinAt('oidc-t-acme'))).find(x => x.id === 'oidc-t-acme')
    expect(p.profile({ sub: 's', email: 'a@acme.test', name: 'A' })).toMatchObject({ id: 's', tenantId: 't-acme', authProvider: 'oidc' })
  })

  it('stays registered when discovery fails, so NextAuth reports the error instead of an unknown provider', async () => {
    metadataMock.mockRejectedValue(new Error('down'))
    const p = (await oidcProviders(signinAt('oidc-t-acme'))).find(x => x.id === 'oidc-t-acme')
    expect(p).toBeDefined()
    expect(p.authorization?.url).toBeUndefined()
  })
})
