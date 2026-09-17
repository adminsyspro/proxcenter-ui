import { execFileSync } from 'node:child_process'
import dgram from 'node:dgram'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import tls from 'node:tls'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { SyslogSender, frameMessage, sendOnce, tlsOptionsFor } from './transport'
import type { SyslogDestination } from './types'

const WAIT_MS = 2000
const OPENSSL = '/usr/bin/openssl'

function dest(overrides: Partial<SyslogDestination> = {}): SyslogDestination {
  return {
    id: 'd1',
    name: 'SIEM',
    enabled: true,
    host: '127.0.0.1',
    port: 514,
    transport: 'tcp',
    format: 'rfc5424',
    framing: 'newline',
    facility: 13,
    categories: [],
    tls: { verify: true, ca: '', serverName: '' },
    ...overrides,
  }
}

// ---- harness -----------------------------------------------------------------

function withTimeout<T>(promise: Promise<T>, label: string, ms = WAIT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms waiting for ${label}`)), ms)
    promise.then(
      value => {
        clearTimeout(timer)
        resolve(value)
      },
      err => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

function waitUntil(predicate: () => boolean, label: string, ms = WAIT_MS): Promise<void> {
  const deadline = Date.now() + ms
  return new Promise<void>((resolve, reject) => {
    const tick = () => {
      if (predicate()) return resolve()
      if (Date.now() > deadline) return reject(new Error(`timed out after ${ms} ms waiting for ${label}`))
      setTimeout(tick, 5)
    }
    tick()
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

interface TcpHarness {
  port: number
  /** Everything received on every connection, concatenated. */
  text: () => string
  /** Newline-framed lines received so far (a trailing partial line is ignored). */
  lines: () => string[]
  /** Number of client half-closes (FIN) seen. */
  ended: () => number
  close: () => Promise<void>
}

async function startTcp(): Promise<TcpHarness> {
  const chunks: Buffer[] = []
  const sockets = new Set<net.Socket>()
  let ended = 0
  const server = net.createServer(socket => {
    sockets.add(socket)
    socket.on('data', (chunk: Buffer) => chunks.push(chunk))
    socket.on('end', () => {
      ended += 1
    })
    socket.on('error', () => {})
    socket.on('close', () => sockets.delete(socket))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as net.AddressInfo).port
  const text = () => Buffer.concat(chunks).toString('utf8')
  return {
    port,
    text,
    lines: () => {
      const parts = text().split('\n')
      parts.pop() // partial (or empty) trailing segment
      return parts
    },
    ended: () => ended,
    close: async () => {
      for (const s of sockets) s.destroy()
      await new Promise<void>(resolve => server.close(() => resolve()))
    },
  }
}

interface UdpHarness {
  port: number
  next: () => Promise<Buffer>
  close: () => Promise<void>
}

async function startUdp(): Promise<UdpHarness> {
  const socket = dgram.createSocket('udp4')
  const messages: Buffer[] = []
  const waiters: Array<() => void> = []
  let cursor = 0
  socket.on('message', msg => {
    messages.push(msg)
    waiters.shift()?.()
  })
  await new Promise<void>(resolve => socket.bind(0, '127.0.0.1', resolve))
  return {
    port: socket.address().port,
    next: () =>
      withTimeout(
        new Promise<Buffer>(resolve => {
          if (messages.length > cursor) return resolve(messages[cursor++])
          waiters.push(() => resolve(messages[cursor++]))
        }),
        'a datagram',
      ),
    close: () => new Promise<void>(resolve => socket.close(() => resolve())),
  }
}

/** Bind a listener on port 0, read the port, release it: a port nobody listens on. */
async function freePort(): Promise<number> {
  const server = net.createServer()
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as net.AddressInfo).port
  await new Promise<void>(resolve => server.close(() => resolve()))
  return port
}

const senders: SyslogSender[] = []
const cleanups: Array<() => Promise<void>> = []

function track(sender: SyslogSender): SyslogSender {
  senders.push(sender)
  return sender
}

afterEach(async () => {
  for (const s of senders.splice(0)) s.close()
  for (const c of cleanups.splice(0)) await c()
})

// ---- pure helpers -------------------------------------------------------------

describe('frameMessage', () => {
  it('udp: the raw UTF-8 bytes, no framing', () => {
    const frame = frameMessage(dest({ transport: 'udp' }), 'héllo')
    expect(frame.equals(Buffer.from('héllo', 'utf8'))).toBe(true)
    expect(frame.length).toBe(6)
  })

  it('tcp newline: the message followed by LF', () => {
    expect(frameMessage(dest({ transport: 'tcp', framing: 'newline' }), 'héllo').toString('utf8')).toBe('héllo\n')
  })

  it('octet counting: UTF-8 byte length, a space, the message', () => {
    const frame = frameMessage(dest({ transport: 'tcp', framing: 'octet-counting' }), 'héllo')
    // 5 characters but 6 bytes: the count must be the byte length
    expect('héllo'.length).toBe(5)
    expect(frame.toString('utf8')).toBe('6 héllo')
  })

  it('tls follows the same framing rules as tcp', () => {
    expect(frameMessage(dest({ transport: 'tls', framing: 'newline' }), 'x').toString()).toBe('x\n')
    expect(frameMessage(dest({ transport: 'tls', framing: 'octet-counting' }), 'x').toString()).toBe('1 x')
  })
})

describe('tlsOptionsFor', () => {
  it('uses the host as SNI when it is a name', () => {
    const opts = tlsOptionsFor(dest({ transport: 'tls', host: 'siem.example.org', port: 6514 }))
    expect(opts.servername).toBe('siem.example.org')
    expect(opts.host).toBe('siem.example.org')
    expect(opts.port).toBe(6514)
  })

  it('leaves SNI undefined when the host is an IP', () => {
    expect(tlsOptionsFor(dest({ transport: 'tls', host: '10.0.0.5' })).servername).toBeUndefined()
    expect(tlsOptionsFor(dest({ transport: 'tls', host: '::1' })).servername).toBeUndefined()
  })

  it('honours tls.serverName over the host', () => {
    const opts = tlsOptionsFor(dest({ transport: 'tls', host: '10.0.0.5', tls: { verify: true, ca: '', serverName: 'collector.internal' } }))
    expect(opts.servername).toBe('collector.internal')
  })

  it('wraps the CA in a one-element array, or leaves it undefined', () => {
    expect(tlsOptionsFor(dest({ tls: { verify: true, ca: 'PEM', serverName: '' } })).ca).toEqual(['PEM'])
    expect(tlsOptionsFor(dest({ tls: { verify: true, ca: '', serverName: '' } })).ca).toBeUndefined()
  })

  it('mirrors tls.verify into rejectUnauthorized', () => {
    expect(tlsOptionsFor(dest({ tls: { verify: true, ca: '', serverName: '' } })).rejectUnauthorized).toBe(true)
    expect(tlsOptionsFor(dest({ tls: { verify: false, ca: '', serverName: '' } })).rejectUnauthorized).toBe(false)
  })
})

// ---- SyslogSender, UDP --------------------------------------------------------

describe('SyslogSender over UDP', () => {
  it('delivers the datagram and counts it as sent', async () => {
    const udp = await startUdp()
    cleanups.push(udp.close)
    const sender = track(new SyslogSender(dest({ transport: 'udp', port: udp.port })))

    sender.send('hello udp')

    expect((await udp.next()).toString('utf8')).toBe('hello udp')
    await waitUntil(() => sender.status.sent === 1, 'status.sent === 1')
    expect(sender.status.failed).toBe(0)
    expect(sender.status.dropped).toBe(0)
    expect(sender.status.lastSentAt).not.toBeNull()
    // UDP: "connected" only means a socket exists
    expect(sender.status.connected).toBe(true)
  })

  it('truncates a payload above udpMaxBytes to that many bytes', async () => {
    const udp = await startUdp()
    cleanups.push(udp.close)
    const sender = track(new SyslogSender(dest({ transport: 'udp', port: udp.port }), { udpMaxBytes: 64 }))

    sender.send('x'.repeat(200))

    const got = await udp.next()
    expect(got.length).toBe(64)
    expect(got.toString('utf8')).toBe('x'.repeat(64))
    await waitUntil(() => sender.status.sent === 1, 'status.sent === 1')
  })
})

// ---- SyslogSender, TCP --------------------------------------------------------

describe('SyslogSender over TCP', () => {
  it('queues lines sent before the connection is up and flushes them in order', async () => {
    const tcp = await startTcp()
    cleanups.push(tcp.close)
    const sender = track(new SyslogSender(dest({ transport: 'tcp', port: tcp.port })))

    sender.send('first')
    sender.send('second')
    expect(sender.status.connected).toBe(false)

    await waitUntil(() => tcp.lines().length >= 2, 'two lines on the server')
    expect(tcp.lines()).toEqual(['first', 'second'])
    await waitUntil(() => sender.status.sent === 2, 'status.sent === 2')
    expect(sender.status.connected).toBe(true)
    expect(sender.status.dropped).toBe(0)
    expect(sender.status.failed).toBe(0)
  })

  it('writes straight to the socket once connected', async () => {
    const tcp = await startTcp()
    cleanups.push(tcp.close)
    const sender = track(new SyslogSender(dest({ transport: 'tcp', port: tcp.port })))

    sender.send('warm-up')
    await waitUntil(() => sender.status.connected, 'connection')
    sender.send('direct')

    await waitUntil(() => tcp.lines().length >= 2, 'two lines on the server')
    expect(tcp.lines()).toEqual(['warm-up', 'direct'])
  })

  it('close() drops the connection and turns send() into a no-op', async () => {
    const tcp = await startTcp()
    cleanups.push(tcp.close)
    const sender = track(new SyslogSender(dest({ transport: 'tcp', port: tcp.port })))

    sender.send('before close')
    await waitUntil(() => tcp.lines().length >= 1, 'one line on the server')
    // the write callback (which bumps the counter) is not ordered before the
    // server's 'data' event, and close() would cancel a still-pending one
    await waitUntil(() => sender.status.sent === 1, 'status.sent === 1')

    sender.close()
    expect(sender.status.connected).toBe(false)
    sender.send('after close')
    await sleep(50)

    expect(tcp.lines()).toEqual(['before close'])
    expect(sender.status.sent).toBe(1)
    expect(sender.status.dropped).toBe(0)
  })

  it('octet counting frames parse back as "len SP msg"', async () => {
    const tcp = await startTcp()
    cleanups.push(tcp.close)
    const sender = track(new SyslogSender(dest({ transport: 'tcp', framing: 'octet-counting', port: tcp.port })))
    const msg = 'héllo wörld'
    const expectedLen = Buffer.byteLength(msg, 'utf8')

    sender.send(msg)

    await waitUntil(() => Buffer.byteLength(tcp.text(), 'utf8') >= expectedLen + String(expectedLen).length + 1, 'the frame')
    const match = /^(\d+) ([\s\S]*)$/.exec(tcp.text())
    expect(match).not.toBeNull()
    expect(Number(match![1])).toBe(expectedLen)
    expect(match![2]).toBe(msg)
    expect(Buffer.byteLength(match![2], 'utf8')).toBe(Number(match![1]))
  })

  it('keeps a bounded queue while unreachable and records the connection error', async () => {
    const port = await freePort()
    const sender = track(
      new SyslogSender(dest({ transport: 'tcp', port }), {
        maxQueue: 2,
        reconnectMinMs: 10,
        reconnectMaxMs: 20,
        connectTimeoutMs: 200,
      }),
    )

    sender.send('one')
    sender.send('two')
    sender.send('three')

    // the overflow is counted synchronously, before any network event
    expect(sender.status.dropped).toBe(1)

    await waitUntil(() => sender.status.failed >= 1, 'a connection failure')
    expect(sender.status.connected).toBe(false)
    expect(sender.status.sent).toBe(0)
    expect(sender.status.lastError).toMatch(/ECONNREFUSED/)
    expect(sender.status.lastErrorAt).not.toBeNull()
  })

  it('reconnects with backoff and delivers the queued lines once a listener appears', async () => {
    const port = await freePort()
    const sender = track(
      new SyslogSender(dest({ transport: 'tcp', port }), {
        maxQueue: 10,
        reconnectMinMs: 10,
        reconnectMaxMs: 20,
        connectTimeoutMs: 200,
      }),
    )

    sender.send('queued while down')
    await waitUntil(() => sender.status.failed >= 1, 'first refused connection')

    // bring a server up on that very port
    const chunks: Buffer[] = []
    const sockets = new Set<net.Socket>()
    const server = net.createServer(socket => {
      sockets.add(socket)
      socket.on('data', (c: Buffer) => chunks.push(c))
      socket.on('error', () => {})
    })
    await new Promise<void>(resolve => server.listen(port, '127.0.0.1', resolve))
    cleanups.push(async () => {
      for (const s of sockets) s.destroy()
      await new Promise<void>(resolve => server.close(() => resolve()))
    })

    await waitUntil(() => Buffer.concat(chunks).toString('utf8').includes('queued while down\n'), 'the queued line')
    await waitUntil(() => sender.status.sent === 1, 'status.sent === 1')
    expect(sender.status.connected).toBe(true)
    expect(sender.status.dropped).toBe(0)
  })
})

// ---- sendOnce -----------------------------------------------------------------

describe('sendOnce', () => {
  it('tcp: delivers the framed line and half-closes the socket', async () => {
    const tcp = await startTcp()
    cleanups.push(tcp.close)

    const result = await sendOnce(dest({ transport: 'tcp', port: tcp.port }), 'ping')

    expect(result).toEqual({ ok: true })
    await waitUntil(() => tcp.text() === 'ping\n', 'the line')
    await waitUntil(() => tcp.ended() === 1, 'the client FIN')
    expect(tcp.ended()).toBe(1)
  })

  it('tcp: reports ECONNREFUSED on a closed port', async () => {
    const port = await freePort()

    const result = await sendOnce(dest({ transport: 'tcp', port }), 'ping')

    expect(result).toEqual({ ok: false, error: expect.stringMatching(/ECONNREFUSED/) })
  })

  it('tcp: with a 1 ms budget it settles either ok or with a timeout, never hangs', async () => {
    const tcp = await startTcp()
    cleanups.push(tcp.close)

    const result = await withTimeout(sendOnce(dest({ transport: 'tcp', port: tcp.port }), 'ping', 1), 'sendOnce to settle')

    expect([{ ok: true }, { ok: false, error: 'timed out after 1 ms' }]).toContainEqual(result)
  })

  it('udp: resolves ok once the datagram left, and the datagram arrives', async () => {
    const udp = await startUdp()
    cleanups.push(udp.close)

    const result = await sendOnce(dest({ transport: 'udp', port: udp.port }), 'ping udp')

    expect(result).toEqual({ ok: true })
    expect((await udp.next()).toString('utf8')).toBe('ping udp')
  })
})

// ---- TLS ----------------------------------------------------------------------

describe.skipIf(!fs.existsSync(OPENSSL))('sendOnce over TLS', () => {
  let dir = ''
  let cert = ''
  let port = 0
  let server: tls.Server | null = null
  const received: string[] = []
  const sockets = new Set<tls.TLSSocket>()

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pxc-syslog-'))
    const keyPath = path.join(dir, 'key.pem')
    const certPath = path.join(dir, 'cert.pem')
    execFileSync(
      OPENSSL,
      [
        'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
        '-keyout', keyPath, '-out', certPath, '-days', '2',
        '-subj', '/CN=localhost',
        '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1',
      ],
      { stdio: 'ignore' },
    )
    cert = fs.readFileSync(certPath, 'utf8')
    server = tls.createServer({ key: fs.readFileSync(keyPath), cert }, socket => {
      sockets.add(socket)
      socket.on('data', chunk => received.push(chunk.toString('utf8')))
      socket.on('close', () => sockets.delete(socket))
    })
    // a client that rejects our certificate is an expected outcome in one test below
    server.on('tlsClientError', () => {})
    const srv = server
    await new Promise<void>(resolve => srv.listen(0, '127.0.0.1', resolve))
    port = (srv.address() as net.AddressInfo).port
  })

  afterAll(async () => {
    for (const s of sockets) s.destroy()
    const srv = server
    if (srv) await new Promise<void>(resolve => srv.close(() => resolve()))
    if (dir) fs.rmSync(dir, { recursive: true, force: true })
  })

  it('verifies the server against the given CA and delivers an octet-counted line', async () => {
    const message = 'secure hello'
    const result = await sendOnce(
      dest({
        transport: 'tls',
        host: 'localhost',
        port,
        framing: 'octet-counting',
        tls: { verify: true, ca: cert, serverName: '' },
      }),
      message,
    )

    expect(result).toEqual({ ok: true })
    await waitUntil(() => received.join('').includes(`${Buffer.byteLength(message)} ${message}`), 'the TLS frame')
    expect(received.join('')).toContain('12 secure hello')
  })

  it('rejects a self-signed server when verify is on and no CA is given', async () => {
    const result = await sendOnce(
      dest({
        transport: 'tls',
        host: 'localhost',
        port,
        framing: 'octet-counting',
        tls: { verify: true, ca: '', serverName: '' },
      }),
      'should not arrive',
    )

    expect(result).toEqual({ ok: false, error: expect.stringMatching(/self-signed|certificate/i) })
    expect(received.join('')).not.toContain('should not arrive')
  })

  it('accepts the self-signed server when verify is off', async () => {
    const message = 'trust me'
    const result = await sendOnce(
      dest({
        transport: 'tls',
        host: 'localhost',
        port,
        framing: 'octet-counting',
        tls: { verify: false, ca: '', serverName: '' },
      }),
      message,
    )

    expect(result).toEqual({ ok: true })
    await waitUntil(() => received.join('').includes(`8 ${message}`), 'the unverified TLS frame')
    expect(received.join('')).toContain('8 trust me')
  })
})
