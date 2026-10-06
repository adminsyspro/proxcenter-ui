import { pveFetch } from "@/lib/proxmox/client"
import { pickNodeSshEndpoint, type NodeSshEndpoint } from "@/lib/ssh/node-endpoint-core"

type PveConn = { baseUrl: string; apiToken: string; insecureDev: boolean; id: string }

/** Wait for a PVE task to complete */
export async function waitForPveTask(conn: PveConn, node: string, upid: string, timeoutMs = 300000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const status = await pveFetch<any>(
      conn,
      `/nodes/${encodeURIComponent(node)}/tasks/${encodeURIComponent(upid)}/status`
    )
    if (status?.status === "stopped") {
      if (status.exitstatus === "OK") return
      throw new Error(`PVE task failed: ${status.exitstatus || "unknown error"}`)
    }
    await new Promise(r => setTimeout(r, 3000))
  }
  throw new Error(`PVE task timed out after ${timeoutMs / 1000}s`)
}

/**
 * Find the SSH host and port of a Proxmox node for a migration.
 * Host: ManagedHost.sshAddress, else the stored IP, else the baseUrl hostname.
 * Port: ManagedHost.sshPort, else the connection port, else 22.
 */
export async function getNodeSshEndpointForMigration(db: any, connectionId: string, nodeName: string, baseUrl: string): Promise<NodeSshEndpoint> {
  const host = await db.managedHost.findFirst({
    where: { connectionId, node: nodeName, enabled: true },
    select: { ip: true, sshAddress: true, sshPort: true },
  })
  const conn = db.connection?.findUnique
    ? await db.connection.findUnique({ where: { id: connectionId }, select: { sshPort: true } }).catch(() => null)
    : null
  let reportedHost = host?.ip || ""
  if (!reportedHost && !host?.sshAddress?.trim()) {
    try {
      reportedHost = new URL(baseUrl).hostname
    } catch {
      throw new Error(`Cannot determine IP for node ${nodeName}`)
    }
  }
  return pickNodeSshEndpoint({ reportedHost, connSshPort: conn?.sshPort, override: host })
}

/**
 * Find the IP address of a Proxmox node for SSH access.
 * Tries managed hosts first, then extracts from baseUrl.
 */
export async function getNodeIpForMigration(db: any, connectionId: string, nodeName: string, baseUrl: string): Promise<string> {
  return (await getNodeSshEndpointForMigration(db, connectionId, nodeName, baseUrl)).host
}
