import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, buildVmResourceId, PERMISSIONS } from "@/lib/rbac"
import { isDiskKey, volidOfDrive, snapshotsReferencingVolume } from "@/lib/proxmox/snapshotRefs"

export const runtime = "nodejs"

// GET /api/v1/connections/{id}/guests/{type}/{node}/{vmid}/disk/snapshot-refs?disk=scsi0
// Snapshots that still reference the disk's volume (#1004). PVE refuses to
// move such a disk with delete=1, and to remove it once it is an unusedN
// entry, so the disk dialog asks here first and warns instead.
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string; type: string; node: string; vmid: string }> }
) {
  try {
    const { id, type, node, vmid } = await ctx.params
    const disk = new URL(req.url).searchParams.get('disk') || ''

    if (!isDiskKey(disk)) {
      return NextResponse.json({ error: 'Invalid disk' }, { status: 400 })
    }

    // Same permission as the move and delete actions this check guards.
    const resourceId = buildVmResourceId(id, node, type, vmid)
    const denied = await checkPermission(PERMISSIONS.VM_CONFIG_HARDWARE, "vm", resourceId)

    if (denied) return denied

    const conn = await getConnectionById(id)
    const base = `/nodes/${encodeURIComponent(node)}/${type === 'lxc' ? 'lxc' : 'qemu'}/${encodeURIComponent(vmid)}`

    const cfg = await pveFetch<Record<string, unknown>>(conn, `${base}/config`)
    const volid = volidOfDrive(cfg?.[disk])

    if (!volid) return NextResponse.json({ data: { volid: null, snapshots: [] } })

    const list = await pveFetch<Array<{ name: string }>>(conn, `${base}/snapshot`)
    const names = (Array.isArray(list) ? list : []).map(s => s.name).filter(n => n && n !== 'current')
    const snapshots = await Promise.all(names.map(async name => ({
      name,
      config: await pveFetch<Record<string, unknown>>(conn, `${base}/snapshot/${encodeURIComponent(name)}/config`) ?? {},
    })))

    return NextResponse.json({ data: { volid, snapshots: snapshotsReferencingVolume(volid, snapshots) } })
  } catch (e: any) {
    console.error('Error reading disk snapshot references:', e)

    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
