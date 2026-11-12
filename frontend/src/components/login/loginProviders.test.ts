/**
 * Which providers answer and which NextAuth provider the SSO button starts,
 * on /login and on a tenant's /login/<slug> (issue #1289).
 */
import { describe, expect, it } from 'vitest'

import { providersEndpoint, ssoProviderId, startSso } from './loginProviders'

describe('providersEndpoint', () => {
  it('asks for the platform providers on /login', () => {
    expect(providersEndpoint()).toBe('/api/v1/auth/providers')
    expect(providersEndpoint('')).toBe('/api/v1/auth/providers')
  })

  it("asks for the tenant's providers on /login/<slug>, slug encoded", () => {
    expect(providersEndpoint('acme')).toBe('/api/v1/auth/providers?tenant=acme')
    expect(providersEndpoint('a b&c')).toBe('/api/v1/auth/providers?tenant=a%20b%26c')
  })
})

describe('ssoProviderId', () => {
  it("starts the provider the API names (a tenant IdP's own id)", () => {
    expect(ssoProviderId({ oidcProviderId: 'oidc-t-acme' })).toBe('oidc-t-acme')
  })

  it('falls back to the provider IdP for an older answer or anything unexpected', () => {
    expect(ssoProviderId({})).toBe('oidc')
    expect(ssoProviderId(null)).toBe('oidc')
    expect(ssoProviderId({ oidcProviderId: 'credentials' })).toBe('oidc')
  })
})

describe('startSso (issue #1289)', () => {
  function deps(url = 'https://idp.acme.example/auth?x=1') {
    const calls: any = { signIn: [], fetch: [], navigate: [] }
    return {
      calls,
      d: {
        signIn: async (...args: unknown[]) => { calls.signIn.push(args) },
        getCsrfToken: async () => 'csrf-1',
        fetch: (async (input: string, init: any) => {
          calls.fetch.push([input, init])
          return new Response(JSON.stringify({ url }), { status: 200 })
        }) as unknown as typeof fetch,
        navigate: (to: string) => { calls.navigate.push(to) },
      },
    }
  }

  it('starts the provider IdP through next-auth as before', async () => {
    const { calls, d } = deps()
    await startSso('oidc', '/home', d)
    expect(calls.signIn).toEqual([['oidc', { callbackUrl: '/home' }]])
    expect(calls.fetch).toEqual([])
  })

  // The tenant IdP is not in the public provider list (it would enumerate the
  // tenants), and next-auth's client signIn() refuses a provider it does not
  // list: the sign-in request is posted directly instead.
  it("posts a tenant IdP's sign-in itself and follows the IdP URL", async () => {
    const { calls, d } = deps()
    await startSso('oidc-t-acme', '/home', d)
    expect(calls.signIn).toEqual([])
    const [url, init] = calls.fetch[0]
    expect(url).toBe('/api/auth/signin/oidc-t-acme')
    expect(init.method).toBe('POST')
    expect(Object.fromEntries(new URLSearchParams(String(init.body)))).toEqual({ csrfToken: 'csrf-1', callbackUrl: '/home', json: 'true' })
    expect(calls.navigate).toEqual(['https://idp.acme.example/auth?x=1'])
  })

  it('falls back to the callback URL when the answer carries none', async () => {
    const { calls, d } = deps(undefined as any)
    d.fetch = async () => new Response('{}', { status: 200 })
    await startSso('oidc-t-acme', '/home', d)
    expect(calls.navigate).toEqual(['/home'])
  })
})
