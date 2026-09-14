/**
 * The shared sign-out helper. Its contract is that it ALWAYS signs the user out
 * locally: whatever the end-session lookup does, the user never stays logged in.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.hoisted: vi.mock is lifted above the file, so the factory cannot close
// over a plain top-level const.
const { signOutMock } = vi.hoisted(() => ({ signOutMock: vi.fn() }))
vi.mock('next-auth/react', () => ({ signOut: signOutMock }))

import { federatedSignOut } from './federatedSignOut'

function stubLocation() {
  const location = { href: '' }
  Object.defineProperty(window, 'location', { value: location, writable: true, configurable: true })
  return location
}

const respond = (body: any, ok = true) =>
  vi.fn().mockResolvedValue({ ok, json: async () => body })

beforeEach(() => {
  vi.clearAllMocks()
  signOutMock.mockResolvedValue(undefined)
})

describe('federatedSignOut', () => {
  it('clears the cookie then hands the browser to the provider', async () => {
    // redirect:false, otherwise NextAuth navigates away before we reach the IdP
    // and the provider session survives — the bug this helper exists to fix.
    const location = stubLocation()
    vi.stubGlobal('fetch', respond({ url: 'https://idp.example.com/logout?x=1' }))

    await federatedSignOut('/login')

    expect(signOutMock).toHaveBeenCalledWith({ redirect: false })
    expect(location.href).toBe('https://idp.example.com/logout?x=1')
  })

  it('asks for the end-session URL BEFORE signing out locally', async () => {
    // The route reads the id_token out of the cookie signOut() is about to drop.
    const order: string[] = []
    stubLocation()
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => {
      order.push('fetch')
      return { ok: true, json: async () => ({ url: 'https://idp/logout' }) }
    }))
    signOutMock.mockImplementation(async () => { order.push('signOut') })

    await federatedSignOut('/login')
    expect(order).toEqual(['fetch', 'signOut'])
  })

  it('falls back to the plain local sign-out when there is nothing to end', async () => {
    const location = stubLocation()
    vi.stubGlobal('fetch', respond({ url: null }))

    await federatedSignOut('/login')

    expect(signOutMock).toHaveBeenCalledWith({ callbackUrl: '/login' })
    expect(location.href).toBe('')
  })

  it('still signs out locally when the lookup errors', async () => {
    stubLocation()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))

    await federatedSignOut('/login')
    expect(signOutMock).toHaveBeenCalledWith({ callbackUrl: '/login' })
  })

  it('still signs out locally on a non-2xx answer', async () => {
    stubLocation()
    vi.stubGlobal('fetch', respond({ url: 'https://idp/logout' }, false))

    await federatedSignOut('/login')
    expect(signOutMock).toHaveBeenCalledWith({ callbackUrl: '/login' })
  })

  it('ignores a url that is not a string rather than navigating to it', async () => {
    const location = stubLocation()
    vi.stubGlobal('fetch', respond({ url: { evil: true } }))

    await federatedSignOut('/login')
    expect(signOutMock).toHaveBeenCalledWith({ callbackUrl: '/login' })
    expect(location.href).toBe('')
  })

  it('defaults the callback to the login page', async () => {
    stubLocation()
    vi.stubGlobal('fetch', respond({ url: null }))

    await federatedSignOut()
    expect(signOutMock).toHaveBeenCalledWith({ callbackUrl: '/login' })
  })
})
