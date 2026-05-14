import tls from 'tls'
import { createHash } from 'crypto'

export function parseHostPort(baseUrl: string): { host: string; port: number } {
  const m = baseUrl.match(/^https:\/\/([^/:?#]+)(?::(\d+))?/i)

  if (!m) throw new Error(`Invalid PBS baseUrl (https required): ${baseUrl}`)

return { host: m[1], port: m[2] ? Number(m[2]) : 8007 }
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


return await new Promise<string>((resolve, reject) => {
    const socket = tls.connect({
      host,
      port,
      servername: host,
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
