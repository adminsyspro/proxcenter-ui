/**
 * Map XCP-ng (Xen Orchestra) VM configuration to Proxmox VE VM creation parameters
 */

import type { XoVmConfig } from "@/lib/xcpng/client"
import type { PveVmCreateParams } from "./configMapper"
import { MIGRATION_CPU_TYPE_DEFAULT } from "./cpu-type"
import { buildNetValue } from "./target-overrides"

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
  vlanTag?: number,
  cpuType: string = MIGRATION_CPU_TYPE_DEFAULT,
  options: { guestConverted?: boolean } = {},
): PveVmCreateParams {
  const isEfi = xoConfig.firmware === "uefi"
  const isWin = isWindowsXoVm(xoConfig)

  // virtio-scsi for every guest; Windows keeps e1000 (inbox driver). Boot disk
  // goes to SATA for Windows and EFI guests — same rule as the ESXi mapper: an
  // untouched Windows guest has no boot-start VirtIO (or LSI) driver and stops
  // with INACCESSIBLE_BOOT_DEVICE (#653). A guest converted at a warm cutover
  // (#1000) has the VirtIO drivers: SCSI boot disk and VirtIO NICs for all.
  const scsihw = "virtio-scsi-single"
  const nicModel = isWin && !options.guestConverted ? "e1000" : "virtio"
  const bootDiskSlot: "sata0" | "scsi0" = (isEfi || isWin) && !options.guestConverted ? "sata0" : "scsi0"
  // One slot per source disk, boot disk first then scsiN, so the attach steps
  // shared with the ESXi pipelines read the same list on both sources.
  const diskSlots = (xoConfig.disks || []).map((_, i) => i === 0 ? bootDiskSlot : `scsi${i}`)

  // Every VIF in device order, each with its source MAC: the guest keeps its
  // network identity (DHCP reservations, a configuration bound to the MAC),
  // and a converted Linux guest gets its interface names pinned to it.
  const vifs = [...(xoConfig.networks || [])].sort((a, b) => Number(a.device) - Number(b.device))
  const nets: Record<string, string> = {}
  for (const [i, vif] of vifs.entries()) nets[`net${i}`] = buildNetValue(nicModel, networkBridge, vif.mac, vlanTag)
  if (vifs.length === 0) nets.net0 = buildNetValue(nicModel, networkBridge, undefined, vlanTag)

  const params: PveVmCreateParams = {
    vmid: targetVmid,
    name: xoConfig.name.replace(/[^a-zA-Z0-9-]/g, "-").replace(/^-+|(?<!-)-+$/g, '').substring(0, 63) || 'vm',
    ostype: mapOsType(xoConfig.guestOS),
    cores: xoConfig.numCPU,
    sockets: 1,
    memory: xoConfig.memoryMB,
    cpu: cpuType,
    scsihw,
    bios: isEfi ? "ovmf" : "seabios",
    machine: "q35",
    boot: `order=${bootDiskSlot}`,
    bootDiskSlot,
    diskSlots,
    agent: "1",
    nets,
  }

  if (isEfi) {
    // pre-enrolled-keys=1 mirrors the Proxmox GUI default for UEFI VMs:
    // OVMF ships with the standard Microsoft Secure Boot keys so guests
    // (especially Windows) pass Secure Boot verification after migration.
    params.efidisk0 = `${targetStorage}:1,efitype=4m,pre-enrolled-keys=1`
  }

  return params
}
