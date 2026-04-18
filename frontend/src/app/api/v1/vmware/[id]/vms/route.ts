import { NextResponse } from "next/server"

import { getSessionPrisma } from "@/lib/tenant"
import { decryptSecret } from "@/lib/crypto/secret"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { soapLogin, soapLogout, soapListVMs, soapResolveHostInventoryPaths } from "@/lib/vmware/soap"

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

      // For vCenter only: resolve each VM's HostSystem MOR to its inventory path
      // (datacenter / cluster / host), so the migration dialog can pre-fill the
      // libvirt vpx URI components automatically. Standalone ESXi sessions return
      // an empty map and the path fields stay undefined on the response.
      const hostMors = vmList.map(vm => vm.hostMor).filter(Boolean)
      let hostPathByMor = new Map<string, { datacenter: string; cluster: string | null; host: string; status: "ok" | "warn" | "crit" | "unknown"; connectionState?: string; powerState?: string }>()
      try {
        hostPathByMor = await soapResolveHostInventoryPaths(session, hostMors)
        // Diagnostic logging: helps debug "vcenterDatacenter required" pipeline errors.
        // Logs are scoped per-connection so a vCenter with broken inventory permissions
        // is identifiable without dumping every VM. Only logs when something is "off".
        if (session.isVcenter) {
          const uniqueHosts = new Set(hostMors).size
          const resolvedCount = hostPathByMor.size
          if (resolvedCount < uniqueHosts) {
            console.warn(
              `[vmware/vms] Resolved only ${resolvedCount}/${uniqueHosts} ESXi host inventory paths ` +
              `for connection ${conn.id}. ` +
              `Unresolved hosts will fall back to manual entry at migration time.`,
            )
          }
        }
      } catch (resolveErr) {
        // Resolution is best-effort; if it fails (auth, perms, weird inventory layout)
        // we still want to return the VM list so the user can fall back to manual entry.
        console.warn(
          `[vmware/vms] Inventory path resolution threw for connection ${conn.id}: ` +
          `${(resolveErr as Error)?.message || resolveErr}`,
        )
      }

      // Map VmwareVmSummary to the response format expected by the frontend
      const vms = vmList.map(vm => {
        const path = vm.hostMor ? hostPathByMor.get(vm.hostMor) : undefined
        return {
          vmid: vm.moId,
          name: vm.name,
          status: vm.powerState === 'poweredOn' ? 'running' : vm.powerState === 'suspended' ? 'suspended' : 'stopped',
          cpu: vm.cpu || undefined,
          memory_size_MiB: vm.memoryMB || undefined,
          power_state: vm.powerState,
          guest_OS: vm.guestOS || undefined,
          committed: vm.committedStorage || undefined,
          uncommitted: vm.uncommittedStorage || undefined,
          // VMware Tools state, used by the migration modal to preflight
          // Live migrations of Windows guests (VSS quiesce needs running Tools).
          toolsStatus: vm.toolsStatus,
          toolsRunningStatus: vm.toolsRunningStatus,
          // vCenter-only fields used by the virt-v2v migration flow.
          // Undefined on standalone ESXi (no inventory hierarchy needed there).
          vcenterDatacenter: path?.datacenter,
          vcenterCluster: path?.cluster ?? undefined,
          vcenterHost: path?.host,
          /**
           * Aggregate health of the ESXi host running this VM, surfaced so the
           * inventory tree can paint a status pastille on host group rows. The
           * tree derives the host status from any VM under that host (they
           * share the same host MOR → same status), so duplicating it on each
           * VM is cheap and avoids a second API surface for hosts.
           */
          vcenterHostStatus: path?.status,
          vcenterHostConnectionState: path?.connectionState,
          vcenterHostPowerState: path?.powerState,
        }
      })

      return NextResponse.json({ data: { vms, connectionName: conn.name } })
    } finally {
      soapLogout(session)
    }
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
