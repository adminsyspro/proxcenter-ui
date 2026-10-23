/**
 * Guards of the console WebSocket proxy (frontend/ws-proxy.js): frame size
 * cap, bounded pre-auth SPICE queue, and credential redaction in the error
 * log. The proxy is plain CommonJS run under node, so it is required natively
 * rather than spun up as a server.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const nodeRequire = createRequire(import.meta.url)
const ROOT = path.resolve(__dirname, '..', '..', '..')
const WS_PROXY = path.join(ROOT, 'ws-proxy.js')

// ws-proxy.js loads the frontend .env at require time (it runs under bare
// node in production). Keep whatever it adds out of the other test files.
const ENV_BEFORE = { ...process.env }
let proxy: any

beforeAll(() => {
  proxy = nodeRequire(WS_PROXY)
})

afterAll(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ENV_BEFORE)) delete process.env[key]
  }
  Object.assign(process.env, ENV_BEFORE)
})

describe('frame size cap', () => {
  it('bounds a browser frame at 1 MiB, which a 60 MiB frame cannot pass', () => {
    expect(proxy.WS_MAX_PAYLOAD_BYTES).toBe(1024 * 1024)
    expect(60 * 1024 * 1024).toBeGreaterThan(proxy.WS_MAX_PAYLOAD_BYTES)
  })

  it('leaves room for every client-side console message, including a SPICE agent chunk', () => {
    const VD_AGENT_MAX_DATA_SIZE = 2048
    expect(proxy.WS_MAX_PAYLOAD_BYTES).toBeGreaterThan(VD_AGENT_MAX_DATA_SIZE)
    // The SPICE pre-auth queue is a stricter bound than the frame cap.
    expect(proxy.SPICE_PREAUTH_BUFFER_MAX_BYTES).toBeLessThan(proxy.WS_MAX_PAYLOAD_BYTES)
  })

  it('exports the cap start.js hands to its WebSocketServer', () => {
    const startJs = readFileSync(path.join(ROOT, 'start.js'), 'utf8')
    expect(startJs).toContain('maxPayload: WS_MAX_PAYLOAD_BYTES')
    expect(startJs).toMatch(/const \{ handleWsConnection, WS_MAX_PAYLOAD_BYTES \} = require\('\.\/ws-proxy'\)/)
  })
})

describe('frameByteLength', () => {
  it('measures Buffers, ArrayBuffers, fragment arrays and strings', () => {
    expect(proxy.frameByteLength(Buffer.alloc(10))).toBe(10)
    expect(proxy.frameByteLength(new ArrayBuffer(7))).toBe(7)
    expect(proxy.frameByteLength([Buffer.alloc(3), Buffer.alloc(4)])).toBe(7)
    expect(proxy.frameByteLength('héllo')).toBe(6)
  })
})

describe('bounded pre-auth queue', () => {
  it('queues frames under the bound and drains them in order', () => {
    const q = proxy.createBoundedQueue(100)
    expect(q.push(Buffer.from('link'))).toBe(true)
    expect(q.push(Buffer.from('mess'))).toBe(true)
    expect(q.length).toBe(2)
    expect(q.bytes).toBe(8)

    const out: string[] = []
    q.drain((f: Buffer) => out.push(f.toString()))
    expect(out).toEqual(['link', 'mess'])
    expect(q.length).toBe(0)
    expect(q.bytes).toBe(0)
  })

  it('refuses the frame that crosses the bound and drops what was queued', () => {
    const q = proxy.createBoundedQueue(10)
    expect(q.push(Buffer.alloc(6))).toBe(true)
    expect(q.push(Buffer.alloc(5))).toBe(false)
    expect(q.length).toBe(0)
  })

  it('the SPICE queue closes well before a single capped frame could fill memory', () => {
    const q = proxy.createBoundedQueue(proxy.SPICE_PREAUTH_BUFFER_MAX_BYTES)
    // A SpiceLinkMess is a few dozen bytes; a flood of 1 MiB frames is not one.
    expect(q.push(Buffer.alloc(48))).toBe(true)
    expect(q.push(Buffer.alloc(proxy.WS_MAX_PAYLOAD_BYTES))).toBe(false)
  })
})

describe('redactSession', () => {
  it('replaces every credential field, keeps the rest, and recurses', () => {
    const session = {
      host: 'pve1.lab',
      port: 5900,
      ticket: 'PVEVNC:abc',
      apiToken: 'root@pam!tok=secret-uuid',
      proxyticket: 'PVESPICE:xyz',
      ca: '-----BEGIN CERTIFICATE-----',
      insecure: false,
      nested: { password: 'pw', node: 'pve1' },
      empty: null,
    }
    expect(proxy.redactSession(session)).toEqual({
      host: 'pve1.lab',
      port: 5900,
      ticket: '***',
      apiToken: '***',
      proxyticket: '***',
      ca: '***',
      insecure: false,
      nested: { password: '***', node: 'pve1' },
      empty: null,
    })
    expect(JSON.stringify(proxy.redactSession(session))).not.toMatch(/secret-uuid|PVEVNC|PVESPICE|BEGIN CERT/)
  })

  it('matches credential keys whatever their case, and leaves a null credential null', () => {
    expect(proxy.redactSession({ ApiToken: 'x', TICKET: 'y', Token: null })).toEqual({ ApiToken: '***', TICKET: '***', Token: null })
  })

  it('describes a non-object answer instead of printing it', () => {
    expect(proxy.redactSession(null)).toBe('<null>')
    expect(proxy.redactSession('PVEVNC:leaked')).toBe('<string>')
    expect(proxy.redactSession(undefined)).toBe('<undefined>')
  })

  it('does not mutate the session it is given', () => {
    const session = { ticket: 'PVEVNC:abc', host: 'h' }
    proxy.redactSession(session)
    expect(session.ticket).toBe('PVEVNC:abc')
  })
})
