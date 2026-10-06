// Pure SSH endpoint rules, safe to import from client components (no server
// imports). Server-side resolution lives in ./node-endpoint.

/**
 * Where a node's SSH host came from: the per-node override stored on
 * ManagedHost, or the address Proxmox reports for the node.
 */
export type SshAddressSource = "override" | "proxmox"

export interface NodeSshEndpoint {
  host: string
  port: number
  source: SshAddressSource
}

/**
 * What the SSH executors accept: a bare host (the connection port applies) or
 * a resolved endpoint carrying its own port.
 */
export type SshTarget = string | { host: string; port?: number | null }

/** Per-node override as stored on ManagedHost. */
export interface NodeSshOverride {
  sshAddress?: string | null
  sshPort?: number | null
}

export const DEFAULT_SSH_PORT = 22

/** A TCP port in 1..65535, or null for anything else (empty, 0, NaN, text). */
export function normalizeSshPort(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null
  const n = typeof value === "number" ? value : Number(String(value).trim())
  if (!Number.isInteger(n) || n < 1 || n > 65535) return null
  return n
}

/** A trimmed address, or null when empty. */
export function normalizeSshAddress(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed || null
}

/**
 * Pure resolution rule shared by every SSH consumer.
 * Host: node override address, else the Proxmox-reported address.
 * Port: node override port, else the connection port, else 22.
 */
export function pickNodeSshEndpoint(input: {
  reportedHost: string
  connSshPort?: number | null
  override?: NodeSshOverride | null
}): NodeSshEndpoint {
  const overrideHost = normalizeSshAddress(input.override?.sshAddress)
  const port =
    normalizeSshPort(input.override?.sshPort) ??
    normalizeSshPort(input.connSshPort) ??
    DEFAULT_SSH_PORT

  return overrideHost
    ? { host: overrideHost, port, source: "override" }
    : { host: input.reportedHost, port, source: "proxmox" }
}

/**
 * Endpoint of a node from its ManagedHost row alone (stored IP as the reported
 * address), for callers that iterate the rows of a connection.
 */
export function managedHostSshEndpoint(
  host: { ip?: string | null } & NodeSshOverride,
  connSshPort?: number | null,
): NodeSshEndpoint {
  return pickNodeSshEndpoint({ reportedHost: host.ip ?? "", connSshPort, override: host })
}

/** Host part of an SSH target. */
export function sshTargetHost(target: SshTarget): string {
  return typeof target === "string" ? target : target.host
}

/** "host:port" (IPv6 bracketed) when the port is known, else the bare host. */
export function formatSshEndpoint(target: SshTarget): string {
  const host = sshTargetHost(target)
  const port = typeof target === "string" ? null : normalizeSshPort(target.port)
  if (port === null) return host
  return host.includes(":") ? `[${host}]:${port}` : `${host}:${port}`
}

/** Per-node override in the shape the orchestrator expects in `ssh_overrides`. */
export interface OrchestratorSshOverride {
  address: string
  port?: number
}

/**
 * Build the `ssh_overrides` map sent to the orchestrator from ManagedHost rows.
 * Only nodes with an address or a port override appear; an empty address means
 * "keep the Proxmox-reported address", an omitted port means "connection port".
 */
export function buildOrchestratorSshOverrides(
  hosts: Array<{ node: string } & NodeSshOverride>,
): Record<string, OrchestratorSshOverride> {
  const out: Record<string, OrchestratorSshOverride> = {}
  for (const h of hosts) {
    const address = normalizeSshAddress(h.sshAddress)
    const port = normalizeSshPort(h.sshPort)
    if (!address && port === null) continue
    out[h.node] = port === null ? { address: address ?? "" } : { address: address ?? "", port }
  }
  return out
}

/**
 * SSH port for a target handed to an executor that only knows the connection.
 * A resolved endpoint carries its port. A bare host is matched against the
 * connection's ManagedHost rows (override address, else stored IP): when every
 * matching row agrees on a port override, that port applies. Several nodes
 * behind one address with distinct ports cannot be told apart from the host
 * alone, so the connection port applies there; such callers pass an endpoint.
 */
export async function resolveSshTargetPort(
  db: any,
  connectionId: string,
  target: SshTarget,
  connSshPort: number | null | undefined,
): Promise<number> {
  const fallback = normalizeSshPort(connSshPort) ?? DEFAULT_SSH_PORT
  if (typeof target !== "string") return normalizeSshPort(target.port) ?? fallback

  const host = normalizeSshAddress(target)
  if (!host || !db?.managedHost?.findMany) return fallback
  try {
    const rows: Array<{ sshAddress: string | null; ip: string | null; sshPort: number | null }> =
      await db.managedHost.findMany({
        where: { connectionId, OR: [{ sshAddress: host }, { sshAddress: null, ip: host }] },
        select: { sshAddress: true, ip: true, sshPort: true },
      })
    const ports = new Set((rows || []).map(r => normalizeSshPort(r.sshPort)))
    if (ports.size !== 1) return fallback
    const [only] = [...ports]
    return only ?? fallback
  } catch {
    return fallback
  }
}
