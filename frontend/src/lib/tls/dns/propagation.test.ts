import { describe, expect, it, vi } from 'vitest'

import { type DnsLookup, waitForTxtPropagation } from '@/lib/tls/dns/propagation'

function errorWithCode(code: string) {
  return Object.assign(new Error(code), { code })
}

/** A zone `example.com` served by ns1/ns2, each answering from its own table. */
function fakeLookup(tables: Record<string, () => string[]>, extra: Partial<DnsLookup> = {}): DnsLookup {
  return {
    cname: vi.fn(async () => { throw errorWithCode('ENODATA') }),
    ns: vi.fn(async (name: string) => {
      if (name === 'example.com') return ['ns1.example.net', 'ns2.example.net']
      throw errorWithCode('ENODATA')
    }),
    addresses: vi.fn(async (host: string) => [host === 'ns1.example.net' ? '192.0.2.1' : '192.0.2.2']),
    txtAt: vi.fn(async (server: string) => tables[server]()),
    ...extra,
  }
}

const noSleep = async () => {}

describe('waitForTxtPropagation', () => {
  it('asks the authoritative servers of the closest zone, not the system resolver', async () => {
    const lookup = fakeLookup({ '192.0.2.1': () => ['v'], '192.0.2.2': () => ['other', 'v'] })

    await expect(waitForTxtPropagation('_acme-challenge.www.example.com', 'v', { lookup, sleep: noSleep })).resolves.toBe('confirmed')
    expect(lookup.ns).toHaveBeenCalledWith('_acme-challenge.www.example.com')
    expect(lookup.ns).toHaveBeenCalledWith('example.com')
    expect(lookup.txtAt).toHaveBeenCalledWith('192.0.2.2', '_acme-challenge.www.example.com')
  })

  it('keeps polling until every server serves the value', async () => {
    let calls = 0
    const lookup = fakeLookup({
      '192.0.2.1': () => ['v'],
      '192.0.2.2': () => (++calls < 3 ? [] : ['v']),
    })
    const sleep = vi.fn(noSleep)

    await expect(waitForTxtPropagation('_acme-challenge.example.com', 'v', { lookup, sleep })).resolves.toBe('confirmed')
    expect(sleep).toHaveBeenCalledTimes(2)
  })

  it('names the lagging servers when the timeout runs out', async () => {
    const lookup = fakeLookup({ '192.0.2.1': () => ['v'], '192.0.2.2': () => { throw errorWithCode('ENODATA') } })

    await expect(
      waitForTxtPropagation('_acme-challenge.example.com', 'v', { lookup, sleep: noSleep, timeoutMs: 0 }),
    ).rejects.toThrow(/missing on ns2\.example\.net/)
  })

  it('follows a CNAME delegation (acme-dns) to the name the CA will actually read', async () => {
    const lookup = fakeLookup(
      { '192.0.2.1': () => ['v'], '192.0.2.2': () => ['v'] },
      {
        cname: vi.fn(async (name: string) => {
          if (name === '_acme-challenge.pc.corp.lan') return ['abc.example.com.']
          throw errorWithCode('ENODATA')
        }),
      },
    )

    await expect(waitForTxtPropagation('_acme-challenge.pc.corp.lan', 'v', { lookup, sleep: noSleep })).resolves.toBe('confirmed')
    expect(lookup.txtAt).toHaveBeenCalledWith('192.0.2.1', 'abc.example.com')
  })

  it('gives up checking, without failing, when port 53 is filtered on the way out', async () => {
    const lookup = fakeLookup({
      '192.0.2.1': () => { throw errorWithCode('ETIMEOUT') },
      '192.0.2.2': () => { throw errorWithCode('ECONNREFUSED') },
    })

    await expect(waitForTxtPropagation('_acme-challenge.example.com', 'v', { lookup, sleep: noSleep })).resolves.toBe('unverifiable')
  })

  it('is unverifiable when no NS can be found at all', async () => {
    const lookup = fakeLookup({}, { ns: vi.fn(async () => { throw errorWithCode('ETIMEOUT') }) })

    await expect(waitForTxtPropagation('_acme-challenge.example.com', 'v', { lookup, sleep: noSleep })).resolves.toBe('unverifiable')
  })
})
