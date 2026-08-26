import { NextResponse } from "next/server"

import { getSessionPrisma } from "@/lib/tenant"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { openXcpngSource } from "@/lib/xcpng/source"

export const runtime = "nodejs"

/** XO answers 404 for an unknown uuid; XAPI's VM.get_by_uuid raises UUID_INVALID. */
function isVmNotFound(e: any): boolean {
  const msg = String(e?.message || e)
  return /^XO API error: 404\b/.test(msg) || (e?.name === 'XapiError' && /^(UUID_INVALID|HANDLE_INVALID)\b/.test(msg))
}

/**
 * GET /api/v1/xcpng/[id]/vms/[vmid]
 * Get detailed info for a single VM. The record is the raw XO REST object or the
 * raw XAPI VM record (plus `_guest` metrics); both carry VIFs/VBDs as reference
 * arrays, the field names differ only for CPU, memory and guest OS.
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
      select: { id: true, name: true, type: true },
    })

    if (!conn || conn.type !== 'xcpng') {
      return NextResponse.json({ error: "XCP-ng connection not found" }, { status: 404 })
    }

    const src = await openXcpngSource(id)
    let vm: any
    try {
      try {
        vm = await src.getVm(vmid)
      } catch (e: any) {
        if (isVmNotFound(e)) return NextResponse.json({ error: "VM not found" }, { status: 404 })
        throw e
      }
    } finally {
      await src.close().catch(() => {})
    }

    // Parse VM data
    const powerState = vm.power_state || 'Halted'
    const cpuCount = vm.CPUs?.number || vm.CPUs?.max || Number(vm.VCPUs_at_startup) || Number(vm.VCPUs_max) || 0
    const memoryBytes = vm.memory?.size || vm.memory?.dynamic?.[1] || Number(vm.memory_static_max) || 0
    const memoryMB = memoryBytes ? Math.round(memoryBytes / (1024 * 1024)) : 0
    const osVersion = vm.os_version?.name || vm.os_version?.distro
      || vm._guest?.os_version?.name || vm._guest?.os_version?.distro || ''

    // Parse VIFs (network interfaces)
    const networks = (vm.VIFs || []).map((vifRef: string, idx: number) => ({
      label: `VIF ${idx}`,
      macAddress: '',
      network: vifRef,
      connected: true,
    }))

    // Parse VBDs into disks
    const disks: any[] = []
    if (vm.VBDs && Array.isArray(vm.VBDs)) {
      // VBDs are refs; resolving each one is the config mapper's job, here we only count them
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
        firmware: vm.boot?.firmware || vm.HVM_boot_params?.firmware || 'bios',
        annotation: vm.name_description || '',
        powerState,
        status: powerState === 'Running' ? 'running' : powerState === 'Suspended' ? 'suspended' : 'stopped',
        uuid: vm.uuid || vmid,
        ipAddress: vm.mainIpAddress || vm.addresses?.['0/ipv4/0'] || vm._guest?.networks?.['0/ipv4/0'] || '',
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
