import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, buildVmResourceId, PERMISSIONS } from "@/lib/rbac"
import { migrateVmSchema } from "@/lib/schemas"
import { invalidateInventoryCache } from "@/lib/cache/inventoryCache"

export const runtime = "nodejs"

// POST /api/v1/connections/{id}/guests/{type}/{node}/{vmid}/migrate
// Lance la migration d'une VM vers un autre node
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string; type: string; node: string; vmid: string }> }
) {
  try {
    const { id, type, node, vmid } = await ctx.params

    // RBAC: Check vm.migrate permission
    const resourceId = buildVmResourceId(id, node, type, vmid)
    const denied = await checkPermission(PERMISSIONS.VM_MIGRATE, "vm", resourceId)

    if (denied) return denied

    const rawBody = await req.json()
    const parseResult = migrateVmSchema.safeParse(rawBody)

    if (!parseResult.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parseResult.error.flatten() },
        { status: 400 }
      )
    }

    const { target, online, targetstorage, withLocalDisks } = parseResult.data

    const conn = await getConnectionById(id)
    
    // Déterminer le type de ressource pour l'API Proxmox
    const resourceType = type === 'lxc' ? 'lxc' : 'qemu'
    
    // Construire les paramètres de migration
    const migrateParams: Record<string, any> = {
      target,
    }
    
    // Pour les VMs QEMU
    if (resourceType === 'qemu') {
      migrateParams.online = online ? 1 : 0

      if (targetstorage) {
        migrateParams['with-local-disks'] = 1
        migrateParams.targetstorage = targetstorage
      } else {
        // Always send with-local-disks for online QEMU migrations.
        // Proxmox ignores it if the VM has no local disks, but without it
        // migrations fail when local disks are present. The frontend detection
        // of local disks is fragile (async storages fetch may not complete),
        // so we always set this flag to match Proxmox native UI behavior.
        migrateParams['with-local-disks'] = 1
      }
    }
    
    // Pour les LXC
    if (resourceType === 'lxc') {
      if (online) {
        migrateParams.restart = 1
      }
      if (targetstorage) {
        migrateParams['target-storage'] = targetstorage
      }
    }
    
    // Appeler l'API Proxmox pour la migration
    const result = await pveFetch<string>(
      conn,
      `/nodes/${encodeURIComponent(node)}/${resourceType}/${encodeURIComponent(vmid)}/migrate`,
      {
        method: 'POST',
        body: new URLSearchParams(
          Object.entries(migrateParams).map(([k, v]) => [k, String(v)])
        ).toString(),
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    )
    
    invalidateInventoryCache()

    // Audit
    const { audit } = await import("@/lib/audit")

    await audit({
      action: "migrate",
      category: type === 'lxc' ? 'containers' : 'vms',
      resourceType: type,
      resourceId: vmid,
      details: { sourceNode: node, targetNode: target, connectionId: id, online },
    })

    return NextResponse.json({
      success: true,
      data: result,
      message: `Migration de VM ${vmid} vers ${target} lancée`
    })
  } catch (e: any) {
    console.error('Error migrating VM:', e)

return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
