// Target endpoint of a PVE remote_migrate: the receiving node's address and
// the SHA-256 fingerprint its pveproxy certificate must match. Shared by the
// cross-cluster migration route and the move between vDCs (#1335).

import { pveFetch } from "@/lib/proxmox/client"
import { getNodeIp } from "@/lib/ssh/node-ip"

/** `XX:XX:...` SHA-256 fingerprint, the only form that may enter the target-endpoint spec. */
const FINGERPRINT_RE = /^[0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){31}$/

/**
 * SHA-256 fingerprint of the certificate pveproxy serves on `node`, read through
 * the authenticated target API: the node's own certificate list first (pveproxy
 * serves pveproxy-ssl.pem when it exists, pve-ssl.pem otherwise), then the
 * cluster node list's pve_fp. Empty when the token can read neither.
 */
export async function fetchTargetNodeFingerprint(targetConn: any, node: string): Promise<string> {
  try {
    const certs = await pveFetch<any[]>(targetConn, `/nodes/${encodeURIComponent(node)}/certificates/info`)
    if (Array.isArray(certs)) {
      const served = certs.find((c: any) => c?.filename === 'pveproxy-ssl.pem') ?? certs.find((c: any) => c?.filename === 'pve-ssl.pem')
      if (typeof served?.fingerprint === 'string' && FINGERPRINT_RE.test(served.fingerprint)) return served.fingerprint
    }
  } catch {
    // The token may lack Sys.Audit on the node; the cluster list below needs less.
  }
  try {
    const nodes = await pveFetch<any[]>(targetConn, '/cluster/config/nodes')
    const entry = Array.isArray(nodes) ? nodes.find((n: any) => n?.name === node) : undefined
    if (typeof entry?.pve_fp === 'string' && FINGERPRINT_RE.test(entry.pve_fp)) return entry.pve_fp
  } catch {
    // Standalone node or no access: the caller falls back to the TLS capture.
  }
  return ''
}

/**
 * SHA-256 fingerprint of whatever certificate `host` presents on `port`, or ''
 * when it cannot be read. Nothing is verified here on purpose: the value is
 * cross-checked against (or, failing that, stands in for) the API's answer.
 */
export async function captureTlsFingerprint(host: string, port: number): Promise<string> {
  try {
    const tls = await import('tls')
    const captured = await new Promise<string>((resolve, reject) => {
      const socket = tls.connect({ host, port, rejectUnauthorized: false, timeout: 10000 }, () => {
        const cert = socket.getPeerCertificate()
        socket.end()
        if (cert?.fingerprint256) resolve(cert.fingerprint256)
        else reject(new Error('No certificate fingerprint available'))
      })
      socket.on('error', reject)
      socket.on('timeout', () => {
        socket.destroy()
        reject(new Error('Connection timeout'))
      })
    })
    return FINGERPRINT_RE.test(captured) ? captured : ''
  } catch (e: any) {
    console.warn('[remote-migrate] TLS fingerprint capture failed:', String(e?.message || e).replace(/[\r\n]/g, ''))
    return ''
  }
}

/** `ok` false carries `error`; `ok` true carries the endpoint (error is then ''). */
export interface RemoteEndpointResult {
  ok: boolean
  endpoint: string
  host: string
  apiFingerprint: boolean
  error: string
}

/**
 * Build the `target-endpoint` value for `node` of `targetConn`: the node's own
 * address (so the guest lands on that node), the API token, and the
 * certificate fingerprint read through the authenticated target API first. A
 * capture of the TLS handshake stands in only when the API exposes nothing,
 * and must agree with it when both exist.
 */
export async function buildRemoteMigrateEndpoint(targetConn: any, node: string): Promise<RemoteEndpointResult> {
  const targetUrl = new URL(targetConn.baseUrl)
  const targetPort = targetUrl.port || '8006'
  const targetHost = await getNodeIp(targetConn, node)

  const apiFingerprint = await fetchTargetNodeFingerprint(targetConn, node)
  const capturedFingerprint = await captureTlsFingerprint(targetHost, Number.parseInt(targetPort, 10))
  if (apiFingerprint && capturedFingerprint && apiFingerprint.toUpperCase() !== capturedFingerprint.toUpperCase()) {
    return {
      ok: false,
      endpoint: '',
      host: targetHost,
      apiFingerprint: false,
      error: `The host resolved for node "${node}" (${targetHost}) does not present the certificate the target cluster reports for that node. Check the node's address (managed host / SSH address) and its pveproxy certificate before migrating.`,
    }
  }
  const fingerprint = apiFingerprint || capturedFingerprint
  if (!fingerprint) {
    return { ok: false, endpoint: '', host: targetHost, apiFingerprint: false, error: "Could not retrieve TLS fingerprint from target cluster. Please ensure the target is reachable." }
  }

  return {
    ok: true,
    error: '',
    host: targetHost,
    apiFingerprint: !!apiFingerprint,
    endpoint: [
      `apitoken=PVEAPIToken=${targetConn.apiToken}`,
      `host=${targetHost}`,
      `port=${targetPort}`,
      `fingerprint=${fingerprint}`,
    ].join(','),
  }
}
