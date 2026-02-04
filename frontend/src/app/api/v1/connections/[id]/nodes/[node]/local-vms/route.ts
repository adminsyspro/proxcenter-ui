import { NextResponse } from "next/server"
import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"

export const runtime = "nodejs"

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string; node: string }> }
) {
  const { id, node } = await ctx.params

  const conn = await getConnectionById(id)
  if (!conn) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 })
  }

  try {
    // Récupérer la liste des storages pour identifier les locaux
    const storages = await pveFetch<any[]>(
      conn,
      `/nodes/${encodeURIComponent(node)}/storage`
    ) || []

    // Identifier les storages locaux (non partagés)
    const localStorages = new Set(
      storages
        .filter((s: any) => !s.shared && s.active === 1)
        .map((s: any) => s.storage)
    )

    // Récupérer les VMs du nœud
    const qemuVms = await pveFetch<any[]>(
      conn,
      `/nodes/${encodeURIComponent(node)}/qemu`
    ) || []

    const lxcContainers = await pveFetch<any[]>(
      conn,
      `/nodes/${encodeURIComponent(node)}/lxc`
    ) || []

    const localVms: Array<{
      vmid: number
      name: string
      type: 'qemu' | 'lxc'
      status: string
      localDisks: string[]
      hasReplication: boolean
    }> = []

    // Vérifier chaque VM QEMU
    for (const vm of qemuVms) {
      if (vm.template === 1) continue // Ignorer les templates
      
      try {
        const config = await pveFetch<any>(
          conn,
          `/nodes/${encodeURIComponent(node)}/qemu/${vm.vmid}/config`
        )

        const localDisks: string[] = []
        
        // Vérifier tous les disques (scsi0-31, virtio0-15, ide0-3, sata0-5)
        const diskPrefixes = ['scsi', 'virtio', 'ide', 'sata', 'efidisk', 'tpmstate']
        for (const key of Object.keys(config || {})) {
          const isDisc = diskPrefixes.some(prefix => key.startsWith(prefix))
          if (isDisc && typeof config[key] === 'string') {
            const diskValue = config[key] as string
            // Format: storage:vm-vmid-disk-N ou storage:size
            const storageName = diskValue.split(':')[0]
            if (localStorages.has(storageName)) {
              localDisks.push(`${key}: ${storageName}`)
            }
          }
        }

        if (localDisks.length > 0) {
          // Vérifier si la réplication est configurée
          let hasReplication = false
          try {
            const replication = await pveFetch<any[]>(
              conn,
              `/nodes/${encodeURIComponent(node)}/replication`
            )
            hasReplication = replication?.some((r: any) => r.guest === vm.vmid) || false
          } catch {
            // Ignorer les erreurs de réplication
          }

          localVms.push({
            vmid: vm.vmid,
            name: vm.name || `VM ${vm.vmid}`,
            type: 'qemu',
            status: vm.status,
            localDisks,
            hasReplication
          })
        }
      } catch (e) {
        console.error(`Error checking VM ${vm.vmid}:`, e)
      }
    }

    // Vérifier chaque conteneur LXC
    for (const ct of lxcContainers) {
      if (ct.template === 1) continue // Ignorer les templates
      
      try {
        const config = await pveFetch<any>(
          conn,
          `/nodes/${encodeURIComponent(node)}/lxc/${ct.vmid}/config`
        )

        const localDisks: string[] = []
        
        // Vérifier rootfs et les mount points (mp0-255)
        for (const key of Object.keys(config || {})) {
          if (key === 'rootfs' || key.startsWith('mp')) {
            const diskValue = config[key] as string
            if (typeof diskValue === 'string') {
              const storageName = diskValue.split(':')[0]
              if (localStorages.has(storageName)) {
                localDisks.push(`${key}: ${storageName}`)
              }
            }
          }
        }

        if (localDisks.length > 0) {
          localVms.push({
            vmid: ct.vmid,
            name: ct.name || `CT ${ct.vmid}`,
            type: 'lxc',
            status: ct.status,
            localDisks,
            hasReplication: false // LXC n'a pas de réplication native
          })
        }
      } catch (e) {
        console.error(`Error checking CT ${ct.vmid}:`, e)
      }
    }

    // Compter les VMs migrables (sans stockage local ou avec réplication)
    const runningLocalVms = localVms.filter(vm => vm.status === 'running' && !vm.hasReplication)
    const canMigrate = runningLocalVms.length === 0

    return NextResponse.json({
      data: {
        localStorages: Array.from(localStorages),
        localVms,
        summary: {
          total: localVms.length,
          running: localVms.filter(vm => vm.status === 'running').length,
          withReplication: localVms.filter(vm => vm.hasReplication).length,
          blockingMigration: runningLocalVms.length,
          canMigrate
        }
      }
    })
  } catch (error: any) {
    console.error(`Error fetching local VMs for node ${node}:`, error)
    return NextResponse.json({ 
      error: error.message || "Failed to fetch local VMs",
      data: { localVms: [], summary: { total: 0, running: 0, withReplication: 0, blockingMigration: 0, canMigrate: true } }
    }, { status: 500 })
  }
}
