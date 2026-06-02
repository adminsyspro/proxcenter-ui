import { pveFetch } from "@/lib/proxmox/client"
import { resolveManagementIp } from "@/lib/proxmox/resolveManagementIp"
import { prisma } from "@/lib/db/prisma"
import { isPrivateIp, extractHostname } from "@/lib/net/ip"

/**
 * Resolve the SSH-reachable address of a Proxmox node.
 *
 * Priority:
 *  0. ManagedHost.sshAddress override (user-configured) — always wins.
 *  1. ManagedHost.ip (stored mgmt IP).
 *  2. Node network interfaces via Proxmox API (gateway = management).
 *  3. DNS resolution of the node name.
 *  4. Connection host (skipped when behindProxy).
 *  5. Node name as-is (last resort).
 *
 * Resolve-then-replace: a candidate from steps 1-3 that is a PROVEN-PRIVATE IP
 * is replaced by the connection host, but ONLY for a standalone connection
 * reached over a routable (public) address — a private node IP is then
 * unreachable from here. Gated to a single-node connection so a cluster node is
 * never routed to the connection host. Identity is re-verified before any
 * destructive op (see verify-node-target.ts). Fail-closed on any ambiguity.
 */
export async function getNodeIp(conn: any, nodeName: string): Promise<string> {
  const connId = conn.id || conn.connectionId

  // 0. Explicit override wins; also tells us a row exists for THIS node.
  let host: { sshAddress: string | null; ip: string | null } | null = null
  try {
    if (connId) {
      host = await prisma.managedHost.findUnique({
        where: { connectionId_node: { connectionId: connId, node: nodeName } },
        select: { sshAddress: true, ip: true },
      })
      if (host?.sshAddress) return host.sshAddress
    }
  } catch {}

  const connHost = extractHostname(conn.host || conn.baseUrl || "")
  const connHostRoutable = !!connHost && !conn.behindProxy && !isPrivateIp(connHost)

  // Standalone proof: a row exists for this node (host != null) AND it is the
  // only node (count === 1). Queried only when it could matter. Fail-closed.
  let mayUseConnHost = false
  if (connHostRoutable && host && connId) {
    try {
      mayUseConnHost = (await prisma.managedHost.count({ where: { connectionId: connId } })) === 1
    } catch {
      mayUseConnHost = false
    }
  }

  // 1. Stored management IP.
  if (host?.ip) {
    if (mayUseConnHost && isPrivateIp(host.ip)) return connHost
    return host.ip
  }

  // 2. Node network interfaces (gateway = management).
  try {
    const networks = await pveFetch<any[]>(conn, `/nodes/${encodeURIComponent(nodeName)}/network`)
    const ip = resolveManagementIp(networks)
    if (ip) {
      if (mayUseConnHost && isPrivateIp(ip)) return connHost
      return ip
    }
  } catch {}

  // 3. DNS resolution of the node name.
  try {
    const dns = await import("dns")
    const resolved = await dns.promises.resolve4(nodeName)
    if (resolved?.[0]) {
      if (mayUseConnHost && isPrivateIp(resolved[0])) return connHost
      return resolved[0]
    }
  } catch {}

  // 4. Fallback to connection host (skip if behind proxy/LB).
  if (!conn.behindProxy && connHost) return connHost

  // 5. Node name as-is.
  return nodeName
}
