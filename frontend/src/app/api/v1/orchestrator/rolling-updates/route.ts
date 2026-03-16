import { NextResponse } from "next/server"

import { getSessionPrisma, getTenantConnectionIds } from "@/lib/tenant"
import { decryptSecret } from "@/lib/crypto/secret"

export const runtime = "nodejs"

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || "http://localhost:8080"

// GET /api/v1/orchestrator/rolling-updates — tenant-filtered
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const connectionId = searchParams.get("connection_id")

    // Verify connection belongs to tenant if specified
    const tenantConnectionIds = await getTenantConnectionIds()
    if (connectionId && !tenantConnectionIds.has(connectionId)) {
      return NextResponse.json({ error: 'Connection not found' }, { status: 404 })
    }

    let url = `${ORCHESTRATOR_URL}/api/v1/rolling-updates`
    if (connectionId) {
      url += `?connection_id=${encodeURIComponent(connectionId)}`
    }

    const response = await fetch(url, {
      headers: { "Content-Type": "application/json" },
    })

    const data = await response.json()

    if (!response.ok) {
      return NextResponse.json(
        { error: data.error || "Failed to get rolling updates" },
        { status: response.status }
      )
    }

    // Filter results by tenant connections
    const items = Array.isArray(data) ? data : (data?.data || data)
    if (Array.isArray(items)) {
      const filtered = items.filter((ru: any) => !ru.connection_id || tenantConnectionIds.has(ru.connection_id))
      return NextResponse.json({ data: filtered })
    }

    return NextResponse.json({ data })
  } catch (error: any) {
    if ((error as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
      console.error("Error getting rolling updates:", error)
    }
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}

// POST /api/v1/orchestrator/rolling-updates - Start a new rolling update
export async function POST(req: Request) {
  try {
    const prisma = await getSessionPrisma()
    const body = await req.json()

    const connectionId = body.connection_id

    if (!connectionId) {
      return NextResponse.json(
        { error: "connection_id is required" },
        { status: 400 }
      )
    }

    // Get SSH credentials from database
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

    if (!connection) {
      return NextResponse.json(
        { error: "Connection not found" },
        { status: 404 }
      )
    }

    if (!connection.sshEnabled) {
      return NextResponse.json(
        { error: "SSH is not enabled for this connection. Rolling update requires SSH access." },
        { status: 400 }
      )
    }

    // Fetch per-node SSH address overrides from ManagedHost
    const managedHosts = await prisma.managedHost.findMany({
      where: { connectionId },
      select: { node: true, sshAddress: true },
    })

    const sshOverrides: Record<string, string> = {}
    for (const h of managedHosts) {
      if (h.sshAddress) sshOverrides[h.node] = h.sshAddress
    }

    // Build SSH credentials object with decrypted secrets
    const sshCredentials: any = {
      sshEnabled: connection.sshEnabled,
      sshPort: connection.sshPort || 22,
      sshUser: connection.sshUser || "root",
      sshAuthMethod: connection.sshAuthMethod,
    }

    if (connection.sshKeyEnc) {
      try {
        sshCredentials.sshKey = decryptSecret(connection.sshKeyEnc)
      } catch (e: any) {
        if ((e as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
          console.error("Failed to decrypt SSH key:", e)
        }
        return NextResponse.json(
          { error: "Failed to decrypt SSH credentials" },
          { status: 500 }
        )
      }
    }

    if (connection.sshPassEnc) {
      try {
        const decrypted = decryptSecret(connection.sshPassEnc)
        if (connection.sshAuthMethod === "key") {
          sshCredentials.sshPassphrase = decrypted
        } else {
          sshCredentials.sshPassword = decrypted
        }
      } catch (e: any) {
        if ((e as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
          console.error("Failed to decrypt SSH passphrase/password:", e)
        }
      }
    }

    // Add SSH credentials and overrides to the config
    const payload = {
      ...body,
      config: {
        ...body.config,
        ssh_credentials: sshCredentials,
        ...(Object.keys(sshOverrides).length > 0 && { ssh_overrides: sshOverrides }),
      },
    }

    const response = await fetch(`${ORCHESTRATOR_URL}/api/v1/rolling-updates`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    })

    const data = await response.json()

    if (!response.ok) {
      return NextResponse.json(
        { error: data.error || "Failed to start rolling update" },
        { status: response.status }
      )
    }

    return NextResponse.json({ data })
  } catch (error: any) {
    if ((error as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
      console.error("Error starting rolling update:", error)
    }
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
