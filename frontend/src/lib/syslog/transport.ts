// src/lib/syslog/transport.ts
//
// One sender per destination. The contract that matters to callers:
// `send()` never throws and never blocks the audit write that triggered it.
// Stream transports keep a bounded queue while (re)connecting and drop the
// oldest lines when it overflows, counting the drops so the UI can show them.
//
// UDP has no delivery signal at all: a "sent" counter there only means the
// datagram left this host.

import dgram from 'node:dgram'
import net from 'node:net'
import tls from 'node:tls'

import { emptySyslogStatus, type SyslogDestination, type SyslogDestinationStatus } from './types'

export interface SenderOptions {
  /** Lines kept while a stream transport is not connected. */
  maxQueue: number
  /** Bytes Node may buffer on an open socket before we start dropping. */
  maxBufferedBytes: number
  connectTimeoutMs: number
  reconnectMinMs: number
  reconnectMaxMs: number
  /** Datagram payload cap; RFC 5426 receivers must accept at least 480 octets, most take 8 KiB. */
  udpMaxBytes: number
}

export const DEFAULT_SENDER_OPTIONS: SenderOptions = {
  maxQueue: 1000,
  maxBufferedBytes: 1024 * 1024,
  connectTimeoutMs: 10_000,
  reconnectMinMs: 1_000,
  reconnectMaxMs: 30_000,
  udpMaxBytes: 8192,
}

export function frameMessage(dest: SyslogDestination, message: string): Buffer {
  const body = Buffer.from(message, 'utf8')
  if (dest.transport === 'udp') return body
  if (dest.framing === 'octet-counting') {
    return Buffer.concat([Buffer.from(`${body.length} `, 'ascii'), body])
  }
  return Buffer.concat([body, Buffer.from('\n', 'ascii')])
}

function errorText(err: unknown): string {
  if (err instanceof Error) return err.message || err.name
  return String(err)
}

export function tlsOptionsFor(dest: SyslogDestination): tls.ConnectionOptions {
  const servername = dest.tls.serverName || (net.isIP(dest.host) ? undefined : dest.host)
  return {
    host: dest.host,
    port: dest.port,
    servername,
    rejectUnauthorized: dest.tls.verify,
    ca: dest.tls.ca ? [dest.tls.ca] : undefined,
  }
}

export class SyslogSender {
  readonly dest: SyslogDestination
  readonly status: SyslogDestinationStatus = emptySyslogStatus()

  private readonly opts: SenderOptions
  private udp: dgram.Socket | null = null
  private stream: net.Socket | null = null
  private connecting = false
  private closed = false
  private queue: Buffer[] = []
  private reconnectTimer: NodeJS.Timeout | null = null
  private backoffMs: number

  constructor(dest: SyslogDestination, opts: Partial<SenderOptions> = {}) {
    this.dest = dest
    this.opts = { ...DEFAULT_SENDER_OPTIONS, ...opts }
    this.backoffMs = this.opts.reconnectMinMs
  }

  /** Enqueue one rendered line. Never throws, never returns a promise. */
  send(message: string): void {
    if (this.closed) return
    try {
      if (this.dest.transport === 'udp') {
        this.sendUdp(message)
      } else {
        this.sendStream(frameMessage(this.dest, message))
      }
    } catch (err) {
      this.recordFailure(err)
    }
  }

  close(): void {
    this.closed = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.queue = []
    if (this.udp) {
      try {
        this.udp.close()
      } catch {
        // already closed
      }
      this.udp = null
    }
    if (this.stream) {
      this.stream.destroy()
      this.stream = null
    }
    this.status.connected = false
  }

  // ---- UDP -----------------------------------------------------------------

  private sendUdp(message: string): void {
    let payload = Buffer.from(message, 'utf8')
    if (payload.length > this.opts.udpMaxBytes) payload = payload.subarray(0, this.opts.udpMaxBytes)
    const socket = this.udpSocket()
    socket.send(payload, 0, payload.length, this.dest.port, this.dest.host, err => {
      if (err) this.recordFailure(err)
      else this.recordSent()
    })
  }

  private udpSocket(): dgram.Socket {
    if (this.udp) return this.udp
    const type = net.isIPv6(this.dest.host) ? 'udp6' : 'udp4'
    const socket = dgram.createSocket(type)
    socket.unref()
    socket.on('error', err => {
      this.recordFailure(err)
      // A dead datagram socket is replaced on the next send.
      if (this.udp === socket) this.udp = null
      try {
        socket.close()
      } catch {
        // ignore
      }
    })
    this.udp = socket
    this.status.connected = true
    return socket
  }

  // ---- TCP / TLS -----------------------------------------------------------

  private sendStream(frame: Buffer): void {
    const socket = this.stream
    if (socket && this.status.connected) {
      if (socket.writableLength > this.opts.maxBufferedBytes) {
        this.status.dropped += 1
        return
      }
      socket.write(frame, err => {
        if (err) this.recordFailure(err)
        else this.recordSent()
      })
      return
    }
    this.enqueue(frame)
    this.ensureConnection()
  }

  private enqueue(frame: Buffer): void {
    this.queue.push(frame)
    while (this.queue.length > this.opts.maxQueue) {
      this.queue.shift()
      this.status.dropped += 1
    }
  }

  private ensureConnection(): void {
    if (this.closed || this.connecting || this.status.connected) return
    if (this.reconnectTimer) return
    this.connecting = true

    let socket: net.Socket
    try {
      socket =
        this.dest.transport === 'tls'
          ? tls.connect(tlsOptionsFor(this.dest))
          : net.connect({ host: this.dest.host, port: this.dest.port })
    } catch (err) {
      this.connecting = false
      this.recordFailure(err)
      this.scheduleReconnect()
      return
    }

    this.stream = socket
    socket.unref()
    socket.setTimeout(this.opts.connectTimeoutMs)
    socket.setKeepAlive(true, 30_000)

    const onReady = () => {
      if (this.stream !== socket) return
      socket.setTimeout(0)
      this.connecting = false
      this.status.connected = true
      this.backoffMs = this.opts.reconnectMinMs
      this.flush(socket)
    }
    socket.once(this.dest.transport === 'tls' ? 'secureConnect' : 'connect', onReady)
    socket.on('timeout', () => {
      if (!this.status.connected) socket.destroy(new Error('connection timed out'))
    })
    socket.on('error', err => {
      if (this.stream === socket) this.recordFailure(err)
    })
    socket.on('close', () => {
      if (this.stream !== socket) return
      this.stream = null
      this.connecting = false
      this.status.connected = false
      if (!this.closed && this.queue.length > 0) this.scheduleReconnect()
    })
  }

  private flush(socket: net.Socket): void {
    while (this.queue.length > 0 && this.stream === socket && this.status.connected) {
      const frame = this.queue.shift() as Buffer
      socket.write(frame, err => {
        if (err) this.recordFailure(err)
        else this.recordSent()
      })
    }
  }

  private scheduleReconnect(): void {
    if (this.closed || this.reconnectTimer) return
    const delay = this.backoffMs
    this.backoffMs = Math.min(this.backoffMs * 2, this.opts.reconnectMaxMs)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.ensureConnection()
    }, delay)
    this.reconnectTimer.unref()
  }

  // ---- counters ------------------------------------------------------------

  private recordSent(): void {
    this.status.sent += 1
    this.status.lastSentAt = new Date().toISOString()
  }

  private recordFailure(err: unknown): void {
    this.status.failed += 1
    this.status.lastError = errorText(err)
    this.status.lastErrorAt = new Date().toISOString()
  }
}

export type SendOnceResult = { ok: true } | { ok: false; error: string }

/**
 * Deliver a single line on a throw-away connection and report the outcome,
 * for the "Test" button. Stream transports confirm the write reached the
 * kernel buffer of an established (and for TLS, verified) connection; UDP
 * only confirms the datagram left this host.
 */
export function sendOnce(dest: SyslogDestination, message: string, timeoutMs = 5000): Promise<SendOnceResult> {
  return new Promise(resolve => {
    let settled = false
    const finish = (result: SendOnceResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    const timer = setTimeout(() => {
      finish({ ok: false, error: `timed out after ${timeoutMs} ms` })
      cleanup()
    }, timeoutMs)
    let cleanup = () => {}

    if (dest.transport === 'udp') {
      const type = net.isIPv6(dest.host) ? 'udp6' : 'udp4'
      const socket = dgram.createSocket(type)
      cleanup = () => {
        try {
          socket.close()
        } catch {
          // ignore
        }
      }
      socket.on('error', err => {
        finish({ ok: false, error: errorText(err) })
        cleanup()
      })
      const payload = Buffer.from(message, 'utf8')
      socket.send(payload, 0, payload.length, dest.port, dest.host, err => {
        if (err) finish({ ok: false, error: errorText(err) })
        else finish({ ok: true })
        cleanup()
      })
      return
    }

    let socket: net.Socket
    try {
      socket = dest.transport === 'tls' ? tls.connect(tlsOptionsFor(dest)) : net.connect({ host: dest.host, port: dest.port })
    } catch (err) {
      finish({ ok: false, error: errorText(err) })
      return
    }
    cleanup = () => socket.destroy()
    socket.once(dest.transport === 'tls' ? 'secureConnect' : 'connect', () => {
      socket.write(frameMessage(dest, message), err => {
        if (err) {
          finish({ ok: false, error: errorText(err) })
          cleanup()
          return
        }
        socket.end(() => {
          finish({ ok: true })
          cleanup()
        })
      })
    })
    socket.on('error', err => {
      finish({ ok: false, error: errorText(err) })
      cleanup()
    })
  })
}
