import { describe, it, expect, vi, afterEach } from 'vitest'
import * as dns from 'node:dns'
import type * as net from 'node:net'
import { isBlockedIp, normalizeIp, validateServerUrl, buildGuardedTransport } from './ssrf'

// ESM namespaces are not configurable, so vi.spyOn(dns, 'lookup') cannot patch
// the export ssrf.ts imports. Mock the module instead and drive lookup per test.
vi.mock('node:dns', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:dns')>()
  return { ...actual, default: { ...actual }, lookup: vi.fn() }
})

// Extract the guarded lookup that buildGuardedTransport installs on the agent.
function guardedLookup(): net.LookupFunction {
  const { agent } = buildGuardedTransport({}) as { agent: { options: { lookup: net.LookupFunction } } }
  return agent.options.lookup
}

describe('normalizeIp', () => {
  it('maps IPv4-mapped IPv6 to IPv4', () => {
    expect(normalizeIp('::ffff:127.0.0.1')).toBe('127.0.0.1')
  })
  it('lowercases plain IPv6', () => {
    expect(normalizeIp('FE80::1')).toBe('fe80::1')
  })
  it('passes plain IPv4 through unchanged', () => {
    expect(normalizeIp('10.0.0.1')).toBe('10.0.0.1')
  })
})

describe('isBlockedIp', () => {
  it.each([
    '127.0.0.1',
    '127.5.5.5',
    '0.0.0.0',
    '0.1.2.3',
    '169.254.169.254',
    '169.254.1.1',
    '255.255.255.255',
    '100.64.0.1',
    '198.18.0.5',
    '192.0.2.1',
    '198.51.100.1',
    '203.0.113.1',
    '224.0.0.1',
    '::1',
    '::',
    'fe80::1',
    'ff02::1',
    '::ffff:127.0.0.1',
    // Additional cases from task brief
    'febf::1',       // top of fe80::/10, must be blocked
    'FE80::1',       // uppercase, must be blocked after normalization
  ])('blocks %s', (ip) => {
    expect(isBlockedIp(ip)).toBe(true)
  })

  it.each([
    '10.0.0.1',
    '172.16.0.1',
    '192.168.49.2',
    '8.8.8.8',
    '1.1.1.1',
    'fc00::1',
    '2001:4860:4860::8888',
    '::ffff:8.8.8.8',
    // Additional cases from task brief
    'fdff::1',       // top of fc00::/7 ULA, must be allowed
    'fec0::1',       // outside fe80::/10, must be allowed
  ])('allows %s', (ip) => {
    expect(isBlockedIp(ip)).toBe(false)
  })
})

describe('guarded lookup all-flag handling', () => {
  afterEach(() => vi.restoreAllMocks())

  function mockResolve(addrs: dns.LookupAddress[]) {
    vi.spyOn(dns, 'lookup').mockImplementation(((_host: string, _opts: unknown, cb: (e: unknown, a: unknown) => void) => {
      cb(null, addrs)
    }) as unknown as typeof dns.lookup)
  }

  // Regression: node calls the lookup with { all: true } under autoSelectFamily
  // (Happy Eyeballs). It then expects the FULL ARRAY back. Returning a single
  // triple made node throw ERR_INVALID_IP_ADDRESS on every hostname-addressed
  // cluster (Rancher proxy URLs etc.), reported to the UI as "unreachable".
  it('returns the full address array when called with { all: true }', async () => {
    mockResolve([
      { address: '10.17.17.1', family: 4 },
      { address: '10.17.17.2', family: 4 },
    ])
    const result = await new Promise<unknown>((resolve) => {
      guardedLookup()('rke.example', { all: true } as dns.LookupAllOptions, (err, addresses) => {
        resolve(err ?? addresses)
      })
    })
    expect(result).toEqual([
      { address: '10.17.17.1', family: 4 },
      { address: '10.17.17.2', family: 4 },
    ])
  })

  it('returns a single pinned address when all is not requested', async () => {
    mockResolve([
      { address: '10.17.17.1', family: 4 },
      { address: '10.17.17.2', family: 4 },
    ])
    const result = await new Promise<{ address: unknown; family: unknown } | Error>((resolve) => {
      guardedLookup()('rke.example', {} as dns.LookupOneOptions, (err, address, family) => {
        resolve(err ?? { address, family })
      })
    })
    expect(result).toEqual({ address: '10.17.17.1', family: 4 })
  })

  it('rejects with all: true when any resolved IP is blocked', async () => {
    mockResolve([
      { address: '10.17.17.1', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ])
    const result = await new Promise<unknown>((resolve) => {
      guardedLookup()('evil.example', { all: true } as dns.LookupAllOptions, (err, addresses) => {
        resolve(err ?? addresses)
      })
    })
    expect(result).toBeInstanceOf(Error)
    expect((result as Error).message).toMatch(/blocked IP 127\.0\.0\.1/)
  })
})

describe('validateServerUrl', () => {
  it('accepts https with a host', () => { expect(validateServerUrl('https://k8s.example:6443').ok).toBe(true) })
  it('rejects http', () => { expect(validateServerUrl('http://k8s.example').ok).toBe(false) })
  it('rejects no host', () => { expect(validateServerUrl('https://').ok).toBe(false) })
  it('rejects garbage', () => { expect(validateServerUrl('not a url').ok).toBe(false) })
})
