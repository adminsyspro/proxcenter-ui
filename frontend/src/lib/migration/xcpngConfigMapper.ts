/**
 * Map XCP-ng (Xen Orchestra) VM configuration to Proxmox VE VM creation parameters
 */

import type { XoVmConfig } from "@/lib/xcpng/client"
import type { PveVmCreateParams } from "./configMapper"

/** Map XO guest OS string to Proxmox ostype */
function mapOsType(guestOS: string): string {
  const os = (guestOS || "").toLowerCase()

  if (os.includes("windows 11")) return "win11"
  if (os.includes("windows 10")) return "win10"
  if (os.includes("windows 8")) return "win8"
  if (os.includes("windows 7")) return "win7"
  if (os.includes("windows server 2022") || os.includes("windows server 2025")) return "win11"
  if (os.includes("windows server 2019") || os.includes("windows server 2016")) return "win10"
  if (os.includes("windows")) return "win10"
  if (os.includes("ubuntu") || os.includes("debian") || os.includes("centos") ||
      os.includes("rhel") || os.includes("red hat") || os.includes("fedora") ||
      os.includes("suse") || os.includes("oracle") || os.includes("linux") ||
      os.includes("alma") || os.includes("rocky")) return "l26"
  if (os.includes("freebsd")) return "other"
  return "l26"
}

/** Detect if the VM is Windows-based */
export function isWindowsXoVm(config: XoVmConfig): boolean {
  return (config.guestOS || "").toLowerCase().includes("windows")
}

/**
 * Generate Proxmox VM creation parameters from XO VM config
 */
export function mapXoToPveConfig(
  xoConfig: XoVmConfig,
  targetVmid: number,
  targetStorage: string,
  networkBridge: string = "vmbr0",
): PveVmCreateParams {
  const isEfi = xoConfig.firmware === "uefi"
  const isWin = isWindowsXoVm(xoConfig)

  // XCP-ng VMs often use paravirtualized drivers already
  // For Windows: use LSI + e1000 for safe boot compatibility
  // For Linux: use virtio since XO Linux VMs are usually already using PV drivers
  const scsihw = isWin ? "lsi" : "virtio-scsi-single"
  const nicModel = isWin ? "e1000" : "virtio"

  const params: PveVmCreateParams = {
    vmid: targetVmid,
    name: xoConfig.name.replace(/[^a-zA-Z0-9-]/g, "-").replace(/^-+|-+$/g, '').substring(0, 63) || 'vm',
    ostype: mapOsType(xoConfig.guestOS),
    cores: xoConfig.numCPU,
    sockets: 1,
    memory: xoConfig.memoryMB,
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
