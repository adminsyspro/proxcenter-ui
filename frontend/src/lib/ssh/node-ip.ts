import { pveFetch } from "@/lib/proxmox/client"
import { resolveManagementIp } from "@/lib/proxmox/resolveManagementIp"
import { prisma } from "@/lib/db/prisma"

/**
 * Resolve the management IP of a Proxmox node.
 *
 * Priority:
 *  0. ManagedHost.sshAddress override (user-configured)
 *  1. Node network interfaces via Proxmox API (gateway = management)
 *  2. DNS resolution of the node name
 *  3. Connection host (stripped of protocol/port)
 *  4. Node name as-is (last resort)
 */
export async function getNodeIp(conn: any, nodeName: string): Promise<string> {
  // 0. Check for user-configured SSH address override
  try {
    const connId = conn.id || conn.connectionId
    if (connId) {
      const host = await prisma.managedHost.findUnique({
        where: { connectionId_node: { connectionId: connId, node: nodeName } },
        select: { sshAddress: true },
      })
      if (host?.sshAddress) return host.sshAddress
    }
  } catch {}

  // 1. Try node network interfaces (gateway = management)
  try {
    const networks = await pveFetch<any[]>(conn, `/nodes/${encodeURIComponent(nodeName)}/network`)
    const ip = resolveManagementIp(networks)
    if (ip) return ip
  } catch {}

  // 2. Try DNS resolution of the node name
  try {
    const dns = await import("dns")
    const resolved = await dns.promises.resolve4(nodeName)
    if (resolved?.[0]) return resolved[0]
  } catch {}

  // 3. Fallback to connection host
  try {
    const host = conn.host || conn.baseUrl || ""
    const cleanHost = host
      .replace(/^https?:\/\//, "")
      .replace(/:\d+$/, "")
      .replace(/\/.*$/, "")
    if (cleanHost && !cleanHost.includes("/")) return cleanHost
  } catch {}

  return nodeName
}
