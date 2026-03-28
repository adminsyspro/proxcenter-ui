import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

/**
 * Returns QEMU VMs that have at least one disk on a Ceph (RBD) storage,
 * along with the total Ceph disk size for each VM.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params

    const denied = await checkPermission(PERMISSIONS.CONNECTION_VIEW, "connection", id)
    if (denied) return denied

    const conn = await getConnectionById(id)

    // 1. Get storage configs to identify RBD storages
    const storageConfigs = await pveFetch<any[]>(conn, "/storage").catch(() => [])
    const rbdStorages = new Set(
      (storageConfigs || [])
        .filter((s: any) => s.type === "rbd")
        .map((s: any) => s.storage)
    )

    if (rbdStorages.size === 0) {
      return NextResponse.json({ data: [] })
    }

    // 2. Get all QEMU VMs from cluster resources
    const resources = await pveFetch<any[]>(conn, "/cluster/resources")
    const qemuVMs = (resources || []).filter(
      (r: any) => r.type === "qemu" && r.status === "running"
    )

    // 3. Fetch configs in parallel to check disk storage
    const results = await Promise.all(
      qemuVMs.map(async (vm: any) => {
        try {
          const config = await pveFetch<any>(
            conn,
            `/nodes/${encodeURIComponent(vm.node)}/qemu/${vm.vmid}/config`
          )
          if (!config) return null

          let cephDiskSize = 0
          for (const [key, val] of Object.entries(config)) {
            if (!/^(scsi|virtio|ide|sata)\d+$/.test(key)) continue
            const diskStr = String(val)
            const storageName = diskStr.split(":")[0]
            if (!rbdStorages.has(storageName)) continue

            const sizeMatch = diskStr.match(/size=(\d+)([GMT])?/i)
            if (sizeMatch) {
              const num = Number.parseInt(sizeMatch[1], 10)
              const unit = (sizeMatch[2] || "G").toUpperCase()
              if (unit === "T") cephDiskSize += num * 1024
              else if (unit === "M") cephDiskSize += num / 1024
              else cephDiskSize += num
            }
          }

          if (cephDiskSize === 0) return null

          return {
            vmid: vm.vmid,
            cephDiskGb: Math.round(cephDiskSize * 10) / 10,
          }
        } catch {
          return null
        }
      })
    )

    const cephVMs = results.filter(Boolean)

    return NextResponse.json({ data: cephVMs })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
