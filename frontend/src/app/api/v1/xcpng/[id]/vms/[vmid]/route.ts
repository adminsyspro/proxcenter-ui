import { NextResponse } from "next/server"

import { getSessionPrisma } from "@/lib/tenant"
import { decryptSecret } from "@/lib/crypto/secret"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

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
 * GET /api/v1/xcpng/[id]/vms/[vmid]
 * Get detailed info for a single VM from XO REST API
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; vmid: string }> }
) {
  try {
    const prisma = await getSessionPrisma()
    const denied = await checkPermission(PERMISSIONS.CONNECTION_VIEW)
    if (denied) return denied

    const { id, vmid } = await params
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

    // Fetch VM details from XO REST API
    const res = await xoFetch(xoUrl, `/rest/v0/vms/${encodeURIComponent(vmid)}`, authHeader, conn.insecureTLS)

    if (res.status === 404) {
      return NextResponse.json({ error: "VM not found" }, { status: 404 })
    }

    if (!res.ok) {
      throw new Error(`XO API returned ${res.status}`)
    }

    const vm = await res.json()

    // Parse VM data
    const powerState = vm.power_state || 'Halted'
    const cpuCount = vm.CPUs?.number || vm.CPUs?.max || 0
    const memoryBytes = vm.memory?.size || vm.memory?.dynamic?.[1] || 0
    const memoryMB = memoryBytes ? Math.round(memoryBytes / (1024 * 1024)) : 0
    const osVersion = vm.os_version?.name || vm.os_version?.distro || ''

    // Parse VIFs (network interfaces)
    const networks = (vm.VIFs || []).map((vifRef: string, idx: number) => ({
      label: `VIF ${idx}`,
      macAddress: '',
      network: vifRef,
      connected: true,
    }))

    // Parse VBDs → disks
    const disks: any[] = []
    if (vm.VBDs && Array.isArray(vm.VBDs)) {
      // VBDs are refs, we'd need to fetch each one — for now just count them
      disks.push(...vm.VBDs.filter((vbd: any) => typeof vbd === 'string').map((vbd: string, idx: number) => ({
        label: `VBD ${idx}`,
        capacityBytes: 0,
        fileName: vbd,
        thinProvisioned: false,
      })))
    }

    return NextResponse.json({
      data: {
        vmid: vm.uuid || vmid,
        name: vm.name_label || vmid,
        guestOS: osVersion,
        numCPU: cpuCount,
        numCoresPerSocket: 1,
        sockets: cpuCount,
        memoryMB,
        firmware: vm.boot?.firmware || 'bios',
        annotation: vm.name_description || '',
        powerState,
        status: powerState === 'Running' ? 'running' : powerState === 'Suspended' ? 'suspended' : 'stopped',
        uuid: vm.uuid || vmid,
        ipAddress: vm.mainIpAddress || vm.addresses?.['0/ipv4/0'] || '',
        hostName: vm.name_label || '',
        committed: 0,
        uncommitted: 0,
        provisioned: 0,
        disks,
        networks,
        snapshotCount: vm.snapshots?.length || 0,
        connectionId: conn.id,
        connectionName: conn.name,
        tags: vm.tags || [],
      }
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
