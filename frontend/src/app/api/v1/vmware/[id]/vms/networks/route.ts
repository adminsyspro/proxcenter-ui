import { NextResponse } from "next/server"

import { getSessionPrisma } from "@/lib/tenant"
import { decryptSecret } from "@/lib/crypto/secret"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { soapLogin, soapLogout, soapGetVmsNics } from "@/lib/vmware/soap"

export const runtime = "nodejs"

/** A bulk batch holds at most 500 VMs (MAX_BATCH_VMS of the batch route). */
const MAX_VMIDS = 500

interface BatchSourceNetwork {
  /** The port group name, as the migration engines match it against the table. */
  name: string
  /** VMs of the selection with at least one adapter on it. */
  vmCount: number
}

/**
 * POST /api/v1/vmware/[id]/vms/networks
 * The source networks of a bulk selection (ui#1333): body `{ vmids }`, one
 * SOAP read for every VM, answered as the port groups their adapters sit on,
 * named as the migration engines name them (distributed port groups by
 * name). The bulk dialog lists them in its network table.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const prisma = await getSessionPrisma()
    const denied = await checkPermission(PERMISSIONS.CONNECTION_VIEW)
    if (denied) return denied

    const { id } = await params
    const body = await req.json().catch(() => null)
    const vmids: unknown = body?.vmids
    if (!Array.isArray(vmids) || vmids.length === 0 || vmids.length > MAX_VMIDS || vmids.some(v => typeof v !== "string" || !/^[A-Za-z0-9_.:-]{1,80}$/.test(v))) {
      return NextResponse.json({ error: `vmids must list between 1 and ${MAX_VMIDS} VM ids` }, { status: 400 })
    }

    const conn = await prisma.connection.findUnique({
      where: { id },
      select: { id: true, baseUrl: true, apiTokenEnc: true, insecureTLS: true, type: true },
    })
    if (!conn || conn.type !== "vmware") {
      return NextResponse.json({ error: "VMware connection not found" }, { status: 404 })
    }

    const creds = decryptSecret(conn.apiTokenEnc)
    const colonIdx = creds.indexOf(":")
    const username = colonIdx > 0 ? creds.substring(0, colonIdx) : "root"
    const password = colonIdx > 0 ? creds.substring(colonIdx + 1) : creds
    const session = await soapLogin(conn.baseUrl.replace(/\/$/, ""), username, password, conn.insecureTLS)
    try {
      const byVm = await soapGetVmsNics(session, vmids as string[])
      const counts = new Map<string, number>()
      for (const nics of byVm.values()) {
        for (const name of new Set(nics.map(n => n.network).filter(Boolean))) counts.set(name, (counts.get(name) ?? 0) + 1)
      }
      const networks: BatchSourceNetwork[] = [...counts.entries()]
        .map(([name, vmCount]) => ({ name, vmCount }))
        .sort((a, b) => a.name.localeCompare(b.name))
      return NextResponse.json({ data: { networks, vmsRead: byVm.size } })
    } finally {
      void soapLogout(session)
    }
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
