import { NextResponse } from "next/server"

import { getSessionPrisma } from "@/lib/tenant"
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
    const prisma = await getSessionPrisma()
    const params = await Promise.resolve(ctx.params)
    const id = (params as any)?.id

    if (!id) {
      return NextResponse.json({ error: "Missing params.id" }, { status: 400 })
    }

    // RBAC: Check connection.manage permission
    const denied = await checkPermission(PERMISSIONS.CONNECTION_MANAGE, "connection", id)
    if (denied) return denied

    // Optional form overrides: allow testing SSH against unsaved edits in
    // the connection dialog. Missing fields fall back to the stored DB
    // values so users can test without re-entering an already-configured
    // key/password.
    let body: any = null

    try {
      const text = await req.text()

      if (text) body = JSON.parse(text)
    } catch {
      body = null
    }

    // Get connection with SSH credentials from database
    const connection = await prisma.connection.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        type: true,
        baseUrl: true,
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

    const effectiveSshEnabled = typeof body?.sshEnabled === 'boolean' ? body.sshEnabled : connection.sshEnabled
    const effectiveSshPort = Number(body?.sshPort) > 0 ? Number(body.sshPort) : (connection.sshPort || 22)
    const effectiveSshUser = (typeof body?.sshUser === 'string' && body.sshUser.trim()) ? body.sshUser.trim() : (connection.sshUser || 'root')

    const effectiveAuthMethod = (body?.sshAuthMethod === 'key' || body?.sshAuthMethod === 'password')
      ? body.sshAuthMethod
      : connection.sshAuthMethod

    if (!effectiveSshEnabled) {
      return NextResponse.json({
        success: false,
        error: "SSH is not enabled for this connection"
      }, { status: 400 })
    }

    // Resolve SSH credentials: prefer form-provided values, fall back to
    // stored (decrypted) values. Only fall back when the stored auth method
    // matches the effective auth method, to avoid feeding a stored
    // passphrase to a password login (or vice versa).
    let sshKey: string | undefined
    let sshPassword: string | undefined
    let sshPassphrase: string | undefined

    const bodyKey = typeof body?.sshKey === 'string' && body.sshKey.trim() ? body.sshKey : undefined
    const bodyPassword = typeof body?.sshPassword === 'string' && body.sshPassword ? body.sshPassword : undefined
    const bodyPassphrase = typeof body?.sshPassphrase === 'string' && body.sshPassphrase ? body.sshPassphrase : undefined

    if (effectiveAuthMethod === 'key') {
      if (bodyKey) {
        sshKey = bodyKey
      } else if (connection.sshKeyEnc && connection.sshAuthMethod === 'key') {
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

      if (bodyPassphrase) {
        sshPassphrase = bodyPassphrase
      } else if (!bodyKey && connection.sshPassEnc && connection.sshAuthMethod === 'key') {
        try {
          sshPassphrase = decryptSecret(connection.sshPassEnc)
        } catch (e: any) {
          console.error('[test-ssh] Failed to decrypt SSH passphrase:', e)
        }
      }
    } else if (effectiveAuthMethod === 'password') {
      if (bodyPassword) {
        sshPassword = bodyPassword
      } else if (connection.sshPassEnc && connection.sshAuthMethod === 'password') {
        try {
          sshPassword = decryptSecret(connection.sshPassEnc)
        } catch (e: any) {
          console.error('[test-ssh] Failed to decrypt SSH password:', e)
        }
      }
    }

    if (effectiveAuthMethod === 'key' && !sshKey) {
      return NextResponse.json({
        success: false,
        error: "Missing SSH private key. Enter a key in the form, or save the connection first."
      }, { status: 400 })
    }

    if (effectiveAuthMethod === 'password' && !sshPassword) {
      return NextResponse.json({
        success: false,
        error: "Missing SSH password. Enter a password in the form, or save the connection first."
      }, { status: 400 })
    }

    // For non-PVE connections (VMware ESXi, XCP-ng), test SSH directly to the host
    if (connection.type !== 'pve' && connection.type !== 'pbs') {
      const host = connection.baseUrl.replace(/^https?:\/\//, '').replace(/[:\/].*$/, '')
      const port = effectiveSshPort
      const user = effectiveSshUser

      try {
        const result = await executeSSHDirect({
          host,
          port,
          user,
          key: sshKey,
          password: sshPassword,
          passphrase: sshPassphrase,
          command: 'hostname',
        })

        return NextResponse.json({
          success: result.success,
          nodes: [{
            node: connection.name,
            ip: host,
            status: result.success ? 'ok' : 'error',
            error: result.success ? undefined : result.error,
          }],
        })
      } catch (e: any) {
        return NextResponse.json({
          success: false,
          nodes: [{
            node: connection.name,
            ip: host,
            status: 'error',
            error: e.message,
          }],
        })
      }
    }

    // 1. Try orchestrator first (PVE/PBS only)
    try {
      const sshCredentials: Record<string, unknown> = {
        sshEnabled: effectiveSshEnabled,
        sshPort: effectiveSshPort,
        sshUser: effectiveSshUser,
        sshAuthMethod: effectiveAuthMethod,
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

    // Fetch SSH address overrides
    const managedHosts = await prisma.managedHost.findMany({
      where: { connectionId: id },
      select: { node: true, sshAddress: true },
    })
    const sshOverrides = new Map(
      managedHosts.filter(h => h.sshAddress).map(h => [h.node, h.sshAddress!])
    )

    const port = effectiveSshPort
    const user = effectiveSshUser

    const results = await Promise.all(
      (nodes || []).map(async (n: any) => {
        const nodeName = n.node || n.name
        if (!nodeName) return null

        const ip = sshOverrides.get(nodeName) || await getNodeIp(conn, nodeName)

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
