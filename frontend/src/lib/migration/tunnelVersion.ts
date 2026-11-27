import { pveFetch, type ProxmoxClientOptions } from '@/lib/proxmox/client'

/**
 * Proxmox VE 9.3 moved the remote migration tunnel to version 3 (it carries
 * the guest identity). A source on the new tunnel refuses a target on an
 * older one: "Remote tunnel endpoint too old, upgrade required", and only
 * once the migration task runs. The tunnel comes with qemu-server for VMs and
 * pve-container for containers; the reverse direction (old source, new
 * target) still works.
 */
export const TUNNEL_V3 = {
  qemu: { pkg: 'qemu-server', version: '9.2.21' },
  lxc: { pkg: 'pve-container', version: '6.1.25' },
} as const

export type GuestKind = keyof typeof TUNNEL_V3

/** The leading dotted number of a Debian version ("9.2.24", "6.1.28~bpo1" → "6.1.28"). */
function plainVersion(v: unknown): string | null {
  const m = typeof v === 'string' ? /^\d+(\.\d+)*/.exec(v.trim()) : null

  return m ? m[0] : null
}

/** Dotted versions compared part by part, missing parts as 0: <0, 0 or >0. */
export function compareDotted(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff
  }

  return 0
}

// The migration dialog re-runs its check on every field change: one
// `apt/versions` read per node and package for a few minutes is enough.
const CACHE_TTL_MS = 5 * 60 * 1000
const cache = new Map<string, { at: number; version: string | null }>()

/** Installed version of `pkg` on a node, null when it cannot be read (no Sys.Audit, node down). */
export async function nodePackageVersion(conn: ProxmoxClientOptions, node: string, pkg: string): Promise<string | null> {
  const key = `${conn.id ?? ""}|${conn.baseUrl}|${node}|${pkg}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.version
  const version = await readPackageVersion(conn, node, pkg)
  // An unreadable node is asked again next time.
  if (version) cache.set(key, { at: Date.now(), version })

  return version
}

/** Test hook. */
export function clearTunnelVersionCache(): void {
  cache.clear()
}

async function readPackageVersion(conn: ProxmoxClientOptions, node: string, pkg: string): Promise<string | null> {
  try {
    const rows = await pveFetch<Array<{ Package?: string; Version?: string; OldVersion?: string }>>(
      conn,
      `/nodes/${encodeURIComponent(node)}/apt/versions`,
    )
    const row = Array.isArray(rows) ? rows.find(r => r?.Package === pkg) : undefined

    // `Version` is the candidate once an update is known; the installed one
    // is then `OldVersion` (both equal otherwise).
    return plainVersion(row?.OldVersion || row?.Version)
  } catch {
    return null
  }
}

export type TunnelVerdict = {
  pkg: string
  required: string
  sourceVersion: string
  targetVersion: string
}

/**
 * Pure verdict: refused when the source runs the v3 tunnel and the target
 * does not. Null when it passes or when a version is unknown (never block on
 * a reading we did not get).
 */
export function tunnelTooOld(kind: GuestKind, sourceVersion: string | null, targetVersion: string | null): TunnelVerdict | null {
  if (!sourceVersion || !targetVersion) return null
  const { pkg, version: required } = TUNNEL_V3[kind]
  if (compareDotted(sourceVersion, required) < 0) return null
  if (compareDotted(targetVersion, required) >= 0) return null

  return { pkg, required, sourceVersion, targetVersion }
}

/** Reads both nodes and returns the refusal PVE would give, or null. */
export async function checkMigrationTunnel(
  kind: GuestKind,
  source: { conn: ProxmoxClientOptions; node: string },
  target: { conn: ProxmoxClientOptions; node: string },
): Promise<TunnelVerdict | null> {
  const { pkg } = TUNNEL_V3[kind]
  const [sourceVersion, targetVersion] = await Promise.all([
    nodePackageVersion(source.conn, source.node, pkg),
    nodePackageVersion(target.conn, target.node, pkg),
  ])

  return tunnelTooOld(kind, sourceVersion, targetVersion)
}

/** English message, also used in API errors. */
export function tunnelTooOldMessage(v: TunnelVerdict): string {
  return `The target node runs ${v.pkg} ${v.targetVersion}: the source (${v.pkg} ${v.sourceVersion}, Proxmox VE 9.3) migrates only to ${v.pkg} ${v.required} or later. Upgrade the target cluster to Proxmox VE 9.3 first.`
}
