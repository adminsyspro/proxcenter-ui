import { NextResponse } from "next/server"

import { getSessionPrisma } from "@/lib/tenant"
import { decryptSecret } from "@/lib/crypto/secret"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { HyperVClient } from "@/lib/hyperv/client"

export const runtime = "nodejs"

/**
 * GET /api/v1/hyperv/[id]/vms/[vmid]
 * Get a single VM detail from a Hyper-V host via WinRM.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; vmid: string }> }
) {
  try {
    const { id, vmid } = await params
    const denied = await checkPermission(PERMISSIONS.CONNECTION_VIEW)
    if (denied) return denied

    const prisma = await getSessionPrisma()
    const conn = await prisma.connection.findUnique({
      where: { id },
      select: { id: true, name: true, baseUrl: true, apiTokenEnc: true, insecureTLS: true, type: true },
    })

    if (!conn || conn.type !== 'hyperv') {
      return NextResponse.json({ error: "Hyper-V connection not found" }, { status: 404 })
    }

    const creds = decryptSecret(conn.apiTokenEnc)
    const colonIdx = creds.indexOf(':')
    const username = colonIdx > 0 ? creds.substring(0, colonIdx) : 'Administrator'
    const password = colonIdx > 0 ? creds.substring(colonIdx + 1) : creds

    const host = conn.baseUrl.replace(/^https?:\/\//, "").replace(/\/+$/, "").split(":")[0]
    const useSSL = conn.insecureTLS ? false : conn.baseUrl.startsWith("https")

    const client = new HyperVClient({ host, username, password, useSSL })
    const vm = await client.getVM(vmid)

    return NextResponse.json({
      data: {
        vmid: vm.vmId,
        name: vm.name,
        status: vm.state === 'Running' ? 'running' : vm.state === 'Paused' ? 'suspended' : 'stopped',
        powerState: vm.state,
        numCPU: vm.cpuCount,
        memoryMB: vm.memoryMB,
        committed: vm.diskSizeBytes,
        guestOS: `Hyper-V Gen ${vm.generation}`,
        firmware: vm.generation === 2 ? 'efi' : 'bios',
        diskPaths: vm.diskPaths,
        connectionId: conn.id,
        connectionName: conn.name,
      }
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
