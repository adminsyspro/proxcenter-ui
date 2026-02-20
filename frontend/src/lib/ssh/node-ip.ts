import { pveFetch } from "@/lib/proxmox/client"
import { resolveManagementIp } from "@/lib/proxmox/resolveManagementIp"

/**
 * Resolve the management IP of a Proxmox node.
 *
 * Priority:
 *  1. Node network interfaces via Proxmox API (gateway = management)
 *  2. DNS resolution of the node name
 *  3. Connection host (stripped of protocol/port)
 *  4. Node name as-is (last resort)
 */
export async function getNodeIp(conn: any, nodeName: string): Promise<string> {
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
