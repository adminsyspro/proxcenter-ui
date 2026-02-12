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
      
      // Si un stockage cible est spécifié, on doit activer with-local-disks
      // Cela permet de migrer les disques d'un stockage à un autre (y compris partagé -> local)
      if (targetstorage) {
        migrateParams['with-local-disks'] = 1
        migrateParams.targetstorage = targetstorage
      } 

      // Si on a des disques locaux mais pas de stockage cible spécifié,
      // activer with-local-disks pour copier vers le même stockage sur le nœud cible
      else if (withLocalDisks) {
        migrateParams['with-local-disks'] = 1
      }
    }
    
    // Pour LXC avec stockage cible
    if (resourceType === 'lxc' && targetstorage) {
      migrateParams['target-storage'] = targetstorage
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
