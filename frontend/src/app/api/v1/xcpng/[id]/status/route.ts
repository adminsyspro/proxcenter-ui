import { NextResponse } from "next/server"

import { getSessionPrisma } from "@/lib/tenant"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { openXcpngSource, xcpngSubTypeOf, isXcpngAuthError, type XcpngSource } from "@/lib/xcpng/source"

export const runtime = "nodejs"

/**
 * GET /api/v1/xcpng/[id]/status
 * Test connectivity to an XCP-ng source: a Xen Orchestra instance (mode "xo")
 * or the pool master itself over XAPI (mode "xapi").
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
      select: { id: true, baseUrl: true, type: true, subType: true },
    })

    if (!conn || conn.type !== 'xcpng') {
      return NextResponse.json({ error: "XCP-ng connection not found" }, { status: 404 })
    }

    const mode = xcpngSubTypeOf(conn)
    const host = conn.baseUrl.replace(/\/$/, '')
    const backend = mode === 'xapi' ? 'XCP-ng pool' : 'XO server'

    let src: XcpngSource | null = null
    try {
      // Opening an XAPI source logs in, so an auth failure surfaces here as well as on listHosts.
      src = await openXcpngSource(id)
      const hosts = await src.listHosts()
      const version = mode === 'xapi'
        ? (hosts[0]?.version ? `XCP-ng ${hosts[0].version}` : 'XCP-ng')
        : 'XO/XOA'

      return NextResponse.json({
        data: {
          status: 'online',
          host: src.displayUrl,
          mode,
          hostCount: hosts.length,
          version,
        }
      })
    } catch (e: any) {
      const msg = String(e?.message || e)
      if (isXcpngAuthError(msg)) {
        return NextResponse.json({ data: { status: 'auth_error', host, mode, warning: 'Invalid credentials' } })
      }
      if (e?.name === 'AbortError' || e?.name === 'TimeoutError') {
        return NextResponse.json({ error: "Connection timeout" }, { status: 504 })
      }
      const xoHttp = /^XO API error: (\d{3})/.exec(msg)
      if (xoHttp) {
        return NextResponse.json({ data: { status: 'error', host, mode, warning: `XO returned HTTP ${xoHttp[1]}` } })
      }
      if (e?.name === 'XapiError' || /^XAPI HTTP /.test(msg)) {
        return NextResponse.json({ data: { status: 'error', host, mode, warning: msg } })
      }
      // Anything else is a transport failure (DNS, refused, TLS).
      return NextResponse.json({ error: `${backend} unreachable` }, { status: 502 })
    } finally {
      await src?.close().catch(() => {})
    }
  } catch (e: any) {
    if (e.name === 'AbortError') {
      return NextResponse.json({ error: "Connection timeout" }, { status: 504 })
    }
    return NextResponse.json({ error: e?.message || String(e) }, { status: 502 })
  }
}
