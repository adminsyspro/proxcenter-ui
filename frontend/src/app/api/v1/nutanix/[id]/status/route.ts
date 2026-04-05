import { NextResponse } from "next/server"

import { getSessionPrisma } from "@/lib/tenant"
import { decryptSecret } from "@/lib/crypto/secret"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { NutanixClient } from "@/lib/nutanix/client"

export const runtime = "nodejs"

/**
 * GET /api/v1/nutanix/[id]/status
 * Test connectivity to a Nutanix Prism Central instance
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const prisma = await getSessionPrisma()
    const denied = await checkPermission(PERMISSIONS.CONNECTION_VIEW)
    if (denied) return denied

    const { id } = await params
    const conn = await prisma.connection.findUnique({
      where: { id },
      select: { id: true, baseUrl: true, apiTokenEnc: true, insecureTLS: true, type: true },
    })

    if (!conn || conn.type !== 'nutanix') {
      return NextResponse.json({ error: "Nutanix connection not found" }, { status: 404 })
    }

    const creds = decryptSecret(conn.apiTokenEnc)
    const colonIdx = creds.indexOf(':')
    const username = colonIdx > 0 ? creds.substring(0, colonIdx) : 'admin'
    const password = colonIdx > 0 ? creds.substring(colonIdx + 1) : creds
    const baseUrl = conn.baseUrl.replace(/\/$/, '')

    const client = new NutanixClient({
      baseUrl,
      username,
      password,
      insecureTLS: conn.insecureTLS,
    })

    try {
      const { version, clusterName } = await client.testConnection()

      return NextResponse.json({
        data: {
          connected: true,
          status: 'online',
          host: baseUrl,
          version,
          clusterName,
          type: 'nutanix',
        }
      })
    } catch (e: any) {
      if (e?.message?.includes('401') || e?.message?.includes('403') || e?.message?.includes('credentials')) {
        return NextResponse.json({ data: { status: 'auth_error', host: baseUrl, warning: 'Invalid credentials' } })
      }
      return NextResponse.json({ error: e?.message || "Nutanix Prism Central unreachable" }, { status: 502 })
    }
  } catch (e: any) {
    if (e.name === 'AbortError') {
      return NextResponse.json({ error: "Connection timeout" }, { status: 504 })
    }
    return NextResponse.json({ error: e?.message || String(e) }, { status: 502 })
  }
}
