import { NextResponse } from "next/server"

import { getSessionPrisma } from "@/lib/tenant"
import { decryptSecret } from "@/lib/crypto/secret"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { NutanixClient } from "@/lib/nutanix/client"

export const runtime = "nodejs"

/**
 * GET /api/v1/nutanix/[id]/vms/[vmid]
 * Get detailed info for a single VM from Nutanix Prism Central
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

    const vm = await client.getVM(vmid)
    const disks = await client.listDisks(vmid)

    // Map disks to the standard format
    const diskList = disks.map((d, idx) => ({
      label: `Disk ${idx} (${d.deviceBus})`,
      capacityBytes: d.sizeBytes,
      fileName: d.uuid,
      thinProvisioned: false,
      deviceBus: d.deviceBus,
      storageContainerUuid: d.storageContainerUuid,
    }))

    // Total committed storage from disks
    const committed = disks.reduce((sum, d) => sum + d.sizeBytes, 0)

    return NextResponse.json({
      data: {
        vmid: vm.uuid,
        name: vm.name,
        guestOS: vm.osType || undefined,
        numCPU: vm.numCpus,
        numCoresPerSocket: 1,
        sockets: vm.numCpus,
        memoryMB: vm.memoryMB,
        firmware: 'bios',
        annotation: vm.description || '',
        powerState: vm.powerState,
        status: vm.powerState === 'ON' ? 'running' : 'stopped',
        uuid: vm.uuid,
        ipAddress: '',
        hostName: vm.hostName || '',
        committed,
        uncommitted: 0,
        provisioned: committed,
        disks: diskList,
        networks: [],
        snapshotCount: 0,
        connectionId: conn.id,
        connectionName: conn.name,
        clusterName: vm.clusterName,
      }
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
