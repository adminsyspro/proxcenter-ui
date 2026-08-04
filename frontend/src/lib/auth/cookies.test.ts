import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import {
  envPrefersSecureCookies,
  sessionCookieName,
  csrfCookieName,
  callbackUrlCookieName,
  requestPrefersSecure,
  resolveCookieSecure,
} from './cookies'

const ORIGINAL = process.env.NEXTAUTH_URL

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.NEXTAUTH_URL
  else process.env.NEXTAUTH_URL = ORIGINAL
})

describe('cookie names follow NEXTAUTH_URL and never vary per request', () => {
  it('uses unprefixed names on an http NEXTAUTH_URL', () => {
    process.env.NEXTAUTH_URL = 'http://192.168.1.151:3000'
    expect(envPrefersSecureCookies()).toBe(false)
    expect(sessionCookieName()).toBe('next-auth.session-token')
    expect(callbackUrlCookieName()).toBe('next-auth.callback-url')
    expect(csrfCookieName()).toBe('next-auth.csrf-token')
  })

  it('uses prefixed names on an https NEXTAUTH_URL', () => {
    process.env.NEXTAUTH_URL = 'https://proxcenter.example.com'
    expect(envPrefersSecureCookies()).toBe(true)
    expect(sessionCookieName()).toBe('__Secure-next-auth.session-token')
    expect(callbackUrlCookieName()).toBe('__Secure-next-auth.callback-url')
    expect(csrfCookieName()).toBe('__Host-next-auth.csrf-token')
  })

  it('treats a missing NEXTAUTH_URL as not secure', () => {
    delete process.env.NEXTAUTH_URL
    expect(envPrefersSecureCookies()).toBe(false)
    expect(sessionCookieName()).toBe('next-auth.session-token')
  })
})

describe('requestPrefersSecure reads the forwarded protocol', () => {
  it('accepts a single https hop', () => {
    expect(requestPrefersSecure(new Headers({ 'x-forwarded-proto': 'https' }))).toBe(true)
  })

  it('reads only the FIRST hop of a multi-hop header', () => {
    // nginx -> another proxy: the client-facing hop is the one that matters.
    expect(requestPrefersSecure(new Headers({ 'x-forwarded-proto': 'https, http' }))).toBe(true)
    expect(requestPrefersSecure(new Headers({ 'x-forwarded-proto': 'http, https' }))).toBe(false)
  })

  it('tolerates whitespace and case', () => {
    expect(requestPrefersSecure(new Headers({ 'x-forwarded-proto': '  HTTPS ' }))).toBe(true)
  })

  it('falls back to x-forwarded-ssl and returns false with no headers', () => {
    expect(requestPrefersSecure(new Headers({ 'x-forwarded-ssl': 'on' }))).toBe(true)
    expect(requestPrefersSecure(new Headers())).toBe(false)
    expect(requestPrefersSecure(null)).toBe(false)
    expect(requestPrefersSecure(undefined)).toBe(false)
  })
})

describe('resolveCookieSecure is a monotonic OR: it can only ADD the flag', () => {
  it.each([
    ['http://h:3000', 'http', false],
    ['http://h:3000', 'https', true],
    ['https://h', 'http', true],
    ['https://h', 'https', true],
  ])('NEXTAUTH_URL=%s + forwarded=%s -> %s', (url, proto, expected) => {
    process.env.NEXTAUTH_URL = url
    expect(resolveCookieSecure(new Headers({ 'x-forwarded-proto': proto }))).toBe(expected)
  })

  it('never drops the flag an https NEXTAUTH_URL already grants, even with no headers', () => {
    process.env.NEXTAUTH_URL = 'https://h'
    expect(resolveCookieSecure(null)).toBe(true)
  })
})
