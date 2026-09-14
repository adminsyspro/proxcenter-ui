import { describe, it, expect, vi, beforeEach } from 'vitest'

import {
  buildDiscoveryUrl,
  buildEndSessionUrl,
  clearEndSessionCache,
  discoverEndSessionEndpoint,
} from './oidcLogout'

beforeEach(() => {
  clearEndSessionCache()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

const okDoc = (body: any) => ({ ok: true, json: async () => body }) as any

describe('buildDiscoveryUrl', () => {
  it('appends the well-known path and drops trailing slashes', () => {
    expect(buildDiscoveryUrl('https://idp.example.com/realms/x///')).toBe(
      'https://idp.example.com/realms/x/.well-known/openid-configuration',
    )
  })

  it('refuses a non-http(s) issuer', () => {
    expect(buildDiscoveryUrl('file:///etc/passwd')).toBeNull()
    expect(buildDiscoveryUrl('not a url')).toBeNull()
  })

  it('returns null on an empty issuer rather than building a bare path', () => {
    expect(buildDiscoveryUrl('')).toBeNull()
    expect(buildDiscoveryUrl(null)).toBeNull()
  })

  it('strips anything the issuer tried to smuggle past the path', () => {
    // Rebuilt from origin + pathname, so a query string cannot survive.
    expect(buildDiscoveryUrl('https://idp.example.com/r?next=http://evil')).not.toContain('evil')
  })
})

describe('discoverEndSessionEndpoint', () => {
  it('reads end_session_endpoint from the discovery document', async () => {
    const f = vi.fn().mockResolvedValue(
      okDoc({ end_session_endpoint: 'https://idp.example.com/logout' }),
    )
    expect(await discoverEndSessionEndpoint('https://idp.example.com', f)).toBe(
      'https://idp.example.com/logout',
    )
  })

  it('returns null when the provider advertises none (Google-style)', async () => {
    const f = vi.fn().mockResolvedValue(okDoc({ authorization_endpoint: 'https://x/auth' }))
    expect(await discoverEndSessionEndpoint('https://idp.example.com', f)).toBeNull()
  })

  it('returns null instead of throwing when the IdP is unreachable', async () => {
    const f = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))
    expect(await discoverEndSessionEndpoint('https://idp.example.com', f)).toBeNull()
  })

  it('returns null on a non-2xx discovery response', async () => {
    const f = vi.fn().mockResolvedValue({ ok: false } as any)
    expect(await discoverEndSessionEndpoint('https://idp.example.com', f)).toBeNull()
  })

  it('refuses an end_session_endpoint that is not http(s)', async () => {
    const f = vi.fn().mockResolvedValue(okDoc({ end_session_endpoint: 'javascript:alert(1)' }))
    expect(await discoverEndSessionEndpoint('https://idp.example.com', f)).toBeNull()
  })

  it('caches the answer so a logout never pays discovery twice', async () => {
    const f = vi.fn().mockResolvedValue(okDoc({ end_session_endpoint: 'https://idp/logout' }))
    await discoverEndSessionEndpoint('https://idp.example.com', f)
    await discoverEndSessionEndpoint('https://idp.example.com', f)
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('caches the negative answer too, so a slow IdP is not polled on every logout', async () => {
    const f = vi.fn().mockRejectedValue(new Error('timeout'))
    await discoverEndSessionEndpoint('https://idp.example.com', f)
    await discoverEndSessionEndpoint('https://idp.example.com', f)
    expect(f).toHaveBeenCalledTimes(1)
  })
})

describe('buildEndSessionUrl', () => {
  const base = {
    endSessionEndpoint: 'https://idp.example.com/logout',
    postLogoutRedirectUri: 'https://app.example.com/login',
    clientId: 'proxcenter',
  }

  it('prefers id_token_hint, the only form Okta accepts', () => {
    const url = new URL(buildEndSessionUrl({ ...base, idToken: 'the.id.token' }))
    expect(url.searchParams.get('id_token_hint')).toBe('the.id.token')
    expect(url.searchParams.get('client_id')).toBeNull()
    expect(url.searchParams.get('post_logout_redirect_uri')).toBe('https://app.example.com/login')
  })

  it('falls back to client_id when no id_token was kept', () => {
    // Without either, Keycloak shows a "really log out?" confirmation screen.
    const url = new URL(buildEndSessionUrl({ ...base, idToken: null }))
    expect(url.searchParams.get('client_id')).toBe('proxcenter')
    expect(url.searchParams.get('id_token_hint')).toBeNull()
  })

  it('keeps a query string the endpoint already carried', () => {
    const url = new URL(
      buildEndSessionUrl({ ...base, endSessionEndpoint: 'https://idp/logout?tenant=a', idToken: 't' }),
    )
    expect(url.searchParams.get('tenant')).toBe('a')
    expect(url.searchParams.get('id_token_hint')).toBe('t')
  })
})
