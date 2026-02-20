import { Client } from "ssh2"
import { prisma } from "@/lib/db/prisma"
import { decryptSecret } from "@/lib/crypto/secret"

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || "http://localhost:8080"

export interface SSHResult {
  success: boolean
  output?: string
  error?: string
}

/**
 * Execute an SSH command with orchestrator-first, ssh2-fallback strategy.
 *
 * 1. Try the Go orchestrator POST /api/v1/ssh/exec
 * 2. On network error (ECONNREFUSED, fetch failure) → direct ssh2 execution
 */
export async function executeSSH(
  connectionId: string,
  nodeIp: string,
  command: string
): Promise<SSHResult> {
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

  if (!connection?.sshEnabled) {
    return { success: false, error: "SSH not enabled for this connection" }
  }

  const port = connection.sshPort || 22
  const user = connection.sshUser || "root"

  // Decrypt credentials
  let key: string | undefined
  let password: string | undefined
  let passphrase: string | undefined

  if (connection.sshKeyEnc) {
    try {
      key = decryptSecret(connection.sshKeyEnc)
    } catch {
      return { success: false, error: "Failed to decrypt SSH key" }
    }
  }

  if (connection.sshPassEnc) {
    try {
      const decrypted = decryptSecret(connection.sshPassEnc)
      if (connection.sshAuthMethod === "key") {
        passphrase = decrypted
      } else {
        password = decrypted
      }
    } catch {
      // Ignore passphrase decryption errors
    }
  }

  // 1. Try orchestrator
  try {
    const body: Record<string, unknown> = { host: nodeIp, port, user, command }
    if (key) body.key = key
    if (password) body.password = password
    if (passphrase) body.passphrase = passphrase

    const res = await fetch(`${ORCHESTRATOR_URL}/api/v1/ssh/exec`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })

    if (res.ok) {
      const data = await res.json()
      console.log(`[ssh] executed via orchestrator on ${nodeIp}`)
      return { success: true, output: data.output }
    }

    const err = await res.json().catch(() => ({}))
    return { success: false, error: err?.error || res.statusText }
  } catch {
    // Orchestrator unreachable – fall through to ssh2
    console.log(`[ssh] orchestrator unavailable, falling back to ssh2 for ${nodeIp}`)
  }

  // 2. Fallback: direct ssh2
  return executeSSHDirect({ host: nodeIp, port, user, key, password, passphrase, command })
}

/**
 * Execute a command over SSH using the ssh2 library directly.
 */
export function executeSSHDirect(opts: {
  host: string
  port: number
  user: string
  key?: string
  password?: string
  passphrase?: string
  command: string
}): Promise<SSHResult> {
  return new Promise((resolve) => {
    const conn = new Client()
    const timeout = setTimeout(() => {
      conn.end()
      resolve({ success: false, error: "SSH connection timeout (30s)" })
    }, 30_000)

    conn.on("ready", () => {
      conn.exec(opts.command, (err, stream) => {
        if (err) {
          clearTimeout(timeout)
          conn.end()
          resolve({ success: false, error: err.message })
          return
        }

        let stdout = ""
        let stderr = ""

        stream.on("data", (data: Buffer) => {
          stdout += data.toString()
        })
        stream.stderr.on("data", (data: Buffer) => {
          stderr += data.toString()
        })
        stream.on("close", (code: number) => {
          clearTimeout(timeout)
          conn.end()
          if (code === 0 || code === null) {
            console.log(`[ssh] executed via ssh2 on ${opts.host}`)
            resolve({ success: true, output: stdout.trim() })
          } else {
            resolve({ success: false, error: stderr.trim() || `Exit code ${code}` })
          }
        })
      })
    })

    conn.on("error", (err) => {
      clearTimeout(timeout)
      resolve({ success: false, error: err.message })
    })

    const connectConfig: Record<string, unknown> = {
      host: opts.host,
      port: opts.port,
      username: opts.user,
      readyTimeout: 30_000,
    }

    if (opts.key) {
      connectConfig.privateKey = opts.key
      if (opts.passphrase) connectConfig.passphrase = opts.passphrase
    } else if (opts.password) {
      connectConfig.password = opts.password
    }

    conn.connect(connectConfig as any)
  })
}
