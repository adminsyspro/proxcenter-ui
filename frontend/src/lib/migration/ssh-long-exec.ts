/**
 * ssh2 session for the long node-side commands of the migration pipelines
 * (`qemu-img convert` of a multi-terabyte disk), which outlive the budget of
 * the regular executeSSH relay. One copy for the ESXi and XCP-ng pipelines,
 * built on the same connect configuration as lib/ssh/exec: keepalives and
 * trust-on-first-use host-key verification, so a node whose host key changed
 * since it was pinned is refused here as everywhere else.
 */
import { decryptSecret } from "@/lib/crypto/secret"
import { buildConnectConfig } from "@/lib/ssh/exec"
import { resolveSshTargetPort, sshTargetHost, type SshTarget } from "@/lib/ssh/node-endpoint-core"

export interface LongSshResult {
  success: boolean
  output?: string
  error?: string
}

type ConnectionSshRow = {
  sshEnabled: boolean
  sshPort: number | null
  sshUser: string | null
  sshAuthMethod: string | null
  sshKeyEnc: string | null
  sshPassEnc: string | null
  sshUseSudo: boolean
}

/**
 * Run `command` on `target` over ssh2 with its own timeout (milliseconds).
 * `db` is the tenant Prisma client of the job (typed loosely, like the port
 * resolver it is handed to: the pipelines carry extended clients).
 */
export async function executeSSHWithTimeout(
  db: any,
  connectionId: string,
  target: SshTarget,
  command: string,
  timeoutMs: number,
): Promise<LongSshResult> {
  const connection: ConnectionSshRow | null = await db.connection.findUnique({
    where: { id: connectionId },
    select: {
      sshEnabled: true, sshPort: true, sshUser: true,
      sshAuthMethod: true, sshKeyEnc: true, sshPassEnc: true, sshUseSudo: true,
    },
  })

  if (!connection?.sshEnabled) {
    return { success: false, error: "SSH not enabled for this connection" }
  }

  const { Client } = await import("ssh2")

  const port = await resolveSshTargetPort(db, connectionId, target, connection.sshPort ?? 22)
  const user = connection.sshUser || "root"

  let key: string | undefined
  let password: string | undefined
  let passphrase: string | undefined

  const authMethod = connection.sshAuthMethod || (connection.sshKeyEnc ? "key" : "password")
  if (authMethod === "key" && connection.sshKeyEnc) {
    key = decryptSecret(connection.sshKeyEnc)
    if (connection.sshPassEnc) {
      try { passphrase = decryptSecret(connection.sshPassEnc) } catch { /* a key without passphrase */ }
    }
  } else if (connection.sshPassEnc) {
    password = decryptSecret(connection.sshPassEnc)
  }

  const finalCommand = connection.sshUseSudo ? `sudo ${command}` : command
  const host = sshTargetHost(target)

  return new Promise((resolve) => {
    const conn = new Client()
    let mismatch: string | undefined
    const timeout = setTimeout(() => {
      conn.end()
      resolve({ success: false, error: `SSH timeout after ${timeoutMs / 1000}s` })
    }, timeoutMs)

    conn.on("ready", () => {
      conn.exec(finalCommand, (err, stream) => {
        if (err) { clearTimeout(timeout); conn.end(); resolve({ success: false, error: err.message }); return }

        let stdout = ""
        let stderr = ""
        stream.on("data", (data: Buffer) => { stdout += data.toString() })
        stream.stderr.on("data", (data: Buffer) => { stderr += data.toString() })
        stream.on("close", (code: number) => {
          clearTimeout(timeout)
          conn.end()
          if (code === 0 || code === null) {
            resolve({ success: true, output: stdout.trim() })
          } else {
            resolve({ success: false, error: stderr.trim() || `Exit code ${code}` })
          }
        })
      })
    })

    conn.on("error", (err) => { clearTimeout(timeout); resolve({ success: false, error: mismatch ?? err.message }) })

    // Same keepalive and host-key policy as every other ssh2 session of the
    // app; a pinned key that no longer matches surfaces its own message.
    const connectConfig = buildConnectConfig({ host, port, user, key, password, passphrase, onMismatch: m => { mismatch = m } })
    conn.connect(connectConfig as Parameters<typeof conn.connect>[0])
  })
}
