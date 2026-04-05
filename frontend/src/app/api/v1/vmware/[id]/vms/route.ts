import { NextResponse } from "next/server"

import { getSessionPrisma } from "@/lib/tenant"
import { decryptSecret } from "@/lib/crypto/secret"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { soapLogin, soapLogout, soapListVMs } from "@/lib/vmware/soap"

export const runtime = "nodejs"

/**
 * GET /api/v1/vmware/[id]/vms
 * List VMs on a VMware ESXi host or vCenter via SOAP API
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
      select: { id: true, name: true, baseUrl: true, apiTokenEnc: true, insecureTLS: true, type: true, subType: true, vmwareDatacenter: true },
    })

    if (!conn || conn.type !== 'vmware') {
      return NextResponse.json({ error: "VMware connection not found" }, { status: 404 })
    }

    const creds = decryptSecret(conn.apiTokenEnc)
    const colonIdx = creds.indexOf(':')
    const username = colonIdx > 0 ? creds.substring(0, colonIdx) : 'root'
    const password = colonIdx > 0 ? creds.substring(colonIdx + 1) : creds
    const vmwareUrl = conn.baseUrl.replace(/\/$/, '')

    // Login via shared SOAP client (auto-discovers MORs for ESXi or vCenter)
    const session = await soapLogin(vmwareUrl, username, password, conn.insecureTLS)

    // Set datacenter path from connection config (used for vCenter)
    if (conn.vmwareDatacenter) {
      session.datacenterPath = conn.vmwareDatacenter
    }

    try {
      const vmList = await soapListVMs(session)

      // Map VmwareVmSummary to the response format expected by the frontend
      const vms = vmList.map(vm => ({
        vmid: vm.moId,
        name: vm.name,
        status: vm.powerState === 'poweredOn' ? 'running' : vm.powerState === 'suspended' ? 'suspended' : 'stopped',
        cpu: vm.cpu || undefined,
        memory_size_MiB: vm.memoryMB || undefined,
        power_state: vm.powerState,
        guest_OS: vm.guestOS || undefined,
        committed: vm.committedStorage || undefined,
        uncommitted: vm.uncommittedStorage || undefined,
      }))

      return NextResponse.json({ data: { vms, connectionName: conn.name } })
    } finally {
      soapLogout(session)
    }
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
