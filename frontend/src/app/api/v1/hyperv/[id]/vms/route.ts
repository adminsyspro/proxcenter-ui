import { NextResponse } from "next/server"

import { getSessionPrisma } from "@/lib/tenant"
import { decryptSecret } from "@/lib/crypto/secret"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { HyperVClient } from "@/lib/hyperv/client"

export const runtime = "nodejs"

/**
 * GET /api/v1/hyperv/[id]/vms
 * List VMs on a Hyper-V host via WinRM.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const denied = await checkPermission(PERMISSIONS.CONNECTION_VIEW)
    if (denied) return denied

    const prisma = await getSessionPrisma()
    const { id } = await params
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

    // baseUrl stores the host (may include protocol prefix)
    const host = conn.baseUrl.replace(/^https?:\/\//, "").replace(/\/+$/, "").split(":")[0]
    const useSSL = conn.insecureTLS ? false : conn.baseUrl.startsWith("https")

    const client = new HyperVClient({ host, username, password, useSSL })
    const hypervVms = await client.listVMs()

    // Map to the standard format expected by the frontend migration UI
    const vms = hypervVms.map(vm => ({
      vmid: vm.vmId,
      name: vm.name,
      status: vm.state === 'Running' ? 'running' : vm.state === 'Paused' ? 'suspended' : 'stopped',
      cpu: vm.cpuCount || undefined,
      memory_size_MiB: vm.memoryMB || undefined,
      power_state: vm.state,
      committed: vm.diskSizeBytes || undefined,
      diskPaths: vm.diskPaths,
      generation: vm.generation,
    }))

    return NextResponse.json({ data: { vms, connectionName: conn.name } })
  } catch (e: any) {
    if (e.name === 'AbortError') {
      return NextResponse.json({ error: "Connection timeout - ensure WinRM is enabled on the Hyper-V host" }, { status: 504 })
    }
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
