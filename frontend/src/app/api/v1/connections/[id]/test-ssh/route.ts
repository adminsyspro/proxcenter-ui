// src/app/api/v1/connections/[id]/test-ssh/route.ts
import { NextResponse } from "next/server"

import { prisma } from "@/lib/db/prisma"
import { decryptSecret } from "@/lib/crypto/secret"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

/**
 * POST /api/v1/connections/[id]/test-ssh
 * 
 * Teste la connexion SSH vers tous les nœuds d'un cluster Proxmox.
 * Requiert que les credentials SSH soient configurés pour cette connexion.
 * 
 * Response:
 * {
 *   success: boolean,
 *   nodes: [
 *     { node: string, ip: string, status: 'ok' | 'error', error?: string }
 *   ]
 * }
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
    const sshCredentials: any = {
      sshEnabled: connection.sshEnabled,
      sshPort: connection.sshPort || 22,
      sshUser: connection.sshUser || 'root',
      sshAuthMethod: connection.sshAuthMethod,
    }

    if (connection.sshKeyEnc) {
      try {
        const decryptedKey = decryptSecret(connection.sshKeyEnc)
        sshCredentials.sshKey = decryptedKey
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
        const decryptedPass = decryptSecret(connection.sshPassEnc)
        if (connection.sshAuthMethod === 'key') {
          sshCredentials.sshPassphrase = decryptedPass
        } else {
          sshCredentials.sshPassword = decryptedPass
        }
      } catch (e: any) {
        console.error('[test-ssh] Failed to decrypt SSH passphrase/password:', e)
      }
    }


    // Call orchestrator to test SSH on all nodes
    const { getOrchestratorClient } = await import("@/lib/orchestrator")
    const orchestrator = getOrchestratorClient()

    if (!orchestrator) {
      return NextResponse.json(
        { error: "Orchestrator not available" },
        { status: 503 }
      )
    }

    // Pass credentials to orchestrator
    const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || 'http://localhost:8080'
    
    // Use AbortController for timeout (2 minutes for SSH tests)
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 120000)
    
    try {
      const res = await fetch(`${ORCHESTRATOR_URL}/api/v1/connections/${id}/test-ssh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sshCredentials),
        signal: controller.signal,
      })
      
      clearTimeout(timeoutId)

      const result = await res.json()

      return NextResponse.json(result)
    } catch (fetchError: any) {
      clearTimeout(timeoutId)
      
      if (fetchError.name === 'AbortError') {
        return NextResponse.json(
          { success: false, error: 'SSH test timeout - took too long' },
          { status: 504 }
        )
      }
      
      throw fetchError
    }
  } catch (e: any) {
    console.error('[test-ssh] Error:', e)
    
    return NextResponse.json(
      { error: e?.message || String(e) },
      { status: 500 }
    )
  }
}
