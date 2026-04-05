import { pveFetch } from "@/lib/proxmox/client"
import { resolveManagementIp } from "@/lib/proxmox/resolveManagementIp"
import { getSessionPrisma } from "@/lib/tenant"

/**
 * Resolve the management IP of a Proxmox node.
 *
 * Priority:
 *  0. ManagedHost.sshAddress override (user-configured)
 *  1. ManagedHost.ip (management IP already resolved and stored in DB)
 *  2. Node network interfaces via Proxmox API (gateway = management)
 *  3. DNS resolution of the node name
 *  4. Connection host (skipped when behindProxy to avoid returning LB IP)
 *  5. Node name as-is (last resort)
 */
export async function getNodeIp(conn: any, nodeName: string): Promise<string> {
  const connId = conn.id || conn.connectionId

  // 0. Check for user-configured SSH address override
  // 1. Check for stored management IP from DB
  try {
    if (connId) {
      const prisma = await getSessionPrisma()
      const host = await prisma.managedHost.findUnique({
        where: { connectionId_node: { connectionId: connId, node: nodeName } },
        select: { sshAddress: true, ip: true },
      })
      if (host?.sshAddress) return host.sshAddress
      if (host?.ip) return host.ip
    }
  } catch {}

  // 2. Try node network interfaces (gateway = management)
  try {
    const networks = await pveFetch<any[]>(conn, `/nodes/${encodeURIComponent(nodeName)}/network`)
    const ip = resolveManagementIp(networks)
    if (ip) return ip
  } catch {}

  // 3. Try DNS resolution of the node name
  try {
    const dns = await import("dns")
    const resolved = await dns.promises.resolve4(nodeName)
    if (resolved?.[0]) return resolved[0]
  } catch {}

  // 4. Fallback to connection host (skip if behind proxy/LB — the LB IP is useless for SSH)
  if (!conn.behindProxy) {
    try {
      const host = conn.host || conn.baseUrl || ""
      const cleanHost = host
        .replace(/^https?:\/\//, "")
        .replace(/:\d+$/, "")
        .replace(/\/.*$/, "")
      if (cleanHost && !cleanHost.includes("/")) return cleanHost
    } catch {}
  }

  return nodeName
}
