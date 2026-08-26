import { NextResponse } from "next/server"

import { getSessionPrisma } from "@/lib/tenant"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { openXcpngSource } from "@/lib/xcpng/source"
import type { XcpngVmListItem } from "@/lib/xcpng/xapi-client"

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

/**
 * GET /api/v1/xcpng/[id]/vms
 * List the VMs of an XCP-ng source (Xen Orchestra REST or direct XAPI)
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
      select: { id: true, name: true, type: true },
    })

    if (!conn || conn.type !== 'xcpng') {
      return NextResponse.json({ error: "XCP-ng connection not found" }, { status: 404 })
    }

    const src = await openXcpngSource(id)
    try {
      const vms = parseXcpngVms(await src.listVms())
      return NextResponse.json({ data: { vms, connectionName: conn.name } })
    } finally {
      await src.close().catch(() => {})
    }
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

/** Map the source's VM list into our standard format */
function parseXcpngVms(items: XcpngVmListItem[]): XcpngVm[] {
  return items.map((vm) => {
    const powerState = vm.power_state || 'Halted'
    const cpuCount = vm.CPUs?.number || vm.CPUs?.max || 0
    const memoryBytes = vm.memory?.size || 0
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
