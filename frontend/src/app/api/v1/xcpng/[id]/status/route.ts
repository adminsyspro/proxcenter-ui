import { NextResponse } from "next/server"

import { getSessionPrisma } from "@/lib/tenant"
import { decryptSecret } from "@/lib/crypto/secret"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

/**
 * GET /api/v1/xcpng/[id]/status
 * Test connectivity to a Xen Orchestra (XO) instance managing XCP-ng hosts
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

    if (!conn || conn.type !== 'xcpng') {
      return NextResponse.json({ error: "XCP-ng connection not found" }, { status: 404 })
    }

    const creds = decryptSecret(conn.apiTokenEnc)
    const colonIdx = creds.indexOf(':')
    const username = colonIdx > 0 ? creds.substring(0, colonIdx) : 'admin@admin.net'
    const password = colonIdx > 0 ? creds.substring(colonIdx + 1) : creds
    const xoUrl = conn.baseUrl.replace(/\/$/, '')

    const authHeader = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
    const fetchOpts: any = {
      headers: { 'Authorization': authHeader, 'Accept': 'application/json' },
      signal: AbortSignal.timeout(15000),
    }
    if (conn.insecureTLS) {
      fetchOpts.dispatcher = new (await import('undici')).Agent({ connect: { rejectUnauthorized: false } })
    }

    // Try fetching hosts list as a connectivity + auth check
    const res = await fetch(`${xoUrl}/rest/v0/hosts`, fetchOpts).catch(() => null)

    if (!res) {
      return NextResponse.json({ error: "XO server unreachable" }, { status: 502 })
    }

    if (res.status === 401) {
      return NextResponse.json({ data: { status: 'auth_error', host: xoUrl, warning: 'Invalid credentials' } })
    }

    if (!res.ok) {
      return NextResponse.json({ data: { status: 'error', host: xoUrl, warning: `XO returned HTTP ${res.status}` } })
    }

    const hosts = await res.json().catch(() => [])
    const hostCount = Array.isArray(hosts) ? hosts.length : 0

    return NextResponse.json({
      data: {
        status: 'online',
        host: xoUrl,
        hostCount,
        version: 'XO/XOA',
      }
    })
  } catch (e: any) {
    if (e.name === 'AbortError') {
      return NextResponse.json({ error: "Connection timeout" }, { status: 504 })
    }
    return NextResponse.json({ error: e?.message || String(e) }, { status: 502 })
  }
}
