import { NextResponse } from "next/server"

import { getSessionPrisma } from "@/lib/tenant"
import { decryptSecret } from "@/lib/crypto/secret"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

type XcpngVm = {
  vmid: string
  name: string
  status: string  // 'running' | 'stopped' | 'suspended'
  cpu?: number
  memory_size_MiB?: number
  power_state?: string
  guest_OS?: string
  committed?: number
}

/** Helper to make authenticated requests to XO REST API */
async function xoFetch(baseUrl: string, path: string, authHeader: string, insecureTLS: boolean, timeout = 30000): Promise<Response> {
  const opts: any = {
    headers: { 'Authorization': authHeader, 'Accept': 'application/json' },
    signal: AbortSignal.timeout(timeout),
  }
  if (insecureTLS) {
    opts.dispatcher = new (await import('undici')).Agent({ connect: { rejectUnauthorized: false } })
  }
  return fetch(`${baseUrl}${path}`, opts)
}

/**
 * GET /api/v1/xcpng/[id]/vms
 * List VMs managed by XO (Xen Orchestra) via REST API
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
      select: { id: true, name: true, baseUrl: true, apiTokenEnc: true, insecureTLS: true, type: true },
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

    // Fetch VMs from XO REST API
    // The XO REST API returns an array of VM href strings like ["/rest/v0/vms/uuid1", ...]
    // We need to fetch with ?fields=... to get full objects
    const res = await xoFetch(xoUrl, '/rest/v0/vms?fields=uuid,name_label,power_state,CPUs,memory,os_version&filter=type:VM', authHeader, conn.insecureTLS)

    if (!res.ok) {
      // Fallback: try without filter param (older XO versions)
      const resFallback = await xoFetch(xoUrl, '/rest/v0/vms?fields=uuid,name_label,power_state,CPUs,memory,os_version', authHeader, conn.insecureTLS)
      if (!resFallback.ok) {
        throw new Error(`XO API returned ${resFallback.status}`)
      }
      const data = await resFallback.json()
      const vms = parseXoVms(data)
      return NextResponse.json({ data: { vms, connectionName: conn.name } })
    }

    const data = await res.json()
    const vms = parseXoVms(data)

    return NextResponse.json({ data: { vms, connectionName: conn.name } })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

/** Parse XO REST API VM response into our standard format */
function parseXoVms(data: any): XcpngVm[] {
  if (!Array.isArray(data)) return []

  return data
    .filter((vm: any) => vm && vm.uuid && vm.name_label !== undefined)
    .map((vm: any) => {
      const powerState = vm.power_state || 'Halted'
      const cpuCount = vm.CPUs?.number || vm.CPUs?.max || 0
      const memoryBytes = vm.memory?.size || vm.memory?.dynamic?.[1] || 0
      const memoryMB = memoryBytes ? Math.round(memoryBytes / (1024 * 1024)) : 0
      const osVersion = vm.os_version?.name || vm.os_version?.distro || ''

      return {
        vmid: vm.uuid,
        name: vm.name_label || vm.uuid,
        status: powerState === 'Running' ? 'running' : powerState === 'Suspended' ? 'suspended' : 'stopped',
        cpu: cpuCount || undefined,
        memory_size_MiB: memoryMB || undefined,
        power_state: powerState,
        guest_OS: osVersion || undefined,
      }
    })
}
