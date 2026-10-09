// src/lib/connections/check/probes.ts
//
// The read-only probes behind "Check connection". Each one returns a list of
// items and never throws: a failure is an item with a hint, and the runner
// adds a time bound on top. Transport goes through CheckDeps so the probes
// run against plain fakes in tests.

import { isHostKeyMismatch } from '@/components/settings/hostKeyMismatch'
import { extractHostFromUrl, replaceHostInUrl } from '@/lib/proxmox/urlUtils'

import {
  PRIVILEGE_REQUIREMENTS,
  aclCommand,
  hasPrivilegeAt,
  splitTokenId,
  tokenIdOf,
  type PvePermissions,
} from './privilegeMap'
import type { CheckContext, CheckDeps, CheckItem, CheckParams, CheckStatus, PveNode } from './types'
import { MIN_SUPPORTED_PVE_MAJOR, parsePveVersion, unmetGates } from './versionGates'

export const API_TIMEOUT_MS = 6_000
export const TLS_TIMEOUT_MS = 5_000
export const READ_TIMEOUT_MS = 8_000
export const SSH_TIMEOUT_MS = 10_000
export const CLOCK_WARN_SECONDS = 30
export const CLOCK_FAIL_SECONDS = 120
export const CERT_EXPIRY_WARN_DAYS = 30

/** The node list, or why it could not be read. */
export type NodeList = { nodes: PveNode[] } | { error: string }

function item(id: string, status: CheckStatus, hint: string, params: CheckParams = {}): CheckItem {
  const probe = id.split('.')[0] as CheckItem['probe']
  return { id, probe, status, hint, params }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as { cause?: unknown }).cause
    const causeMsg = cause instanceof Error ? cause.message : ''
    return causeMsg && !err.message.includes(causeMsg) ? `${err.message}: ${causeMsg}` : err.message
  }
  return String(err)
}

function statusCodeOf(err: unknown): number | null {
  const direct = (err as { statusCode?: unknown })?.statusCode
  if (typeof direct === 'number') return direct
  const msg = err instanceof Error ? err.message : ''
  const match = /PVE (\d{3}) /.exec(msg)
  return match ? Number(match[1]) : null
}

const TLS_ERROR_CODES = [
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_GET_ISSUER_CERT',
  'CERT_UNTRUSTED',
  'HOSTNAME_MISMATCH',
  'ERR_SSL_',
  'EPROTO',
]
const TIMEOUT_CODES = ['UND_ERR_CONNECT_TIMEOUT', 'ETIMEDOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT']
const NETWORK_CODES = ['ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'EPIPE']

function codesOf(err: unknown): string[] {
  const out: string[] = []
  let current: unknown = err
  for (let depth = 0; current && depth < 4; depth++) {
    const e = current as { code?: unknown; name?: unknown; message?: unknown; cause?: unknown }
    for (const v of [e.code, e.name, e.message]) if (typeof v === 'string') out.push(v)
    current = e.cause
  }
  return out
}

export type TransportFailure = { kind: 'tls' | 'timeout' | 'network' | 'other'; reason: string }

/** Sorts a thrown transport error into what the operator must fix. */
export function classifyTransportError(err: unknown): TransportFailure {
  const codes = codesOf(err)
  const has = (needles: string[]) => codes.some(c => needles.some(n => c.includes(n)))
  const code = codes.find(c => /^[A-Z_]{4,}$/.test(c))
  const reason = code ?? errorMessage(err)
  if (has(TLS_ERROR_CODES) || codes.some(c => /certificate|self.signed/i.test(c))) return { kind: 'tls', reason }
  if (has(TIMEOUT_CODES) || codes.some(c => /TimeoutError|AbortError/.test(c))) return { kind: 'timeout', reason }
  if (has(NETWORK_CODES)) return { kind: 'network', reason }
  return { kind: 'other', reason: errorMessage(err) }
}

// ---------------------------------------------------------------------------
// 1. API reachability
// ---------------------------------------------------------------------------

type HostProbe =
  | { ok: true; version: string; latencyMs: number }
  | { ok: false; hint: 'api.unauthorized' | 'api.tlsRejected' | 'api.timeout' | 'api.unreachable' | 'api.httpError'; reason: string; status?: number }

async function probeHost(baseUrl: string, deps: CheckDeps): Promise<HostProbe> {
  const started = deps.now()
  try {
    const res = await deps.directGet(baseUrl, '/version', API_TIMEOUT_MS)
    const latencyMs = Math.max(0, deps.now() - started)
    if (res.statusCode === 401) return { ok: false, hint: 'api.unauthorized', reason: 'HTTP 401', status: 401 }
    if (res.statusCode < 200 || res.statusCode >= 300) {
      return { ok: false, hint: 'api.httpError', reason: `HTTP ${res.statusCode}`, status: res.statusCode }
    }
    const version = String((res.data as { version?: unknown })?.version ?? 'unknown')
    return { ok: true, version, latencyMs }
  } catch (err) {
    const failure = classifyTransportError(err)
    if (failure.kind === 'tls') return { ok: false, hint: 'api.tlsRejected', reason: failure.reason }
    if (failure.kind === 'timeout') return { ok: false, hint: 'api.timeout', reason: failure.reason }
    return { ok: false, hint: 'api.unreachable', reason: failure.reason }
  }
}

export async function probeApi(ctx: CheckContext, deps: CheckDeps): Promise<CheckItem[]> {
  const items: CheckItem[] = []
  const primaryHost = extractHostFromUrl(ctx.conn.baseUrl) ?? ctx.conn.baseUrl

  const primary = await probeHost(ctx.conn.baseUrl, deps)
  // `=== true`: with strict off, truthiness does not narrow the discriminant.
  if (primary.ok === true) {
    items.push(item('api.primary', 'ok', 'api.ok', { host: primaryHost, version: primary.version, latencyMs: primary.latencyMs }))
  } else {
    const params: CheckParams = { host: primaryHost, error: primary.reason, timeoutMs: API_TIMEOUT_MS }
    if (primary.status !== undefined) params.status = primary.status
    if (primary.hint === 'api.tlsRejected') params.reason = primary.reason
    items.push(item('api.primary', 'fail', primary.hint, params))
  }

  const fallbacks = ctx.fallbackHosts.filter(h => h.ip && h.ip !== primaryHost)
  if (ctx.conn.behindProxy) {
    items.push(item('api.fallback', 'skip', 'api.fallbackBehindProxy', { host: primaryHost }))
    return items
  }
  if (fallbacks.length === 0) {
    items.push(item('api.fallback', 'skip', 'api.noFallbackHosts', { host: primaryHost }))
    return items
  }

  const results = await Promise.all(
    fallbacks.map(async h => ({ h, r: await probeHost(replaceHostInUrl(ctx.conn.baseUrl, h.ip), deps) })),
  )
  for (const { h, r } of results) {
    const id = `api.fallback.${h.node}`
    if (r.ok === true) {
      items.push(item(id, 'ok', 'api.fallbackOk', { node: h.node, host: h.ip, latencyMs: r.latencyMs, version: r.version }))
    } else if (r.hint === 'api.tlsRejected') {
      items.push(item(id, 'warn', 'api.fallbackTlsRejected', { node: h.node, host: h.ip, reason: r.reason }))
    } else {
      items.push(item(id, 'warn', 'api.fallbackUnreachable', { node: h.node, host: h.ip, error: r.reason }))
    }
  }
  return items
}

// ---------------------------------------------------------------------------
// 2. TLS certificate and pinned fingerprint
// ---------------------------------------------------------------------------

function normalizeFingerprint(fp: string): string {
  return fp.replaceAll(/[^0-9a-f]/gi, '').toUpperCase()
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

export async function probeTls(ctx: CheckContext, deps: CheckDeps): Promise<CheckItem[]> {
  const host = extractHostFromUrl(ctx.conn.baseUrl) ?? ctx.conn.baseUrl
  let protocol = ''
  try {
    protocol = new URL(ctx.conn.baseUrl).protocol
  } catch {
    protocol = ''
  }
  if (protocol !== 'https:') {
    return [item('tls.certificate', 'skip', 'tls.notHttps', { host }), item('tls.fingerprint', 'skip', 'tls.pinUnchecked', { host })]
  }

  let cert
  try {
    cert = await deps.readCertificate(ctx.conn.baseUrl, TLS_TIMEOUT_MS)
  } catch (err) {
    return [
      item('tls.certificate', 'fail', 'tls.unreachable', { host, error: classifyTransportError(err).reason }),
      item('tls.fingerprint', 'skip', 'tls.pinUnchecked', { host }),
    ]
  }

  const now = deps.now()
  const validTo = Date.parse(cert.validTo)
  const validFrom = Date.parse(cert.validFrom)
  const days = Number.isFinite(validTo) ? Math.floor((validTo - now) / 86_400_000) : Number.NaN
  const items: CheckItem[] = []

  if (Number.isFinite(validTo) && validTo < now) {
    items.push(item('tls.certificate', 'fail', 'tls.expired', { host, validTo: isoDate(validTo) }))
  } else if (Number.isFinite(validFrom) && validFrom > now) {
    items.push(item('tls.certificate', 'fail', 'tls.notYetValid', { host, validFrom: isoDate(validFrom) }))
  } else if (Number.isFinite(days) && days <= CERT_EXPIRY_WARN_DAYS) {
    items.push(item('tls.certificate', 'warn', 'tls.expiringSoon', { host, days, validTo: isoDate(validTo) }))
  } else if (cert.authorized) {
    items.push(item('tls.certificate', 'ok', 'tls.ok', { host, days, validTo: isoDate(validTo) }))
  } else if (ctx.conn.insecureDev) {
    items.push(item('tls.certificate', 'ok', 'tls.okUntrusted', { host, days, validTo: isoDate(validTo) }))
  } else {
    items.push(item('tls.certificate', 'warn', 'tls.untrusted', { host, days, reason: cert.authorizationError ?? 'untrusted' }))
  }

  if (!ctx.pinnedFingerprint) {
    items.push(item('tls.fingerprint', 'skip', 'tls.noPin', { host }))
  } else if (normalizeFingerprint(ctx.pinnedFingerprint) === normalizeFingerprint(cert.fingerprint)) {
    items.push(item('tls.fingerprint', 'ok', 'tls.pinMatch', { host, fingerprint: cert.fingerprint }))
  } else {
    items.push(item('tls.fingerprint', 'fail', 'tls.pinMismatch', { host, expected: ctx.pinnedFingerprint, actual: cert.fingerprint }))
  }
  return items
}

// ---------------------------------------------------------------------------
// 3. Privileges
// ---------------------------------------------------------------------------

/**
 * Whether the token has privilege separation on, read from its own token
 * entry. Null when PVE refuses the read (the token may not hold User.Modify
 * and PVE does not always let a token read itself) or for a plain user id.
 */
async function readPrivsep(tokenId: string, deps: CheckDeps): Promise<boolean | null> {
  const { user, name } = splitTokenId(tokenId)
  if (name === null) return null
  try {
    const info = await deps.pveGet<{ privsep?: unknown }>(
      `/access/users/${encodeURIComponent(user)}/token/${encodeURIComponent(name)}`,
      READ_TIMEOUT_MS,
    )
    if (!info || typeof info !== 'object' || !('privsep' in info)) return null
    return Number(info.privsep) === 1
  } catch {
    return null
  }
}

/**
 * The hints that fit what is known about privilege separation: with it on,
 * a privilege counts only when both the user and the token hold it (PVE
 * intersects the two ACLs); with it off the token uses the user's.
 */
function privsepHints(privsep: boolean | null): { none: string; missing: string } {
  if (privsep === true) return { none: 'privileges.noneSeparated', missing: 'privileges.missingSeparated' }
  if (privsep === false) return { none: 'privileges.noneUser', missing: 'privileges.missingUser' }
  return { none: 'privileges.none', missing: 'privileges.missing' }
}

export async function probePrivileges(ctx: CheckContext, deps: CheckDeps): Promise<CheckItem[]> {
  const tokenId = tokenIdOf(ctx.conn.apiToken)
  const { user } = splitTokenId(tokenId)
  const [permissionsResult, privsep] = await Promise.all([
    deps.pveGet<unknown>('/access/permissions', READ_TIMEOUT_MS).then(
      raw => ({ raw }),
      (err: unknown) => ({ error: errorMessage(err) }),
    ),
    readPrivsep(tokenId, deps),
  ])
  if ('error' in permissionsResult) {
    return [item('privileges', 'fail', 'privileges.unreadable', { tokenId, error: permissionsResult.error })]
  }
  const raw = permissionsResult.raw
  const permissions: PvePermissions = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as PvePermissions) : {}
  const hints = privsepHints(privsep)

  const anyPrivilege = Object.values(permissions).some(entry => entry && typeof entry === 'object' && Object.keys(entry).length > 0)
  if (!anyPrivilege) {
    return [item('privileges', 'fail', hints.none, { tokenId, user, command: aclCommand('/', tokenId, ['Sys.Audit'], privsep) })]
  }

  const items: CheckItem[] = []
  let checked = 0
  for (const req of PRIVILEGE_REQUIREMENTS) {
    checked += req.privileges.length
    const missing = req.privileges.filter(p => !hasPrivilegeAt(permissions, req.path, p))
    if (missing.length === 0) continue
    items.push(
      item(`privileges.${req.id}`, req.severity, hints.missing, {
        privileges: missing.join(', '),
        path: req.path,
        features: req.features,
        tokenId,
        user,
        command: aclCommand(req.path, tokenId, missing, privsep),
      }),
    )
  }
  if (items.length === 0) return [item('privileges', 'ok', 'privileges.ok', { tokenId, count: checked })]
  return items
}

// ---------------------------------------------------------------------------
// 4. PVE version per node
// ---------------------------------------------------------------------------

function onlineNodes(list: PveNode[]): { online: PveNode[]; offline: PveNode[] } {
  const online: PveNode[] = []
  const offline: PveNode[] = []
  for (const n of list) {
    if (!n?.node) continue
    if (n.status && n.status !== 'online') offline.push(n)
    else online.push(n)
  }
  return { online, offline }
}

function nodeListSkip(probe: string, list: { error: string }): CheckItem[] {
  return [item(probe, 'skip', 'nodes.unreadable', { error: list.error })]
}

export async function probeVersion(ctx: CheckContext, deps: CheckDeps, list: NodeList): Promise<CheckItem[]> {
  if ('error' in list) return nodeListSkip('version', list)
  const { online, offline } = onlineNodes(list.nodes)
  const items: CheckItem[] = []
  const seen = new Map<string, string>()

  const results = await Promise.all(
    online.map(async n => {
      try {
        const data = await deps.pveGet<{ version?: unknown }>(`/nodes/${encodeURIComponent(n.node)}/version`, READ_TIMEOUT_MS)
        return { node: n.node, raw: data?.version }
      } catch (err) {
        return { node: n.node, error: errorMessage(err) }
      }
    }),
  )

  for (const r of results) {
    const id = `version.${r.node}`
    if ('error' in r) {
      items.push(item(id, 'fail', 'version.unreadable', { node: r.node, error: r.error }))
      continue
    }
    const parsed = parsePveVersion(r.raw)
    const version = typeof r.raw === 'string' ? r.raw : 'unknown'
    if (!parsed) {
      items.push(item(id, 'warn', 'version.unreadable', { node: r.node, error: `unparsable version "${version}"` }))
      continue
    }
    seen.set(r.node, `${parsed.major}.${parsed.minor}`)
    if (parsed.major < MIN_SUPPORTED_PVE_MAJOR) {
      items.push(item(id, 'warn', 'version.belowSupported', { node: r.node, version, min: MIN_SUPPORTED_PVE_MAJOR }))
      continue
    }
    const gates = unmetGates(parsed)
    if (gates.length > 0) {
      const required = `${gates[0].min[0]}.${gates[0].min[1]}`
      items.push(item(id, 'warn', 'version.gated', { node: r.node, version, required, features: gates.map(g => g.feature) }))
      continue
    }
    items.push(item(id, 'ok', 'version.ok', { node: r.node, version }))
  }

  for (const n of offline) items.push(item(`version.${n.node}`, 'skip', 'node.offline', { node: n.node }))

  if (new Set(seen.values()).size > 1) {
    const versions = [...seen.entries()].map(([node, v]) => `${node} ${v}`).join(', ')
    items.push(item('version.cluster', 'warn', 'version.mixed', { versions }))
  }
  return items
}

// ---------------------------------------------------------------------------
// 5. Clock skew
// ---------------------------------------------------------------------------

export async function probeClock(ctx: CheckContext, deps: CheckDeps, list: NodeList): Promise<CheckItem[]> {
  if ('error' in list) return nodeListSkip('clock', list)
  const { online, offline } = onlineNodes(list.nodes)

  const results = await Promise.all(
    online.map(async n => {
      const before = deps.now()
      try {
        const data = await deps.pveGet<{ time?: unknown; timezone?: unknown }>(`/nodes/${encodeURIComponent(n.node)}/time`, READ_TIMEOUT_MS)
        const after = deps.now()
        const nodeTime = Number(data?.time)
        if (!Number.isFinite(nodeTime)) return { node: n.node, error: 'no time in answer' }
        const skewSeconds = Math.round(nodeTime - (before + after) / 2000)
        return { node: n.node, skewSeconds, timezone: typeof data?.timezone === 'string' ? data.timezone : '' }
      } catch (err) {
        return { node: n.node, error: errorMessage(err), status: statusCodeOf(err) }
      }
    }),
  )

  const items: CheckItem[] = []
  for (const r of results) {
    const id = `clock.${r.node}`
    if ('error' in r) {
      if (r.status === 403) items.push(item(id, 'skip', 'clock.forbidden', { node: r.node }))
      else items.push(item(id, 'fail', 'clock.unreadable', { node: r.node, error: r.error }))
      continue
    }
    const abs = Math.abs(r.skewSeconds)
    const params: CheckParams = { node: r.node, skewSeconds: r.skewSeconds, timezone: r.timezone }
    if (abs > CLOCK_FAIL_SECONDS) items.push(item(id, 'fail', 'clock.fail', params))
    else if (abs > CLOCK_WARN_SECONDS) items.push(item(id, 'warn', 'clock.warn', params))
    else items.push(item(id, 'ok', 'clock.ok', params))
  }
  for (const n of offline) items.push(item(`clock.${n.node}`, 'skip', 'node.offline', { node: n.node }))
  return items
}

// ---------------------------------------------------------------------------
// 6. Quorum
// ---------------------------------------------------------------------------

export async function probeQuorum(ctx: CheckContext, deps: CheckDeps): Promise<CheckItem[]> {
  let status: Array<Record<string, unknown>>
  try {
    const raw = await deps.pveGet<unknown>('/cluster/status', READ_TIMEOUT_MS)
    status = Array.isArray(raw) ? (raw as Array<Record<string, unknown>>) : []
  } catch (err) {
    if (statusCodeOf(err) === 403) return [item('quorum', 'skip', 'quorum.forbidden', {})]
    return [item('quorum', 'fail', 'quorum.unreadable', { error: errorMessage(err) })]
  }

  const cluster = status.find(e => e.type === 'cluster')
  const nodes = status.filter(e => e.type === 'node')
  const total = nodes.length
  const offline = nodes.filter(n => !(n.online === 1 || n.online === true))
  const online = total - offline.length
  if (!cluster) return [item('quorum', 'ok', 'quorum.standalone', { total })]

  const name = typeof cluster.name === 'string' ? cluster.name : ''
  const quorate = cluster.quorate === 1 || cluster.quorate === true
  if (!quorate) return [item('quorum', 'fail', 'quorum.lost', { cluster: name, online, total })]
  if (offline.length > 0) {
    const names = offline.map(n => String(n.name ?? '?')).join(', ')
    return [item('quorum', 'warn', 'quorum.degraded', { cluster: name, online, total, offline: offline.length, nodes: names })]
  }
  return [item('quorum', 'ok', 'quorum.ok', { cluster: name, online, total })]
}

// ---------------------------------------------------------------------------
// 7. SSH, one attempt per node
// ---------------------------------------------------------------------------

export async function probeSsh(ctx: CheckContext, deps: CheckDeps, list: NodeList, prerequisitesOk: boolean): Promise<CheckItem[]> {
  if (!ctx.ssh.enabled) return [item('ssh', 'skip', 'ssh.disabled', {})]
  if (!prerequisitesOk) return [item('ssh', 'skip', 'ssh.prerequisitesFailed', {})]
  if (!ctx.ssh.key && !ctx.ssh.password) return [item('ssh', 'skip', 'ssh.noCredentials', {})]
  if ('error' in list) return nodeListSkip('ssh', list)

  const { online, offline } = onlineNodes(list.nodes)
  const user = ctx.ssh.user
  const results = await Promise.all(
    online.map(async n => {
      let host = ''
      let port = ctx.ssh.port
      try {
        const endpoint = await deps.resolveSshEndpoint(n.node)
        host = endpoint.host
        port = endpoint.port
      } catch (err) {
        return item(`ssh.${n.node}`, 'fail', 'ssh.failed', { node: n.node, host, port, user, error: errorMessage(err) })
      }
      const params: CheckParams = { node: n.node, host, port, user }
      try {
        const r = await deps.sshExec({ host, port, command: 'hostname', timeoutMs: SSH_TIMEOUT_MS })
        if (r.success) return item(`ssh.${n.node}`, 'ok', 'ssh.ok', { ...params, hostname: (r.output ?? '').trim() })
        const error = r.error ?? 'unknown error'
        if (isHostKeyMismatch(error)) return item(`ssh.${n.node}`, 'fail', 'ssh.hostKeyMismatch', { ...params, error })
        if (/authentication methods failed|permission denied|auth/i.test(error)) {
          return item(`ssh.${n.node}`, 'fail', 'ssh.authFailed', { ...params, error })
        }
        if (/timeout|ETIMEDOUT/i.test(error)) return item(`ssh.${n.node}`, 'fail', 'ssh.timeout', { ...params, error })
        return item(`ssh.${n.node}`, 'fail', 'ssh.failed', { ...params, error })
      } catch (err) {
        return item(`ssh.${n.node}`, 'fail', 'ssh.failed', { ...params, error: errorMessage(err) })
      }
    }),
  )
  for (const n of offline) results.push(item(`ssh.${n.node}`, 'skip', 'node.offline', { node: n.node }))
  return results
}
