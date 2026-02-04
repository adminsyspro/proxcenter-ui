// src/lib/proxmox/mappers.ts
import { ProxmoxResource } from "./types"

function parseVmid(r: any): string | null {
  // Proxmox /cluster/resources renvoie souvent id="qemu/7050" ou "lxc/101"
  // Certains endpoints peuvent remonter id déjà typé
  if (r.vmid !== undefined && r.vmid !== null) return String(r.vmid)

  const rid = String(r.id ?? "")

  // capture ".../7050" à la fin
  const m = rid.match(/\/(\d+)$/)

  
return m ? m[1] : null
}

export function mapClusterResource(r: any): ProxmoxResource {
  const vmid = parseVmid(r)

  // id stable pour DataGrid
  const stableId = r.id ? `${r.type}-${String(r.id)}` : `${r.type}-${vmid ?? r.node ?? r.name ?? "unknown"}`

  // Tags: Proxmox peut renvoyer une string séparée par des virgules ou un tableau
  let tags: string[] = []

  if (r.tags) {
    if (Array.isArray(r.tags)) {
      tags = r.tags
    } else if (typeof r.tags === 'string') {
      tags = r.tags.split(/[,;]/).map((t: string) => t.trim()).filter(Boolean)
    }
  }

  return {
    id: stableId,
    type: String(r.type ?? ""),
    name: r.name ?? r.node ?? r.storage ?? (vmid ? `VM ${vmid}` : "—"),
    node: r.node,
    status: r.status,
    cpu: r.cpu,
    mem: r.mem,
    maxmem: r.maxmem,
    disk: r.disk,
    maxdisk: r.maxdisk,
    uptime: r.uptime,
    pool: r.pool || null,
    tags: tags,
    template: r.template === 1 || r.template === true,

    // ✅ Ajouts indispensables
    vmid: vmid ? Number(vmid) : undefined,
  } as any
}
