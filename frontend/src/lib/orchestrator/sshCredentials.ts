import { decryptSecret } from "@/lib/crypto/secret"
import { buildOrchestratorSshOverrides } from "@/lib/ssh/node-endpoint-core"

/**
 * SSH access of a connection, in the shape the orchestrator expects for the
 * jobs that run ha-manager or apt on a node (rolling updates, host drains).
 *
 * Secrets are decrypted here, in the API route, and travel to the orchestrator
 * in the request body only: the orchestrator never stores them.
 */
export interface OrchestratorSshCredentials {
  sshEnabled: boolean
  sshPort: number
  sshUser: string
  sshAuthMethod: string | null
  sshKey?: string
  sshPassphrase?: string
  sshPassword?: string
}

export interface OrchestratorSshAccess {
  sshEnabled: boolean
  credentials: OrchestratorSshCredentials | null
  /** Per-node address and port overrides from ManagedHost, { node: { address, port } }. */
  overrides: Record<string, { address?: string; port?: number }>
}

type PrismaLike = {
  connection: { findUnique: (args: any) => Promise<any> }
  managedHost: { findMany: (args: any) => Promise<any[]> }
}

/**
 * Load the SSH credentials and overrides of a connection. Returns null when
 * the connection does not exist. Throws when a stored key cannot be decrypted
 * (the caller answers 500): a drain or an update must not start half-armed.
 */
export async function loadOrchestratorSshAccess(prisma: PrismaLike, connectionId: string): Promise<OrchestratorSshAccess | null> {
  const connection = await prisma.connection.findUnique({
    where: { id: connectionId },
    select: {
      sshEnabled: true,
      sshPort: true,
      sshUser: true,
      sshAuthMethod: true,
      sshKeyEnc: true,
      sshPassEnc: true,
    },
  })

  if (!connection) return null

  const managedHosts = await prisma.managedHost.findMany({
    where: { connectionId },
    select: { node: true, sshAddress: true, sshPort: true },
  })
  const overrides = buildOrchestratorSshOverrides(managedHosts)

  if (!connection.sshEnabled) {
    return { sshEnabled: false, credentials: null, overrides }
  }

  const credentials: OrchestratorSshCredentials = {
    sshEnabled: true,
    sshPort: connection.sshPort || 22,
    sshUser: connection.sshUser || "root",
    sshAuthMethod: connection.sshAuthMethod,
  }

  if (connection.sshKeyEnc) {
    credentials.sshKey = decryptSecret(connection.sshKeyEnc)
  }

  if (connection.sshPassEnc) {
    try {
      const decrypted = decryptSecret(connection.sshPassEnc)
      if (connection.sshAuthMethod === "key") {
        credentials.sshPassphrase = decrypted
      } else {
        credentials.sshPassword = decrypted
      }
    } catch (e: any) {
      // A passphrase that cannot be decrypted is reported, not fatal: the key
      // may well be unencrypted (same tolerance as the rolling update route).
      console.error("Failed to decrypt SSH passphrase/password:", e?.message)
    }
  }

  return { sshEnabled: true, credentials, overrides }
}
