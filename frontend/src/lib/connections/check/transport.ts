// src/lib/connections/check/transport.ts
//
// Production wiring of CheckDeps: undici for the direct host probes (the
// regular client would fail over and hide a dead primary), tls for the
// certificate, pveFetch for everything the app reads the usual way, and the
// existing ssh2 helper for the SSH attempt.

import { createHash } from 'crypto'
import net from 'net'
import tls from 'tls'

import { request } from 'undici'

import { getDefaultAgent, getInsecureAgent, pveFetch } from '@/lib/proxmox/client'
import { formatFingerprint } from '@/lib/proxmox/pbsFingerprint'
import { executeSSHDirect } from '@/lib/ssh/exec'
import { normalizeSshAddress, pickNodeSshEndpoint } from '@/lib/ssh/node-endpoint-core'
import { getNodeIp } from '@/lib/ssh/node-ip'

import type { CertificateInfo, CheckContext, CheckDeps, DirectGetResult } from './types'

function parseHostPort(baseUrl: string): { host: string; port: number } {
  const url = new URL(baseUrl)
  return { host: url.hostname.replace(/^\[|\]$/g, ''), port: url.port ? Number(url.port) : 8006 }
}

export async function directGet(ctx: CheckContext, baseUrl: string, path: string, timeoutMs: number): Promise<DirectGetResult> {
  const url = `${baseUrl.replace(/\/$/, '')}/api2/json${path}`
  const res = await request(url, {
    method: 'GET',
    headers: { Authorization: `PVEAPIToken=${ctx.conn.apiToken}` },
    dispatcher: ctx.conn.insecureDev ? getInsecureAgent() : getDefaultAgent(),
    signal: AbortSignal.timeout(timeoutMs),
  })
  const text = await res.body.text()
  let data: unknown = null
  try {
    data = (JSON.parse(text) as { data?: unknown })?.data ?? null
  } catch {
    data = null
  }
  return { statusCode: res.statusCode, data }
}

/**
 * Reads the leaf certificate the host presents, accepting any chain so the
 * expiry and fingerprint of an untrusted certificate can still be reported.
 * `authorized` carries what Node's trust store thought of it.
 */
export function readCertificate(baseUrl: string, timeoutMs: number): Promise<CertificateInfo> {
  const { host, port } = parseHostPort(baseUrl)
  // SNI takes a hostname only; Node throws on an IP literal (see pbsFingerprint).
  const sni = net.isIP(host) === 0 ? { servername: host } : {}
  return new Promise<CertificateInfo>((resolve, reject) => {
    const socket = tls.connect({ host, port, ...sni, rejectUnauthorized: false, timeout: timeoutMs }, () => {
      try {
        const cert = socket.getPeerCertificate(false)
        if (!cert || !cert.raw) {
          reject(new Error('no certificate presented'))
          return
        }
        const info: CertificateInfo = {
          validFrom: cert.valid_from,
          validTo: cert.valid_to,
          fingerprint: formatFingerprint(createHash('sha256').update(cert.raw).digest('hex')),
          authorized: socket.authorized,
          authorizationError: socket.authorizationError ? String(socket.authorizationError) : undefined,
        }
        socket.end()
        resolve(info)
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)))
      }
    })
    socket.on('error', err => reject(err))
    socket.on('timeout', () => {
      socket.destroy()
      reject(new Error(`TLS handshake timeout after ${timeoutMs}ms`))
    })
  })
}

export function buildCheckDeps(ctx: CheckContext): CheckDeps {
  return {
    directGet: (baseUrl, path, timeoutMs) => directGet(ctx, baseUrl, path, timeoutMs),
    pveGet: (path, timeoutMs) => pveFetch(ctx.conn, path, {}, timeoutMs ? { timeoutMs } : {}),
    readCertificate,
    resolveSshEndpoint: async node => {
      const override = ctx.ssh.overrides.find(o => o.node === node) ?? null
      const reportedHost = normalizeSshAddress(override?.sshAddress) ? '' : await getNodeIp(ctx.conn, node, { skipOverride: true })
      const endpoint = pickNodeSshEndpoint({ reportedHost, connSshPort: ctx.ssh.port, override })
      return { host: endpoint.host, port: endpoint.port }
    },
    sshExec: opts =>
      executeSSHDirect({
        host: opts.host,
        port: opts.port,
        user: ctx.ssh.user,
        key: ctx.ssh.key,
        password: ctx.ssh.password,
        passphrase: ctx.ssh.passphrase,
        command: opts.command,
        timeoutMs: opts.timeoutMs,
      }),
    now: () => Date.now(),
  }
}
