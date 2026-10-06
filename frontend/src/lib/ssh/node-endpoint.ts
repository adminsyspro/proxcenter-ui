import { prisma } from "@/lib/db/prisma"
import { getNodeIp } from "@/lib/ssh/node-ip"
import {
  normalizeSshAddress,
  normalizeSshPort,
  pickNodeSshEndpoint,
  type NodeSshEndpoint,
  type NodeSshOverride,
} from "@/lib/ssh/node-endpoint-core"

export * from "@/lib/ssh/node-endpoint-core"

/**
 * Resolve the SSH host and port of one Proxmox node.
 *
 * `managedHost` may be passed when the caller already loaded the row (null
 * means "no row"); otherwise it is read here. The connection port is read from
 * `conn.sshPort` when present, else from the connection row.
 */
export async function resolveNodeSshEndpoint(
  conn: any,
  node: string,
  managedHost?: NodeSshOverride | null,
): Promise<NodeSshEndpoint> {
  const connId: string | undefined = conn?.id || conn?.connectionId

  let override = managedHost
  if (override === undefined) {
    override = null
    if (connId) {
      try {
        override = await prisma.managedHost.findUnique({
          where: { connectionId_node: { connectionId: connId, node } },
          select: { sshAddress: true, sshPort: true },
        })
      } catch {
        override = null
      }
    }
  }

  let connSshPort: number | null = normalizeSshPort(conn?.sshPort)
  if (connSshPort === null && connId) {
    try {
      const row = await prisma.connection.findUnique({ where: { id: connId }, select: { sshPort: true } })
      connSshPort = normalizeSshPort(row?.sshPort)
    } catch {
      connSshPort = null
    }
  }

  const overrideHost = normalizeSshAddress(override?.sshAddress)
  const reportedHost = overrideHost ? "" : await getNodeIp(conn, node, { skipOverride: true })

  return pickNodeSshEndpoint({ reportedHost, connSshPort, override })
}
