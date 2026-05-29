import { prisma } from "@/lib/db/prisma"
import { timingSafeEqual } from "node:crypto"
import { safeLog } from "@/lib/log/sanitize"

// TOFU host-key store for the frontend ssh2 path. Mirrors the backend
// orchestrator's /app/data/known_hosts. Keyed by "host:port" so that
// two distinct SSH endpoints reachable through the same hostname (NAT,
// bastion port-forwards, alternate daemons on the same host) can pin
// different keys without colliding. First successful connection pins
// the key; every subsequent connection must match it bit-for-bit or
// the SSH handshake is aborted.
//
// The verifier is intentionally async (uses Prisma) and pairs with the
// ssh2 `hostVerifier` async signature. Using the DB rather than a flat
// file avoids coordinating filesystem paths between the Next.js process
// and ws-proxy and survives container rebuilds naturally.

export type VerifyResult =
  | { status: "pinned-new"; keyType: string }
  | { status: "pinned-existing"; keyType: string }
  | { status: "mismatch"; expectedKeyType: string; presentedKeyType: string }

function normalizeHost(host: string, port: number): string {
  const h = host.trim().toLowerCase()
  if (!h) return ""
  // Default port 22 still gets the suffix so we never have a row that
  // could be confused with a port-less entry from an older deployment.
  const p = Number.isFinite(port) && port > 0 ? Math.trunc(port) : 22
  return `${h}:${p}`
}

// Hint extracted from the ssh2 public key buffer. The first 4 bytes are
// a big-endian length, followed by the algorithm name (e.g. "ssh-rsa",
// "ecdsa-sha2-nistp256", "ssh-ed25519"). Used for log/error messages
// only — the security decision is always taken on the raw bytes.
function readKeyType(key: Buffer): string {
  if (!Buffer.isBuffer(key) || key.length < 5) return "unknown"
  const nameLen = key.readUInt32BE(0)
  if (nameLen <= 0 || nameLen > 64 || key.length < 4 + nameLen) return "unknown"
  return key.subarray(4, 4 + nameLen).toString("utf8")
}

function bytesEqualConstantTime(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) {
    // Pad to a fixed length to keep the timing profile uniform.
    timingSafeEqual(a, Buffer.alloc(a.length))
    return false
  }
  return timingSafeEqual(a, b)
}

/**
 * Verify the presented host key against the pinned entry for `host`, or
 * pin it on first contact. Returns a structured result so callers can
 * log the outcome distinctly (new pin, ratified, or rejected).
 *
 * The function returns a result rather than throwing because ssh2's
 * verify-callback signature is `(verify: (ok: boolean) => void) => void`
 * and the caller needs to decide what to log/surface separately.
 */
export async function verifyOrPin(host: string, port: number, key: Buffer): Promise<VerifyResult> {
  const normalized = normalizeHost(host, port)
  if (!normalized) {
    return { status: "mismatch", expectedKeyType: "n/a", presentedKeyType: "n/a" }
  }
  const presentedKeyType = readKeyType(key)

  const existing = await prisma.sshHostKey.findUnique({
    where: { host: normalized },
    select: { keyType: true, keyData: true },
  })

  if (!existing) {
    try {
      await prisma.sshHostKey.create({
        data: {
          host: normalized,
          keyType: presentedKeyType,
          // Prisma's `Bytes` column types as Uint8Array<ArrayBuffer> in
          // 7.x; the Buffer view ssh2 hands us is technically backed by
          // ArrayBufferLike, so copy into a fresh ArrayBuffer to satisfy
          // the narrower contract at compile time.
          keyData: Uint8Array.from(key),
        },
      })
      return { status: "pinned-new", keyType: presentedKeyType }
    } catch (err: any) {
      // P2002 means two concurrent first-connect attempts raced. The
      // second writer reads back the now-pinned key and treats it as a
      // normal verification.
      if (err?.code !== "P2002") throw err
      const winner = await prisma.sshHostKey.findUnique({
        where: { host: normalized },
        select: { keyType: true, keyData: true },
      })
      if (!winner) {
        return { status: "mismatch", expectedKeyType: "n/a", presentedKeyType }
      }
      if (bytesEqualConstantTime(Buffer.from(winner.keyData), key)) {
        await touchLastUsed(normalized)
        return { status: "pinned-existing", keyType: winner.keyType }
      }
      return {
        status: "mismatch",
        expectedKeyType: winner.keyType,
        presentedKeyType,
      }
    }
  }

  if (!bytesEqualConstantTime(Buffer.from(existing.keyData), key)) {
    return {
      status: "mismatch",
      expectedKeyType: existing.keyType,
      presentedKeyType,
    }
  }

  await touchLastUsed(normalized)
  return { status: "pinned-existing", keyType: existing.keyType }
}

async function touchLastUsed(host: string): Promise<void> {
  // Best-effort; if the row disappeared between read and update we just
  // skip the timestamp bump rather than fail the whole SSH op.
  try {
    await prisma.sshHostKey.update({
      where: { host },
      data: { lastUsedAt: new Date() },
    })
  } catch {
    // ignore
  }
}

type VerifyCallback = (ok: boolean) => void

/**
 * Builds the ssh2 `hostVerifier` callback. Kept here rather than inline
 * in executeSSHDirect so the logging branches stay unit-testable. Every
 * interpolated value passes through safeLog because keyType strings
 * come from the buffer the remote server hands us, and CodeQL's
 * js/log-injection rule treats anything reachable from network input
 * as tainted until a known sanitiser is applied.
 */
export function makeHostVerifier(host: string, port: number) {
  return (key: Buffer, verify: VerifyCallback): void => {
    const safeHost = safeLog(host)
    verifyOrPin(host, port, key)
      .then((result) => {
        if (result.status === "mismatch") {
          console.warn(
            `[ssh] host-key mismatch for ${safeHost}: pinned ${safeLog(result.expectedKeyType)}, presented ${safeLog(result.presentedKeyType)}. Refusing to connect. Remove the row in ssh_host_keys to re-pin.`,
          )
          verify(false)
          return
        }
        if (result.status === "pinned-new") {
          console.log(`[ssh] pinned ${safeLog(result.keyType)} host key for ${safeHost} (first contact)`)
        }
        verify(true)
      })
      .catch((err) => {
        console.error(`[ssh] host-key verification failed for ${safeHost}: ${safeLog(err?.message || String(err))}`)
        verify(false)
      })
  }
}
