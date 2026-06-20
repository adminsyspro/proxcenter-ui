import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, buildVmResourceId, PERMISSIONS } from "@/lib/rbac"
import { releaseAllocationsForVm } from "@/lib/vdc/ipam"

export const runtime = "nodejs"

const ALLOWED_TYPES = new Set(["qemu", "lxc"])

// DELETE /api/v1/connections/{id}/guests/{type}/{node}/{vmid}
// Supprime une VM ou un conteneur LXC
export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string; type: string; node: string; vmid: string }> }
) {
  try {
    const { id, type, node, vmid } = await ctx.params
    const { searchParams } = new URL(req.url)
    
    if (!ALLOWED_TYPES.has(type)) {
      return NextResponse.json({ error: "Invalid type" }, { status: 400 })
    }

    // RBAC: Check vm.delete permission
    const resourceId = buildVmResourceId(id, node, type, vmid)
    const denied = await checkPermission(PERMISSIONS.VM_DELETE, "vm", resourceId)

    if (denied) return denied

    const conn = await getConnectionById(id)

    // Vérifier que la VM est arrêtée et non verrouillée
    const status = await pveFetch<any>(
      conn,
      `/nodes/${encodeURIComponent(node)}/${type}/${encodeURIComponent(vmid)}/status/current`,
      { method: "GET" }
    )

    // A residual lock (postmigrate, snapshot, backup, ...) makes PVE refuse the
    // delete even if the VM looks stopped. Surface this distinctly so the UI
    // can point the user at the existing right-click → Unlock action.
    if (status?.lock) {
      return NextResponse.json({
        error: `VM is locked in state '${status.lock}'`,
        code: 'vm_locked',
        lock: status.lock,
      }, { status: 409 })
    }

    if (status?.status === 'running') {
      return NextResponse.json({
        error: "VM must be stopped before being deleted",
        code: 'vm_running',
      }, { status: 400 })
    }

    // Construire les paramètres de suppression
    const params = new URLSearchParams()
    
    // Options pour QEMU
    if (type === 'qemu') {
      // purge: Remove vmid from backup cron jobs
      if (searchParams.get('purge') === '1') {
        params.append('purge', '1')
      }


      // destroy-unreferenced-disks: Destroy also unreferenced disks
      if (searchParams.get('destroy-unreferenced-disks') === '1') {
        params.append('destroy-unreferenced-disks', '1')
      }
    }
    
    // Options pour LXC
    if (type === 'lxc') {
      // purge: Remove container from all related configurations
      if (searchParams.get('purge') === '1') {
        params.append('purge', '1')
      }


      // destroy-unreferenced-disks
      if (searchParams.get('destroy-unreferenced-disks') === '1') {
        params.append('destroy-unreferenced-disks', '1')
      }

      // force: Force destroy, even if running
      // Note: On ne force pas, on vérifie que c'est arrêté
    }

    const queryString = params.toString()
    const url = `/nodes/${encodeURIComponent(node)}/${type}/${encodeURIComponent(vmid)}${queryString ? '?' + queryString : ''}`
    
    // Appeler l'API Proxmox pour supprimer la VM
    const result = await pveFetch<string>(
      conn,
      url,
      { method: "DELETE" }
    )

    // Release every IPAM reservation tied to this (connection, vmid).
    // Our IPAM is keyed on vmid so we don't need to re-parse netN/ipconfigN
    // out of the (already-deleted) qm config. Idempotent: missing rows are
    // ignored.
    let ipamWarning: string | undefined
    if (type === 'qemu') {
      try {
        const numericVmid = Number(vmid)
        if (Number.isFinite(numericVmid)) {
          await releaseAllocationsForVm(id, numericVmid)
        }
      } catch (err: any) {
        ipamWarning = `IPAM release failed: ${err?.message || String(err)}`
        console.warn(`[vm-delete] IPAM release failed for ${type}/${vmid}: ${err?.message}`)
      }
    }

    // Audit
    const { audit } = await import("@/lib/audit")

    await audit({
      action: "delete",
      category: type === 'lxc' ? 'containers' : 'vms',
      resourceType: type,
      resourceId: vmid,
      details: { node, connectionId: id, ipamReleaseError: ipamWarning },
    })

    return NextResponse.json({
      success: true,
      data: result,
      message: `VM ${vmid} supprimée avec succès`,
      ...(ipamWarning ? { warning: ipamWarning } : {}),
    })
  } catch (e: any) {
    console.error("[DELETE VM] Error:", e)

return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
