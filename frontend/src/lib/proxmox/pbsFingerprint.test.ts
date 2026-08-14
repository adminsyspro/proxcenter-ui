import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHash } from 'crypto'

const { connect } = vi.hoisted(() => ({ connect: vi.fn() }))

vi.mock('tls', () => {
  const mod = { connect: (...args: unknown[]) => connect(...args) }
  return { ...mod, default: mod }
})

import { parseHostPort, formatFingerprint, captureFingerprint } from './pbsFingerprint'

type SocketHandler = (arg?: unknown) => void

/** Stands in for the TLS socket, handing back `cert` from getPeerCertificate. */
function installSocket(cert: unknown) {
  const handlers: Record<string, SocketHandler> = {}
  const socket = {
    on(event: string, cb: SocketHandler) {
      handlers[event] = cb
      return socket
    },
    end: vi.fn(),
    destroy: vi.fn(),
    getPeerCertificate: vi.fn(() => cert),
    handlers,
  }
  connect.mockImplementation((_opts: unknown, cb: () => void) => {
    // Real tls fires secureConnect on a later tick. Calling it synchronously
    // would hit the TDZ on the `socket` const inside captureFingerprint.
    setImmediate(cb)
    return socket
  })
  return socket
}

/** Options object handed to tls.connect on the first (only) call. */
function connectOptions(): Record<string, unknown> {
  return connect.mock.calls[0][0] as Record<string, unknown>
}

describe('pbsFingerprint helpers', () => {
  it('parses https://host:port', () => {
    expect(parseHostPort('https://pbs.example:8007')).toEqual({ host: 'pbs.example', port: 8007 })
  })
  it('defaults to 8007 when port missing', () => {
    expect(parseHostPort('https://pbs.example')).toEqual({ host: 'pbs.example', port: 8007 })
  })
  it('strips path', () => {
    expect(parseHostPort('https://pbs.example:8007/api2/json')).toEqual({ host: 'pbs.example', port: 8007 })
  })
  it('throws on non-https', () => {
    expect(() => parseHostPort('http://pbs.example')).toThrow(/https required/i)
  })
  it('throws on an unparseable url', () => {
    expect(() => parseHostPort('not a url')).toThrow(/https required/i)
  })
  it('unbrackets an IPv6 literal, keeping the explicit port', () => {
    expect(parseHostPort('https://[2001:db8::1]:8007')).toEqual({ host: '2001:db8::1', port: 8007 })
  })
  it('unbrackets an IPv6 literal with no port', () => {
    expect(parseHostPort('https://[2001:db8::1]')).toEqual({ host: '2001:db8::1', port: 8007 })
  })
  it('formats raw hash as colon-separated uppercase', () => {
    const raw = 'aabbccdd'
    expect(formatFingerprint(raw)).toBe('AA:BB:CC:DD')
  })
})

describe('captureFingerprint SNI handling', () => {
  beforeEach(() => {
    connect.mockReset()
  })

  // Node 26 turned "SNI must not be an IP" from a deprecation warning into a
  // synchronous ERR_INVALID_ARG_VALUE throw, which broke every PBS declared
  // by IP the moment the image moved off node:22-alpine.
  it('omits servername for an IPv4 host', async () => {
    installSocket({ raw: Buffer.from('cert') })
    await captureFingerprint('https://10.2.250.18:8007')
    const opts = connectOptions()
    expect(opts).not.toHaveProperty('servername')
    expect(opts.host).toBe('10.2.250.18')
    expect(opts.port).toBe(8007)
  })

  it('omits servername for an IPv6 host', async () => {
    installSocket({ raw: Buffer.from('cert') })
    await captureFingerprint('https://[2001:db8::1]:8007')
    const opts = connectOptions()
    expect(opts).not.toHaveProperty('servername')
    expect(opts.host).toBe('2001:db8::1')
  })

  it('sends servername for a DNS host', async () => {
    installSocket({ raw: Buffer.from('cert') })
    await captureFingerprint('https://pbs.example')
    const opts = connectOptions()
    expect(opts.servername).toBe('pbs.example')
    expect(opts.port).toBe(8007)
  })

  it('returns the SHA256 of the leaf certificate, colon-formatted', async () => {
    const raw = Buffer.from('leaf-cert-bytes')
    const socket = installSocket({ raw })
    const expected = formatFingerprint(createHash('sha256').update(raw).digest('hex'))
    await expect(captureFingerprint('https://10.2.250.18:8007')).resolves.toBe(expected)
    expect(socket.end).toHaveBeenCalled()
  })

  it('rejects when the peer sends no certificate', async () => {
    installSocket({})
    await expect(captureFingerprint('https://10.2.250.18:8007')).rejects.toThrow(/no certificate/i)
  })
})
