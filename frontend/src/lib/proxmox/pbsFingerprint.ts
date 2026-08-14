import net from 'net'
import tls from 'tls'
import { createHash } from 'crypto'

/**
 * Splits an https base URL into the host to dial and its port. IPv6 literals
 * come back unbracketed (`2001:db8::1`, not `[2001:db8::1]`) because both
 * `net.isIP()` and `tls.connect({ host })` expect the bare address.
 */
export function parseHostPort(baseUrl: string): { host: string; port: number } {
  let url: URL
  try {
    url = new URL(baseUrl)
  } catch {
    throw new Error(`Invalid PBS baseUrl (https required): ${baseUrl}`)
  }
  if (url.protocol !== 'https:' || !url.hostname) {
    throw new Error(`Invalid PBS baseUrl (https required): ${baseUrl}`)
  }
  return { host: url.hostname.replace(/^\[|\]$/g, ''), port: url.port ? Number(url.port) : 8007 }
}

export function formatFingerprint(hex: string): string {
  return hex.toUpperCase().match(/.{1,2}/g)!.join(':')
}

/**
 * Opens a TLS handshake to the PBS host, reads the leaf certificate,
 * returns the SHA256 fingerprint formatted `AA:BB:...`. Accepts self-signed.
 * Throws on connection failure or missing cert.
 */
export async function captureFingerprint(baseUrl: string, timeoutMs = 5000): Promise<string> {
  const { host, port } = parseHostPort(baseUrl)
  // SNI carries a hostname only: RFC 6066 forbids IP literals, and Node 26
  // turned the long-standing deprecation warning into a hard synchronous
  // throw (ERR_INVALID_ARG_VALUE) inside tls.connect. PBS is very commonly
  // declared by IP, so omit servername entirely there rather than let the
  // capture die before the handshake even starts.
  const sni = net.isIP(host) === 0 ? { servername: host } : {}
  return await new Promise<string>((resolve, reject) => {
    const socket = tls.connect({
      host,
      port,
      ...sni,
      rejectUnauthorized: false,
      timeout: timeoutMs,
    }, () => {
      try {
        const cert = socket.getPeerCertificate(false)
        if (!cert || !cert.raw) {
          reject(new Error('PBS returned no certificate'))
          return
        }
        const hash = createHash('sha256').update(cert.raw).digest('hex')
        socket.end()
        resolve(formatFingerprint(hash))
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)))
      }
    })
    socket.on('error', err => reject(err))
    socket.on('timeout', () => {
      socket.destroy()
      reject(new Error(`PBS fingerprint capture timeout after ${timeoutMs}ms`))
    })
  })
}
