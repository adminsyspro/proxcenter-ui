import { createHash, timingSafeEqual } from "node:crypto"

import { prisma } from "@/lib/db/prisma"
import { safeLog } from "@/lib/log/sanitize"

// SSH host keys of every endpoint ProxCenter connects to, in ssh_host_keys,
// the table the orchestrator checks too (same database). Keyed by "host:port",
// so two SSH endpoints behind one hostname (NAT, a bastion port-forward) are
// told apart, and by key type, because ssh2 and the orchestrator do not
// negotiate the same host key algorithm by default.
//
// No key is trusted on first use. A key without a confirmed match is stored as
// pending and the connection refused, until an operator confirms its
// fingerprint (connection SSH test, or Settings > SSH commands > Host keys).
//
// ssh_known_hosts, where earlier orchestrators pinned (bare host, no port), is
// still read: a key it holds for the host is accepted and copied here as an
// automatic pin, the same transition the orchestrator applies.

export type HostKeyState = "unconfirmed" | "mismatch"

/** A key that was refused, as the SSH test and the error messages report it. */
export interface HostKeyRefusal {
  endpoint: string
  keyType: string
  fingerprint: string
  state: HostKeyState
}

export type VerifyResult = { status: "trusted"; keyType: string } | ({ status: "refused" } & HostKeyRefusal)

/** One row of the host key registry. */
export interface HostKeyEntry {
  host: string
  keyType: string
  /** Fingerprint of the trusted key, null when only a pending key exists. */
  fingerprint: string | null
  /** Fingerprint of a key that was presented and is waiting for confirmation. */
  pendingFingerprint: string | null
  pendingSeenAt: Date | null
  /** "confirmed" by an operator, "automatic" (pinned before confirmation existed), or "pending". */
  origin: "confirmed" | "automatic" | "pending"
  confirmedAt: Date | null
  confirmedBy: string | null
  firstSeenAt: Date
  lastUsedAt: Date
  /** The row comes from the orchestrator's legacy table (bare host). */
  legacy?: boolean
}

/** Endpoint key, the same string the orchestrator builds: lowercased host, port 22 by default. */
export function hostKeyEndpoint(host: string, port: number): string {
  const h = host.trim().toLowerCase().replace(/^\[(.*)\]$/, "$1")
  if (!h) return ""
  const p = Number.isFinite(port) && port > 0 ? Math.trunc(port) : 22
  return `${h}:${p}`
}

/** The algorithm name inside an SSH wire-format public key. */
export function readKeyType(key: Uint8Array): string {
  const b = Buffer.from(key)
  if (b.length < 5) return "unknown"
  const nameLen = b.readUInt32BE(0)
  if (nameLen <= 0 || nameLen > 64 || b.length < 4 + nameLen) return "unknown"
  return b.subarray(4, 4 + nameLen).toString("utf8")
}

/** OpenSSH-style SHA256 fingerprint of a wire-format public key. */
export function hostKeyFingerprint(key: Uint8Array): string {
  return `SHA256:${createHash("sha256").update(key).digest("base64").replace(/=+$/, "")}`
}

function sameKey(a: Uint8Array, b: Uint8Array): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  if (x.length !== y.length) return false
  return timingSafeEqual(x, y)
}

async function legacyKey(host: string): Promise<{ keyType: string; key: Buffer } | null> {
  try {
    const rows = await prisma.$queryRaw<{ key_type: string; public_key: string }[]>`
      SELECT key_type, public_key FROM ssh_known_hosts WHERE host = ${host}`
    const row = rows[0]
    if (!row) return null
    const key = Buffer.from(row.public_key, "base64")
    return readKeyType(key) === row.key_type ? { keyType: row.key_type, key } : null
  } catch {
    // No orchestrator table (Community without the orchestrator).
    return null
  }
}

async function refuse(endpoint: string, keyType: string, key: Uint8Array, state: HostKeyState): Promise<VerifyResult> {
  const data = Uint8Array.from(key)
  await prisma.sshHostKey.upsert({
    where: { host_keyType: { host: endpoint, keyType } },
    create: { host: endpoint, keyType, pendingKeyData: data, pendingSeenAt: new Date() },
    update: { pendingKeyData: data, pendingSeenAt: new Date() },
  }).catch(() => {})

  return { status: "refused", endpoint, keyType, fingerprint: hostKeyFingerprint(key), state }
}

/**
 * Accept the key only when it is the trusted key of its type for the
 * endpoint. Anything else is stored as pending and refused.
 */
export async function verifyHostKey(host: string, port: number, key: Uint8Array): Promise<VerifyResult> {
  const endpoint = hostKeyEndpoint(host, port)
  if (!endpoint) throw new Error("empty SSH host")
  const keyType = readKeyType(key)

  const trusted = await prisma.sshHostKey.findMany({
    where: { host: endpoint, keyData: { not: null } },
    select: { keyType: true, keyData: true, lastUsedAt: true },
  })
  const same = trusted.find(r => r.keyType === keyType)

  if (same?.keyData) {
    if (!sameKey(same.keyData, key)) return refuse(endpoint, keyType, key, "mismatch")
    if (Date.now() - same.lastUsedAt.getTime() > 3_600_000) {
      await prisma.sshHostKey.update({
        where: { host_keyType: { host: endpoint, keyType } },
        data: { lastUsedAt: new Date() },
      }).catch(() => {})
    }

    return { status: "trusted", keyType }
  }
  if (trusted.length > 0) return refuse(endpoint, keyType, key, "unconfirmed")

  const legacy = await legacyKey(endpoint.slice(0, endpoint.lastIndexOf(":")))
  if (legacy?.keyType === keyType) {
    if (!sameKey(legacy.key, key)) return refuse(endpoint, keyType, key, "mismatch")
    const row = await prisma.sshHostKey.upsert({
      where: { host_keyType: { host: endpoint, keyType } },
      create: { host: endpoint, keyType, keyData: Uint8Array.from(key) },
      update: {},
      select: { keyData: true },
    })
    if (row.keyData && sameKey(row.keyData, key)) return { status: "trusted", keyType }
    if (!row.keyData) {
      await prisma.sshHostKey.update({
        where: { host_keyType: { host: endpoint, keyType } },
        data: { keyData: Uint8Array.from(key) },
      })

      return { status: "trusted", keyType }
    }

    return refuse(endpoint, keyType, key, "mismatch")
  }

  return refuse(endpoint, keyType, key, "unconfirmed")
}

/** Human-readable refusal, the text every SSH caller surfaces. */
export function hostKeyRefusalMessage(r: HostKeyRefusal): string {
  if (r.state === "mismatch") {
    return `SSH host key of ${r.endpoint} changed: it presented ${r.keyType} ${r.fingerprint}, which is not the trusted key. Refusing to connect. If the host was reinstalled, confirm the new key in Settings > SSH commands > Host keys, or from the SSH test of the connection.`
  }

  return `SSH host key of ${r.endpoint} is not confirmed: it presented ${r.keyType} ${r.fingerprint}. Confirm this fingerprint from the SSH test of the connection, or in Settings > SSH commands > Host keys, and retry.`
}

// Offered when no key is trusted for the endpoint yet. The orchestrator offers
// the same order, so both clients meet the same key of a new host and one
// confirmation covers both.
const DEFAULT_HOST_KEY_ALGORITHMS = [
  "ssh-ed25519",
  "ecdsa-sha2-nistp256", "ecdsa-sha2-nistp384", "ecdsa-sha2-nistp521",
  "rsa-sha2-512", "rsa-sha2-256", "ssh-rsa",
]

/** Signature algorithms that use a key of this type. */
export function algorithmsForKeyType(keyType: string): string[] {
  return keyType === "ssh-rsa" ? ["rsa-sha2-512", "rsa-sha2-256", "ssh-rsa"] : [keyType]
}

/**
 * Host key algorithms ssh2 should offer for the endpoint: those of its
 * trusted keys first, so the server presents a key ProxCenter can check
 * (else that of the orchestrator's legacy pin of the host), then the rest of
 * the default order. The rest stays offered because ESXi refuses to run a
 * command for a client that does not offer RSA; a server that presents a
 * type with no trusted key is refused anyway.
 */
export async function hostKeyAlgorithms(host: string, port: number): Promise<string[]> {
  const endpoint = hostKeyEndpoint(host, port)
  if (!endpoint) return DEFAULT_HOST_KEY_ALGORITHMS
  const rows = await prisma.sshHostKey.findMany({
    where: { host: endpoint, keyData: { not: null } },
    select: { keyType: true },
  }).catch(() => [])
  const types = rows.map(r => r.keyType)
  if (types.length === 0) {
    const legacy = await legacyKey(endpoint.slice(0, endpoint.lastIndexOf(":")))
    if (legacy) types.push(legacy.keyType)
  }
  if (types.length === 0) return DEFAULT_HOST_KEY_ALGORITHMS
  const wanted = new Set(types.flatMap(algorithmsForKeyType))
  const first = [...DEFAULT_HOST_KEY_ALGORITHMS.filter(a => wanted.has(a)), ...[...wanted].filter(a => !DEFAULT_HOST_KEY_ALGORITHMS.includes(a))]

  return [...first, ...DEFAULT_HOST_KEY_ALGORITHMS.filter(a => !wanted.has(a))]
}

/**
 * Trust the key of `endpoint` whose fingerprint the operator saw: the pending
 * key becomes the trusted one, or an automatic pin becomes confirmed. Returns
 * false when no key of the endpoint has that fingerprint (it changed since).
 */
export async function confirmHostKey(endpoint: string, fingerprint: string, by: string): Promise<boolean> {
  const rows = await prisma.sshHostKey.findMany({
    where: { host: endpoint },
    select: { keyType: true, keyData: true, pendingKeyData: true },
  })
  for (const row of rows) {
    if (row.pendingKeyData && hostKeyFingerprint(row.pendingKeyData) === fingerprint) {
      await prisma.sshHostKey.update({
        where: { host_keyType: { host: endpoint, keyType: row.keyType } },
        data: {
          keyData: Uint8Array.from(row.pendingKeyData), pendingKeyData: null, pendingSeenAt: null,
          confirmedAt: new Date(), confirmedBy: by,
        },
      })

      return true
    }
    if (row.keyData && hostKeyFingerprint(row.keyData) === fingerprint) {
      await prisma.sshHostKey.update({
        where: { host_keyType: { host: endpoint, keyType: row.keyType } },
        data: { pendingKeyData: null, pendingSeenAt: null, confirmedAt: new Date(), confirmedBy: by },
      })

      return true
    }
  }

  return false
}

/** Every key of the registry, trusted or pending, plus the legacy pins no trusted key covers yet. */
export async function listHostKeys(): Promise<HostKeyEntry[]> {
  const rows = await prisma.sshHostKey.findMany({ orderBy: [{ host: "asc" }, { keyType: "asc" }] })
  const entries: HostKeyEntry[] = rows.map(r => ({
    host: r.host,
    keyType: r.keyType,
    fingerprint: r.keyData ? hostKeyFingerprint(r.keyData) : null,
    pendingFingerprint: r.pendingKeyData ? hostKeyFingerprint(r.pendingKeyData) : null,
    pendingSeenAt: r.pendingSeenAt,
    origin: !r.keyData ? "pending" : r.confirmedAt ? "confirmed" : "automatic",
    confirmedAt: r.confirmedAt,
    confirmedBy: r.confirmedBy,
    firstSeenAt: r.firstSeenAt,
    lastUsedAt: r.lastUsedAt,
  }))
  const covered = new Set(rows.filter(r => r.keyData).map(r => r.host.slice(0, r.host.lastIndexOf(":"))))

  try {
    const legacy = await prisma.$queryRaw<{ host: string; key_type: string; public_key: string; pinned_at: Date }[]>`
      SELECT host, key_type, public_key, pinned_at FROM ssh_known_hosts ORDER BY host`
    for (const l of legacy) {
      if (covered.has(l.host)) continue
      entries.push({
        host: l.host, keyType: l.key_type, fingerprint: hostKeyFingerprint(Buffer.from(l.public_key, "base64")),
        pendingFingerprint: null, pendingSeenAt: null, origin: "automatic", confirmedAt: null, confirmedBy: null,
        firstSeenAt: l.pinned_at, lastUsedAt: l.pinned_at, legacy: true,
      })
    }
  } catch {
    // No orchestrator table.
  }

  return entries
}

function bareHost(host: string): string {
  return host.trim().toLowerCase().replace(/^\[(.*)\]$/, "$1")
}

/**
 * Drop the keys of `host`: every port and key type when it is a bare host,
 * that endpoint only when it is "host:port" (as the registry lists it), plus
 * the legacy pin of the bare host. Returns the number of rows removed.
 */
export async function forgetHostKey(host: string): Promise<number> {
  const raw = host.trim().toLowerCase()
  if (!raw) return 0
  const portMatch = /^(.*):(\d+)$/.exec(raw)
  const isEndpoint = (!!portMatch && !portMatch[1].includes(":")) || /^\[.*\]:\d+$/.test(raw)
  const bare = isEndpoint ? bareHost(portMatch![1]) : bareHost(raw)

  const { count } = isEndpoint
    ? await prisma.sshHostKey.deleteMany({ where: { host: hostKeyEndpoint(bare, Number(portMatch![2])) } })
    : await prisma.sshHostKey.deleteMany({ where: { OR: [{ host: bare }, { host: { startsWith: `${bare}:` } }] } })

  let legacy = 0
  try {
    legacy = await prisma.$executeRaw`DELETE FROM ssh_known_hosts WHERE host = ${bare}`
  } catch {
    // No orchestrator table.
  }

  return count + legacy
}

/**
 * known_hosts lines of the trusted keys of an endpoint, for OpenSSH on a PVE
 * node ("[host]:port type base64", or "host type base64" on port 22), with the
 * SHA-256 of each key (hex) for QEMU's ssh driver. Empty when none is trusted.
 */
export async function trustedKnownHosts(host: string, port: number): Promise<{ lines: string[]; keyTypes: string[]; sha256Hex: string[] }> {
  const endpoint = hostKeyEndpoint(host, port)
  const rows = endpoint
    ? await prisma.sshHostKey.findMany({
        where: { host: endpoint, keyData: { not: null } },
        select: { keyType: true, keyData: true },
        orderBy: { keyType: "asc" },
      })
    : []
  const name = port === 22 ? bareHost(host) : `[${bareHost(host)}]:${port}`

  return {
    lines: rows.map(r => `${name} ${r.keyType} ${Buffer.from(r.keyData!).toString("base64")}`),
    keyTypes: rows.map(r => r.keyType),
    sha256Hex: rows.map(r => createHash("sha256").update(r.keyData!).digest("hex")),
  }
}

type VerifyCallback = (ok: boolean) => void

/**
 * Builds the ssh2 `hostVerifier` callback. Kept here rather than inline in
 * executeSSHDirect so the logging branches stay unit-testable. Every
 * interpolated value passes through safeLog: key types and fingerprints come
 * from the key the remote server hands us.
 */
export function makeHostVerifier(host: string, port: number, onRefusal?: (refusal: HostKeyRefusal, message: string) => void) {
  return (key: Buffer, verify: VerifyCallback): void => {
    verifyHostKey(host, port, key)
      .then((result) => {
        if (result.status === "refused") {
          const message = hostKeyRefusalMessage(result)

          console.warn(`[ssh] ${safeLog(message)}`)
          // ssh2 turns a rejected hostVerifier into a bare handshake error,
          // so the reason never reaches the caller: hand it over here.
          onRefusal?.(result, message)
          verify(false)

          return
        }
        verify(true)
      })
      .catch((err) => {
        console.error(`[ssh] host-key verification failed for ${safeLog(host)}: ${safeLog(err?.message || String(err))}`)
        verify(false)
      })
  }
}
