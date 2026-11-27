// TRANSPORT BACKEND NOTE (Task 1 spike finding, pinned for the whole k8s effort):
//
// The pinned client @kubernetes/client-node@1.4.0 is NODE-FETCH (v2) based, not
// undici / native fetch. Its dependencies include "node-fetch": "^2.7.0", and
// every request module (config.js, health.js, log.js, metrics.js, watch.js)
// does `import fetch from 'node-fetch'`. For HTTPS clusters the client builds a
// Node `https.Agent` (config.js -> createAgent) carrying ca/cert/key/servername/
// rejectUnauthorized, and passes it to node-fetch as the `agent` request option.
//
// THEREFORE the correct injection mechanism is a Node `https.Agent` carrying the
// TLS options (cluster CA / client cert / servername / rejectUnauthorized) PLUS
// two SSRF chokepoints on the SAME real dial:
//   - a custom `lookup` that resolves the host, rejects blocked IPs, and pins
//     the validated address (fires for HOSTNAME targets), and
//   - a custom `createConnection` that validates LITERAL-IP targets, because
//     node bypasses `lookup` entirely when the host is already an IP (a very
//     common k8s API server form, e.g. https://10.0.0.1:6443). This gap was
//     caught by the HARD GATE block test: a lookup-only guard let literal IPs
//     dial straight through.
// We return `{ agent }`. (Were the backend undici/native fetch, a Node https.Agent would
// be ignored and we would instead return `{ dispatcher }` built from an
// undici.Agent with a guarded `connect`; that branch is intentionally absent
// because the pinned client does not use it. Re-verify this note if the client
// is upgraded past 1.4.0.)
//
// RE-VERIFY ON UPGRADE: in addition to the fetch/dispatcher question above, also
// re-verify the createAgent private-method injection point in client.ts. That
// file monkey-patches `(kc as any).createAgent = () => agent` on each KubeConfig
// instance so our guarded agent is returned instead of a vanilla https.Agent.
// If a future version of @kubernetes/client-node renames, removes, or restructures
// this method, the hasAgentSeam() guard in client.ts will catch it (returning
// { ok: false } instead of building a client), but the injection approach may
// need a replacement. Search client.ts for "createAgent" when bumping the dep.
//
// ENCODING: buildGuardedTransport takes caData/certData/keyData as RAW PEM and
// hands them straight to the https.Agent (Node TLS accepts raw PEM). Note for
// Task 6: the client's own KubeConfig loader (bufferFromFileOrString) decodes
// Cluster.caData / User.certData / User.keyData as BASE64, so anything fed
// through KubeConfig.loadFromOptions must be base64, not raw PEM.

import * as https from 'node:https'
import * as dns from 'node:dns'
import * as net from 'node:net'

// --- SSRF IP policy -----------------------------------------------------------

// normalizeIp: strip IPv4-mapped IPv6 wrapper (::ffff:a.b.c.d) so the v4 checks
// apply; lowercase all other IPv6. IPv4 passes through unchanged.
export function normalizeIp(ip: string): string {
  const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip)
  return m ? m[1] : ip.toLowerCase()
}

function v4Octets(ip: string): number[] | null {
  if (net.isIP(ip) !== 4) return null
  const p = ip.split('.').map(Number)
  return p.length === 4 && p.every(n => n >= 0 && n <= 255) ? p : null
}

function inRange(o: number[], prefix: number[], bits: number): boolean {
  const v = (o[0] << 24) | (o[1] << 16) | (o[2] << 8) | o[3]
  const n = (prefix[0] << 24) | (prefix[1] << 16) | (prefix[2] << 8) | prefix[3]
  const mask = bits === 0 ? 0 : (~0 << (32 - bits))
  return (v & mask) === (n & mask)
}

// isBlockedIp: returns true for IPs that must NOT be dialed.
// Policy: ALLOW RFC1918 (10/8, 172.16/12, 192.168/16), IPv6 ULA (fc00::/7),
// public IPs. BLOCK loopback, link-local, multicast, unspecified, broadcast,
// and special ranges listed in the task spec.
// Always call with normalizeIp() output (or pass raw; this function normalizes
// internally via normalizeIp to be safe either way).
export function isBlockedIp(raw: string): boolean {
  const ip = normalizeIp(raw)
  const o = v4Octets(ip)
  if (o) {
    const blocked: [number[], number][] = [
      [[0,   0,   0,   0], 8],   // 0.0.0.0/8
      [[127, 0,   0,   0], 8],   // 127.0.0.0/8 loopback
      [[169, 254, 0,   0], 16],  // 169.254.0.0/16 link-local
      [[224, 0,   0,   0], 4],   // 224.0.0.0/4 multicast
      [[100, 64,  0,   0], 10],  // 100.64.0.0/10 carrier-grade NAT
      [[198, 18,  0,   0], 15],  // 198.18.0.0/15 benchmarking
      [[192, 0,   2,   0], 24],  // 192.0.2.0/24 TEST-NET-1
      [[198, 51,  100, 0], 24],  // 198.51.100.0/24 TEST-NET-2
      [[203, 0,   113, 0], 24],  // 203.0.113.0/24 TEST-NET-3
      [[255, 255, 255, 255], 32],// 255.255.255.255 broadcast
    ]
    return blocked.some(([n, b]) => inRange(o, n, b))
  }
  if (net.isIP(ip) === 6) {
    // Unspecified (::) and loopback (::1)
    if (ip === '::' || ip === '::1') return true
    // Multicast: ff00::/8
    if (ip.startsWith('ff')) return true
    // Link-local: fe80::/10 (fe80 through febf).
    // Check: first hextet bytes are 0xfe and (secondByte & 0xc0) === 0x80.
    const firstHextet = ip.split(':')[0]
    if (firstHextet.length >= 2) {
      const firstByte = parseInt(firstHextet.slice(0, 2), 16)
      const secondByte = parseInt(firstHextet.slice(2).padStart(2, '0'), 16)
      if (firstByte === 0xfe && (secondByte & 0xc0) === 0x80) return true
    }
    // fc00::/7 (ULA: fc00 through fdff) is ALLOWED; global unicast allowed.
    return false
  }
  // Unparseable: fail closed.
  return true
}

// --- End SSRF IP policy -------------------------------------------------------

export interface GuardedTransportOptions {
  // Raw PEM (not base64). See ENCODING note above.
  caData?: string
  certData?: string
  keyData?: string
  serverName?: string
  // insecure: true disables TLS verification (rejectUnauthorized=false). When
  // omitted/false, TLS verification is on (rejectUnauthorized effectively true).
  insecure?: boolean
  // allowLoopbackForTest is intentionally absent from this production type.
  // Tests widen via: type TestTransportOptions = GuardedTransportOptions & { allowLoopbackForTest?: boolean }
}

export interface GuardedTransport {
  dispatcher?: unknown
  agent?: unknown
}

// Build the guarded DNS lookup forwarded to the https.Agent socket connect.
// It resolves the host, blocks any resolved IP that the policy rejects, and
// pins the first allowed address so the TLS dial targets exactly what we
// validated. servername is still the original host, so SNI / cert verification
// remain correct.
function makeGuardedLookup(allowLoopbackForTest?: boolean): net.LookupFunction {
  return function guardedLookup(hostname, options, callback) {
    dns.lookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
      if (err) {
        callback(err, '', 0)
        return
      }
      const list = Array.isArray(addresses) ? addresses : []
      if (list.length === 0) {
        callback(new Error(`SSRF guard: ${hostname} did not resolve`), '', 0)
        return
      }
      for (const a of list) {
        if (!allowLoopbackForTest && isBlockedIp(normalizeIp(a.address))) {
          callback(
            new Error(`SSRF guard: refusing to dial ${hostname} -> blocked IP ${a.address}`),
            '',
            0,
          )
          return
        }
      }
      // Honor the caller's `all` flag. node calls this lookup with `all: true`
      // under autoSelectFamily (Happy Eyeballs, the default in Node >=18.13/20)
      // whenever the target is a HOSTNAME and no explicit family is set. In that
      // mode node expects the callback's second argument to be the FULL ARRAY of
      // { address, family } entries. Returning a single (address, family) triple
      // instead makes node treat the address STRING as if it were that array,
      // destructure `undefined` out of it, and throw ERR_INVALID_IP_ADDRESS
      // ("Invalid IP address: undefined") before any socket is opened. Literal-IP
      // servers (e.g. minikube at https://192.168.49.2:8443) skip lookup entirely
      // and dial via createConnection, which is why only hostname-addressed
      // clusters (Rancher proxy URLs, DNS names) hit this. Every entry in `list`
      // has already passed the block policy above, so returning all of them is safe.
      if ((options as dns.LookupOptions)?.all) {
        ;(callback as unknown as (err: NodeJS.ErrnoException | null, addresses: dns.LookupAddress[]) => void)(null, list)
        return
      }
      const chosen = list[0]
      callback(null, chosen.address, chosen.family)
    })
  }
}

export function buildGuardedTransport(opts: GuardedTransportOptions): GuardedTransport {
  // TEST-ONLY flag: read via internal cast so it does not appear on the
  // production type. Production callers cannot set it; test code widens the
  // type explicitly before passing it.
  const allowLoopbackForTest = (opts as { allowLoopbackForTest?: boolean }).allowLoopbackForTest
  const agentOptions: https.AgentOptions = {
    // The guarded lookup fires for HOSTNAME targets: it resolves, blocks any
    // rejected IP, and pins the validated address. node SKIPS lookup when the
    // host is already a literal IP (a very common k8s API server form, e.g.
    // https://10.0.0.1:6443), so literal IPs are guarded in createConnection
    // below. Together they cover both cases on the real dial.
    lookup: makeGuardedLookup(allowLoopbackForTest),
    // rejectUnauthorized defaults to true (TLS verification on); only insecure
    // mode turns it off.
    rejectUnauthorized: opts.insecure ? false : true,
  }
  if (opts.caData) agentOptions.ca = opts.caData
  if (opts.certData) agentOptions.cert = opts.certData
  if (opts.keyData) agentOptions.key = opts.keyData
  if (opts.serverName) agentOptions.servername = opts.serverName

  const agent = new https.Agent(agentOptions)

  // Fail-close literal-IP targets before the socket is created. node bypasses
  // the `lookup` hook for literal IPs, so without this a blocked literal IP
  // (e.g. https://127.0.0.1:.../ or a metadata endpoint) would dial straight
  // through. We validate, then delegate to the stock https.Agent connector so
  // TLS options (ca/cert/key/servername/rejectUnauthorized) still apply.
  const baseCreateConnection = (agent as any).createConnection?.bind(agent)
  ;(agent as any).createConnection = function guardedCreateConnection(
    options: any,
    cb: (err: Error | null, socket?: net.Socket) => void,
  ) {
    const host: string = options?.host ?? options?.hostname ?? ''
    if (!allowLoopbackForTest && net.isIP(host) !== 0 && isBlockedIp(normalizeIp(host))) {
      const err = new Error(`SSRF guard: refusing to dial blocked IP ${host}`)
      if (typeof cb === 'function') {
        cb(err)
        return undefined
      }
      throw err
    }
    return baseCreateConnection(options, cb)
  }

  return { agent }
}

export function validateServerUrl(raw: string): { ok: boolean; error?: string } {
  let u: URL
  try { u = new URL(raw) } catch { return { ok: false, error: 'invalid server url' } }
  if (u.protocol !== 'https:') return { ok: false, error: 'server url must be https' }
  if (!u.hostname) return { ok: false, error: 'server url has no host' }
  return { ok: true }
}
