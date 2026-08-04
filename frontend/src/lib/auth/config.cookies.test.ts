import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/auth/oidc', () => ({
  getOidcConfig: async () => null,
  isOidcEnabled: async () => false,
}))

import { getAuthOptions } from './config'

const ORIGINAL = process.env.NEXTAUTH_URL

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.NEXTAUTH_URL
  else process.env.NEXTAUTH_URL = ORIGINAL
})

function cookieOpts(opts: any) {
  return {
    session: opts.cookies.sessionToken.options.secure,
    callback: opts.cookies.callbackUrl.options.secure,
    csrf: opts.cookies.csrfToken.options.secure,
  }
}

describe('getAuthOptions(req) overrides only the secure flag', () => {
  beforeEach(() => { process.env.NEXTAUTH_URL = 'http://192.168.1.151:3000' })

  it('sets secure on all three cookies when the request arrived over https', async () => {
    const req = new Request('http://internal/api/auth/session', {
      headers: { 'x-forwarded-proto': 'https' },
    })
    const opts = await getAuthOptions(req)
    expect(cookieOpts(opts)).toEqual({ session: true, callback: true, csrf: true })
  })

  it('leaves secure false on a genuinely plaintext request', async () => {
    const req = new Request('http://internal/api/auth/session')
    const opts = await getAuthOptions(req)
    expect(cookieOpts(opts)).toEqual({ session: false, callback: false, csrf: false })
  })

  it('does NOT change the cookie names when the flag flips', async () => {
    const req = new Request('http://internal/api/auth/session', {
      headers: { 'x-forwarded-proto': 'https' },
    })
    const opts = await getAuthOptions(req)
    // Readers depend on the name; only the flag is per-request.
    expect(opts.cookies.sessionToken.name).toBe('next-auth.session-token')
    expect(opts.cookies.csrfToken.name).toBe('next-auth.csrf-token')
  })

  it('works with no argument, for the 71 getServerSession call sites', async () => {
    const opts = await getAuthOptions()
    expect(opts.cookies.sessionToken.name).toBe('next-auth.session-token')
    expect(cookieOpts(opts)).toEqual({ session: false, callback: false, csrf: false })
  })
})
