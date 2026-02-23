import { NextResponse } from "next/server"

import { prisma } from "@/lib/db/prisma"
import { decryptSecret } from "@/lib/crypto/secret"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { pveFetch } from "@/lib/proxmox/client"

export const runtime = "nodejs"

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> | { id: string } }) {
  try {
    const params = await Promise.resolve(ctx.params)
    const id = (params as any)?.id

    if (!id) return NextResponse.json({ error: "Missing params.id" }, { status: 400 })

    const denied = await checkPermission(PERMISSIONS.CONNECTION_MANAGE, "connection", id)

    if (denied) return denied

    const conn = await prisma.connection.findUnique({
      where: { id },
      select: { type: true, baseUrl: true, apiTokenEnc: true, insecureTLS: true, hasCeph: true },
    })

    if (!conn) return NextResponse.json({ error: "Connection not found" }, { status: 404 })
    if (conn.type !== 'pve') return NextResponse.json({ error: "Only PVE connections support Ceph" }, { status: 400 })

    const apiToken = decryptSecret(conn.apiTokenEnc!)
    let hasCeph = false

    try {
      const nodes = await pveFetch<any[]>({ baseUrl: conn.baseUrl, apiToken, insecureDev: conn.insecureTLS }, "/nodes")
      const onlineNode = nodes?.find((n: any) => n.status === 'online') || nodes?.[0]

      if (onlineNode) {
        const cephStatus = await pveFetch<any>(
          { baseUrl: conn.baseUrl, apiToken, insecureDev: conn.insecureTLS },
          `/nodes/${encodeURIComponent(onlineNode.node)}/ceph/status`
        ).catch(() => null)

        hasCeph = !!(cephStatus?.health)
      }
    } catch {
      hasCeph = false
    }

    // Update only if changed
    if (hasCeph !== conn.hasCeph) {
      await prisma.connection.update({
        where: { id },
        data: { hasCeph },
      })
    }

    return NextResponse.json({ data: { hasCeph } })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
