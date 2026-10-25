import { describe, expect, it, vi } from 'vitest'

import { DnsProviderError } from '@/lib/tls/dns/types'
import { challengeRecordName, dnsHttp, quoteTxt, relativeName, unquoteTxt, zoneCandidates } from '@/lib/tls/dns/util'

describe('DNS helpers', () => {
  it('puts a wildcard and its apex on the same challenge name', () => {
    expect(challengeRecordName('*.Example.com')).toBe('_acme-challenge.example.com')
    expect(challengeRecordName('example.com.')).toBe('_acme-challenge.example.com')
  })

  it('lists zone candidates longest first and never the bare TLD', () => {
    expect(zoneCandidates('_acme-challenge.pc.lab.example.com')).toEqual([
      '_acme-challenge.pc.lab.example.com', 'pc.lab.example.com', 'lab.example.com', 'example.com',
    ])
  })

  it('makes a name relative to its zone and refuses a name outside it', () => {
    expect(relativeName('_acme-challenge.www.example.com', 'example.com')).toBe('_acme-challenge.www')
    expect(relativeName('example.com.', 'example.com')).toBe('@')
    expect(() => relativeName('_acme-challenge.example.org', 'example.com')).toThrow(DnsProviderError)
  })

  it('round-trips TXT quoting, including values split in chunks', () => {
    expect(quoteTxt('a"b')).toBe('"a\\"b"')
    expect(unquoteTxt(quoteTxt('a"b\\c'))).toBe('a"b\\c')
    expect(unquoteTxt('"abc" "def"')).toBe('abcdef')
    expect(unquoteTxt('plain')).toBe('plain')
  })
})

describe('dnsHttp', () => {
  it('parses JSON and passes the request through', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"a":1}', { status: 200 }))

    await expect(dnsHttp(fetchImpl as any, 'X', 'https://api.x/zones', { method: 'POST' })).resolves.toEqual({ status: 200, body: { a: 1 } })
    expect(fetchImpl).toHaveBeenCalledWith('https://api.x/zones', expect.objectContaining({ method: 'POST', signal: expect.any(AbortSignal) }))
  })

  it('turns a non-2xx into an operator-readable error with the start of the body', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"message":"bad token"}', { status: 403 }))

    await expect(dnsHttp(fetchImpl as any, 'X', 'https://api.x/zones')).rejects.toThrow('X: HTTP 403 on GET /zones ({"message":"bad token"})')
  })

  it('lets the caller accept a status as an answer', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 404 }))

    await expect(dnsHttp(fetchImpl as any, 'X', 'https://api.x/z', { allowStatus: [404] })).resolves.toEqual({ status: 404, body: '' })
  })

  it('reports an unreachable API by host', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('ECONNREFUSED') })

    await expect(dnsHttp(fetchImpl as any, 'X', 'https://api.x/z')).rejects.toThrow('X: api.x unreachable (ECONNREFUSED)')
  })
})
