import { NextResponse } from "next/server"

import { prisma } from "@/lib/db/prisma"
import { decryptSecret } from "@/lib/crypto/secret"

export const runtime = "nodejs"

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || "http://localhost:8080"

export async function POST(req: Request) {
  try {
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

    // Build SSH credentials if enabled
    let sshCredentials: any = null
    
    if (connection.sshEnabled) {
      sshCredentials = {
        sshEnabled: connection.sshEnabled,
        sshPort: connection.sshPort || 22,
        sshUser: connection.sshUser || "root",
        sshAuthMethod: connection.sshAuthMethod,
      }

      if (connection.sshKeyEnc) {
        try {
          sshCredentials.sshKey = decryptSecret(connection.sshKeyEnc)
        } catch (e: any) {
          console.error("Failed to decrypt SSH key:", e)
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
          console.error("Failed to decrypt SSH passphrase/password:", e)
        }
      }
    }

    // Add SSH credentials to the config
    const payload = {
      ...body,
      config: {
        ...body.config,
        ssh_credentials: sshCredentials,
      },
    }

    const response = await fetch(`${ORCHESTRATOR_URL}/api/v1/rolling-updates/preflight`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    })

    const data = await response.json()

    if (!response.ok) {
      return NextResponse.json(
        { error: data.error || "Preflight check failed" },
        { status: response.status }
      )
    }

    return NextResponse.json({ data })
  } catch (error: any) {
    console.error("Error in rolling update preflight:", error)
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    )
  }
}
