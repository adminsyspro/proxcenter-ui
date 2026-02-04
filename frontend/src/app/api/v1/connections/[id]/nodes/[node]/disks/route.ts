import { NextResponse } from "next/server"
import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"

export const runtime = "nodejs"

/**
 * GET /api/v1/connections/[id]/nodes/[node]/disks
 * 
 * Récupère toutes les données disques pour un node :
 * - Liste des disques physiques
 * - LVM (Volume Groups)
 * - LVM-Thin (Thin Pools)
 * - Directory
 * - ZFS
 * 
 * Query params:
 * - section: 'all' | 'disks' | 'lvm' | 'lvmthin' | 'directory' | 'zfs'
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string; node: string }> | { id: string; node: string } }) {
  try {
    const params = await Promise.resolve(ctx.params)
    const id = (params as any)?.id
    const node = (params as any)?.node

    if (!id || !node) {
      return NextResponse.json({ error: "Missing params" }, { status: 400 })
    }

    const url = new URL(req.url)
    const section = url.searchParams.get('section') || 'all'

    const conn = await getConnectionById(id)

    const result: any = {}

    // Fonction helper pour récupérer les données avec gestion d'erreur
    const fetchSafe = async <T>(path: string): Promise<T | null> => {
      try {
        return await pveFetch<T>(conn, path)
      } catch {
        return null
      }
    }

    // Liste des disques physiques
    if (section === 'all' || section === 'disks') {
      const disks = await fetchSafe<any[]>(`/nodes/${encodeURIComponent(node)}/disks/list`)
      result.disks = Array.isArray(disks) ? disks.map(disk => ({
        devpath: disk.devpath,
        serial: disk.serial,
        size: disk.size,
        model: disk.model,
        vendor: disk.vendor,
        wwn: disk.wwn,
        health: disk.health,
        type: disk.type, // ssd, hdd, nvme
        rpm: disk.rpm,
        wearout: disk.wearout,
        gpt: disk.gpt,
        used: disk.used, // 'LVM', 'ZFS', 'partitions', etc.
        osdid: disk.osdid,
        mounted: disk.mounted,
        filesystem: disk.filesystem,
      })) : []
    }

    // LVM - Volume Groups
    if (section === 'all' || section === 'lvm') {
      const lvm = await fetchSafe<any[]>(`/nodes/${encodeURIComponent(node)}/disks/lvm`)
      result.lvm = Array.isArray(lvm) ? lvm.map(vg => ({
        name: vg.vg || vg.name,
        size: vg.size,
        free: vg.free,
        lvcount: vg.lvcount || vg.lv_count,
        pvcount: vg.pvcount || vg.pv_count,
        // Informations sur les Physical Volumes
        children: vg.children || vg.pvs || []
      })) : []
    }

    // LVM-Thin - Thin Pools
    if (section === 'all' || section === 'lvmthin') {
      const lvmthin = await fetchSafe<any[]>(`/nodes/${encodeURIComponent(node)}/disks/lvmthin`)
      result.lvmthin = Array.isArray(lvmthin) ? lvmthin.map(tp => ({
        lv: tp.lv,
        vg: tp.vg,
        lv_size: tp.lv_size,
        used: tp.used,
        metadata_size: tp.metadata_size,
        metadata_used: tp.metadata_used,
      })) : []
    }

    // Directory storages
    if (section === 'all' || section === 'directory') {
      const directory = await fetchSafe<any[]>(`/nodes/${encodeURIComponent(node)}/disks/directory`)
      result.directory = Array.isArray(directory) ? directory.map(dir => ({
        path: dir.path,
        device: dir.device,
        options: dir.options,
        type: dir.type,
        unitfile: dir.unitfile,
      })) : []
    }

    // ZFS pools
    if (section === 'all' || section === 'zfs') {
      const zfs = await fetchSafe<any[]>(`/nodes/${encodeURIComponent(node)}/disks/zfs`)
      result.zfs = Array.isArray(zfs) ? zfs.map(pool => ({
        name: pool.name,
        size: pool.size,
        alloc: pool.alloc,
        free: pool.free,
        frag: pool.frag,
        dedup: pool.dedup,
        health: pool.health,
        // Détails des vdevs si disponibles
        children: pool.children || []
      })) : []
      
      // Pour chaque pool ZFS, récupérer les détails si demandé
      if (result.zfs && result.zfs.length > 0) {
        for (const pool of result.zfs) {
          const details = await fetchSafe<any>(`/nodes/${encodeURIComponent(node)}/disks/zfs/${encodeURIComponent(pool.name)}`)
          if (details) {
            pool.children = details.children || []
            pool.action = details.action
            pool.errors = details.errors
            pool.scan = details.scan
            pool.status = details.status
          }
        }
      }
    }

    // Smart data pour un disque spécifique (optionnel)
    const diskParam = url.searchParams.get('disk')
    if (diskParam) {
      const smart = await fetchSafe<any>(`/nodes/${encodeURIComponent(node)}/disks/smart?disk=${encodeURIComponent(diskParam)}`)
      result.smart = smart
    }

    return NextResponse.json({ data: result })

  } catch (e: any) {
    console.error("[disks/node] Error:", e?.message)
    return NextResponse.json({ error: e?.message || "Failed to fetch disks data" }, { status: 500 })
  }
}
