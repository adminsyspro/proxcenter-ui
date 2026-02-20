import { NextResponse } from "next/server"

import { prisma } from "@/lib/db/prisma"
import { decryptSecret } from "@/lib/crypto/secret"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { getConnectionById } from "@/lib/connections/getConnection"
import { pveFetch } from "@/lib/proxmox/client"
import { getNodeIp } from "@/lib/ssh/node-ip"
import { executeSSHDirect } from "@/lib/ssh/exec"

export const runtime = "nodejs"

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || "http://localhost:8080"

/**
 * POST /api/v1/connections/[id]/test-ssh
 *
 * Test SSH connectivity to all nodes in a Proxmox cluster.
 * Tries the orchestrator first; falls back to direct ssh2 if unavailable.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const params = await Promise.resolve(ctx.params)
    const id = (params as any)?.id

    if (!id) {
      return NextResponse.json({ error: "Missing params.id" }, { status: 400 })
    }

    // RBAC: Check connection.manage permission
    const denied = await checkPermission(PERMISSIONS.CONNECTION_MANAGE, "connection", id)
    if (denied) return denied

    // Get connection with SSH credentials from database
    const connection = await prisma.connection.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        sshEnabled: true,
        sshPort: true,
        sshUser: true,
        sshAuthMethod: true,
        sshKeyEnc: true,
        sshPassEnc: true,
      }
    })

    if (!connection) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 })
    }

    if (!connection.sshEnabled) {
      return NextResponse.json({
        success: false,
        error: "SSH is not enabled for this connection"
      }, { status: 400 })
    }

    // Decrypt SSH credentials
    let sshKey: string | undefined
    let sshPassword: string | undefined
    let sshPassphrase: string | undefined

    if (connection.sshKeyEnc) {
      try {
        sshKey = decryptSecret(connection.sshKeyEnc)
      } catch (e: any) {
        console.error('[test-ssh] Failed to decrypt SSH key:', e)
        return NextResponse.json({
          success: false,
          error: "Failed to decrypt SSH key: " + e.message
        }, { status: 500 })
      }
    }

    if (connection.sshPassEnc) {
      try {
        const decrypted = decryptSecret(connection.sshPassEnc)
        if (connection.sshAuthMethod === 'key') {
          sshPassphrase = decrypted
        } else {
          sshPassword = decrypted
        }
      } catch (e: any) {
        console.error('[test-ssh] Failed to decrypt SSH passphrase/password:', e)
      }
    }

    // 1. Try orchestrator first
    try {
      const sshCredentials: Record<string, unknown> = {
        sshEnabled: connection.sshEnabled,
        sshPort: connection.sshPort || 22,
        sshUser: connection.sshUser || 'root',
        sshAuthMethod: connection.sshAuthMethod,
      }
      if (sshKey) sshCredentials.sshKey = sshKey
      if (sshPassword) sshCredentials.sshPassword = sshPassword
      if (sshPassphrase) sshCredentials.sshPassphrase = sshPassphrase

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 120000)

      const res = await fetch(`${ORCHESTRATOR_URL}/api/v1/connections/${id}/test-ssh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sshCredentials),
        signal: controller.signal,
      })

      clearTimeout(timeoutId)
      const result = await res.json()
      console.log(`[test-ssh] tested via orchestrator`)
      return NextResponse.json(result)
    } catch (fetchError: any) {
      if (fetchError.name === 'AbortError') {
        return NextResponse.json(
          { success: false, error: 'SSH test timeout - took too long' },
          { status: 504 }
        )
      }

      // Orchestrator unavailable – fall through to ssh2 fallback
      console.log(`[test-ssh] orchestrator unavailable, falling back to ssh2`)
    }

    // 2. Fallback: direct ssh2 test on each node
    const conn = await getConnectionById(id)
    if (!conn) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 })
    }

    // Fetch node list from Proxmox API
    let nodes: any[]
    try {
      nodes = await pveFetch<any[]>(conn, '/nodes')
    } catch (e: any) {
      return NextResponse.json({
        success: false,
        error: "Failed to fetch node list from Proxmox: " + e.message
      }, { status: 500 })
    }

    const port = connection.sshPort || 22
    const user = connection.sshUser || 'root'

    const results = await Promise.all(
      (nodes || []).map(async (n: any) => {
        const nodeName = n.node || n.name
        if (!nodeName) return null

        const ip = await getNodeIp(conn, nodeName)

        try {
          const result = await executeSSHDirect({
            host: ip,
            port,
            user,
            key: sshKey,
            password: sshPassword,
            passphrase: sshPassphrase,
            command: 'hostname',
          })

          return {
            node: nodeName,
            ip,
            status: result.success ? 'ok' as const : 'error' as const,
            error: result.success ? undefined : result.error,
          }
        } catch (e: any) {
          return {
            node: nodeName,
            ip,
            status: 'error' as const,
            error: e.message,
          }
        }
      })
    )

    const nodeResults = results.filter(Boolean)
    const allOk = nodeResults.every(r => r!.status === 'ok')

    return NextResponse.json({
      success: allOk,
      nodes: nodeResults,
    })
  } catch (e: any) {
    console.error('[test-ssh] Error:', e)

    return NextResponse.json(
      { error: e?.message || String(e) },
      { status: 500 }
    )
  }
}
