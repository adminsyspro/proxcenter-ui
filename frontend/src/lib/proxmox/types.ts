// src/lib/proxmox/types.ts
export type ProxmoxResourceType =
  | "node"
  | "qemu"
  | "lxc"
  | "storage"

export type ProxmoxResource = {
  id: string
  type: ProxmoxResourceType
  name: string
  node?: string
  status?: string
  cpu?: number
  mem?: number
  maxmem?: number
  disk?: number
  maxdisk?: number
  uptime?: number
  vmid?: number
  tags?: string
}
