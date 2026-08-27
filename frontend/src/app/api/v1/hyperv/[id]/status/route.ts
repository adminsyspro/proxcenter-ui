import { NextResponse } from "next/server"

import { getSessionPrisma } from "@/lib/tenant"
import { decryptSecret } from "@/lib/crypto/secret"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { HyperVClient } from "@/lib/hyperv/client"
import { logHypervFailure } from "@/lib/hyperv/log"

export const runtime = "nodejs"

/**
 * GET /api/v1/hyperv/[id]/status
 * Test Hyper-V host connectivity via WinRM.
 * Returns hostname, Windows version, and connection status.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const denied = await checkPermission(PERMISSIONS.CONNECTION_VIEW)
    if (denied) return denied

    const prisma = await getSessionPrisma()
    const { id } = await params
    const conn = await prisma.connection.findUnique({
      where: { id },
      select: { id: true, name: true, baseUrl: true, apiTokenEnc: true, insecureTLS: true, type: true },
    })

    if (!conn || conn.type !== 'hyperv') {
      return NextResponse.json({ error: "Hyper-V connection not found" }, { status: 404 })
    }

    const creds = decryptSecret(conn.apiTokenEnc)
    const colonIdx = creds.indexOf(':')
    const username = colonIdx > 0 ? creds.substring(0, colonIdx) : 'Administrator'
    const password = colonIdx > 0 ? creds.substring(colonIdx + 1) : creds

    const host = conn.baseUrl.replace(/^https?:\/\//, "").replace(/\/+$/, "").split(":")[0]
    const useSSL = conn.insecureTLS ? false : conn.baseUrl.startsWith("https")

    const client = new HyperVClient({ host, username, password, useSSL })

    try {
      const { hostname, version } = await client.testConnection()

      return NextResponse.json({
        data: {
          connected: true,
          status: 'online',
          type: 'hyperv',
          name: conn.name,
          host: conn.baseUrl,
          hostname,
          version,
        }
      })
    } catch (connErr: any) {
      const msg = logHypervFailure("status probe", conn.name, host, connErr)

      if (msg.includes("401") || msg.includes("Unauthorized") || msg.includes("credentials")) {
        return NextResponse.json({
          data: { status: 'auth_error', host: conn.baseUrl, warning: 'Invalid credentials or Basic auth not enabled on WinRM' }
        })
      }

      return NextResponse.json({ error: `Hyper-V host unreachable: ${msg}` }, { status: 502 })
    }
  } catch (e: any) {
    if (e.name === 'AbortError') {
      return NextResponse.json({ error: "Connection timeout" }, { status: 504 })
    }
    return NextResponse.json({ error: e?.message || String(e) }, { status: 502 })
  }
}
