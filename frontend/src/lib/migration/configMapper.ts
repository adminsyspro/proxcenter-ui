/**
 * Map ESXi VM configuration to Proxmox VE VM creation parameters
 */

import type { EsxiVmConfig } from "@/lib/vmware/soap"

export interface PveVmCreateParams {
  vmid: number
  name: string
  ostype: string
  cores: number
  sockets: number
  memory: number
  cpu: string
  scsihw: string
  bios: string
  machine: string
  boot: string
  agent: string
  // Network
  net0: string
  // EFI disk (only if firmware=efi)
  efidisk0?: string
}

/** Map ESXi guest ID / guest full name to Proxmox ostype */
function mapOsType(guestId: string, guestOS: string): string {
  const id = (guestId || "").toLowerCase()
  const name = (guestOS || "").toLowerCase()

  if (id.includes("win11") || name.includes("windows 11")) return "win11"
  if (id.includes("win10") || name.includes("windows 10")) return "win10"
  if (id.includes("windows9") || name.includes("windows 8")) return "win8"
  if (id.includes("windows7") || name.includes("windows 7")) return "win7"
  if (id.includes("windows") || name.includes("windows")) return "win10"
  if (id.includes("ubuntu") || id.includes("debian") || id.includes("centos") || id.includes("rhel") ||
      id.includes("linux") || id.includes("sles") || id.includes("fedora") || id.includes("oracle") ||
      name.includes("linux") || name.includes("ubuntu") || name.includes("debian")) return "l26"
  if (id.includes("freebsd") || name.includes("freebsd")) return "other"
  return "l26"
}

/** Map ESXi NIC type to Proxmox network model */
function mapNicModel(nicType: string): string {
  switch (nicType) {
    case "Vmxnet3": return "virtio"
    case "E1000": return "e1000"
    case "E1000e": return "e1000"
    default: return "virtio"
  }
}

/** Detect if the VM is Windows-based */
export function isWindowsVm(config: EsxiVmConfig): boolean {
  const id = (config.guestId || "").toLowerCase()
  const name = (config.guestOS || "").toLowerCase()
  return id.includes("windows") || id.includes("win") || name.includes("windows")
}

/**
 * Generate Proxmox VM creation parameters from ESXi VM config
 */
export function mapEsxiToPveConfig(
  esxiConfig: EsxiVmConfig,
  targetVmid: number,
  targetStorage: string,
  networkBridge: string = "vmbr0",
): PveVmCreateParams {
  const isEfi = esxiConfig.firmware === "efi"
  const isWin = isWindowsVm(esxiConfig)

  // For Windows without virtio drivers, use LSI + e1000 initially for boot compatibility
  // For Linux, use virtio for best performance
  const scsihw = isWin ? "lsi" : "virtio-scsi-single"
  const nicModel = isWin ? "e1000" : mapNicModel(esxiConfig.nics[0]?.type || "Vmxnet3")

  const params: PveVmCreateParams = {
    vmid: targetVmid,
    name: esxiConfig.name.replace(/[^a-zA-Z0-9-]/g, "-").replace(/^-+|-+$/g, '').substring(0, 63) || 'vm',
    ostype: mapOsType(esxiConfig.guestId, esxiConfig.guestOS),
    cores: esxiConfig.numCoresPerSocket || esxiConfig.numCPU,
    sockets: esxiConfig.sockets,
    memory: esxiConfig.memoryMB,
    cpu: "host",
    scsihw,
    bios: isEfi ? "ovmf" : "seabios",
    machine: "q35",
    boot: "order=scsi0",
    agent: "1",
    net0: `${nicModel},bridge=${networkBridge}`,
  }

  if (isEfi) {
    params.efidisk0 = `${targetStorage}:1,efitype=4m,pre-enrolled-keys=0`
  }

  return params
}
