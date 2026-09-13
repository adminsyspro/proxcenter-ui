/**
 * Map ESXi VM configuration to Proxmox VE VM creation parameters
 */

import type { EsxiVmConfig, EsxiDiskInfo } from "@/lib/vmware/soap"
import { vmwareToolsState } from "@/lib/vmware/soap"

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
  machine: "q35" | "pc"
  boot: string
  /** Slot of the boot disk: the IDE disk sitting first on its bus, else the first source disk, else the #653 default. */
  bootDiskSlot: string
  /** Target slot of every source disk, in source listing order (`ide2`, `sata0`, `scsi1`…), see planDiskSlots. */
  diskSlots: string[]
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

/** Proxmox slot capacity per bus (`qemu-server`: ide0-3, sata0-5, scsi0-30). */
const MAX_SLOTS: Record<"ide" | "sata" | "scsi", number> = { ide: 4, sata: 6, scsi: 31 }

/** vSphere IDE controllers carry fixed keys 200 and 201 (two units each), which is exactly Proxmox's `ideN` = controller N/2, unit N%2. */
function idePosition(d: Pick<EsxiDiskInfo, "controllerKey" | "unitNumber">): number | undefined {
  if (d.controllerKey === undefined || d.unitNumber === undefined) return undefined
  const controller = d.controllerKey - 200
  if (controller < 0 || controller > 1 || d.unitNumber < 0 || d.unitNumber > 1) return undefined
  return controller * 2 + d.unitNumber
}

function busOf(d: Pick<EsxiDiskInfo, "controllerType">): "ide" | "sata" | "scsi" {
  const t = (d.controllerType || "").toLowerCase()
  return t === "ide" || t === "sata" ? t : "scsi"
}

/**
 * One target slot per source disk, on the bus the guest already knows.
 *
 * A raw block copy carries the guest's drivers exactly as they are, so a disk
 * must come back on a controller the guest can boot from without a new driver:
 * - a disk on an IDE controller stays on IDE, at its source position. A closed
 *   appliance built for legacy IDE (a PBX image, a firewall) finds its disks
 *   where its bootloader expects them (field case: a four-disk IPvA appliance,
 *   `ide0:0` to `ide1:1`, which the old SCSI-only mapping left unbootable);
 * - a disk on a SATA controller stays on SATA (six slots on Proxmox, the
 *   overflow goes to SCSI);
 * - a disk on a SCSI controller follows the #653 rule: the boot disk of a
 *   Windows or UEFI guest goes to `sata0`, everything else to `scsiN`.
 * A slot is never handed out twice, and the boot disk claims first: a Windows
 * SCSI boot disk on `sata0` pushes a SATA data disk to `sata1`. A disk whose
 * exact position is unknown, or already taken, gets the next free slot of its
 * bus, in listing order.
 */
export function planDiskSlots(
  disks: Pick<EsxiDiskInfo, "controllerType" | "controllerKey" | "unitNumber">[],
  opts: { bootOnSata: boolean },
): string[] {
  const taken = new Set<string>()
  const claim = (bus: "ide" | "sata" | "scsi", preferred?: number): string | undefined => {
    const candidates = preferred !== undefined && preferred < MAX_SLOTS[bus]
      ? [preferred, ...Array.from({ length: MAX_SLOTS[bus] }, (_, n) => n)]
      : Array.from({ length: MAX_SLOTS[bus] }, (_, n) => n)
    for (const n of candidates) {
      const slot = `${bus}${n}`
      if (!taken.has(slot)) { taken.add(slot); return slot }
    }
    return undefined
  }
  const exact = (bus: "ide" | "sata" | "scsi", n: number): string | undefined => {
    const slot = `${bus}${n}`
    if (n >= MAX_SLOTS[bus] || taken.has(slot)) return undefined
    taken.add(slot)
    return slot
  }

  const slots: (string | undefined)[] = disks.map(() => undefined)
  // Pass 1, exact positions: the boot disk of a Windows/UEFI SCSI guest takes
  // sata0, IDE and SATA disks take their source position when it is free.
  disks.forEach((d, i) => {
    const bus = busOf(d)
    if (bus === "ide") {
      const pos = idePosition(d)
      if (pos !== undefined) slots[i] = exact("ide", pos)
    } else if (bus === "sata") {
      if (d.unitNumber !== undefined) slots[i] = exact("sata", d.unitNumber)
    } else if (i === 0 && opts.bootOnSata) {
      slots[i] = exact("sata", 0)
    }
  })
  // Pass 2, everything still unplaced: next free slot of its bus, SCSI once a
  // small bus is full, at the listing index when that one is free (the SCSI
  // data disks therefore keep their historical `scsiN`).
  disks.forEach((d, i) => {
    if (slots[i]) return
    const bus = busOf(d)
    slots[i] = (bus === "scsi" ? undefined : claim(bus)) ?? claim("scsi", i) ?? `scsi${i}`
  })
  return slots as string[]
}

/**
 * Which slot the target boots from. Several IDE disks boot from the lowest IDE
 * position, as the appliance's BIOS did on vSphere; otherwise the first source
 * disk, as before. Without any disk, the #653 default the callers relied on.
 */
function bootSlotOf(slots: string[], fallback: string): string {
  const ide = slots.filter(s => s.startsWith("ide")).sort((a, b) => Number(a.slice(3)) - Number(b.slice(3)))
  return ide[0] ?? slots[0] ?? fallback
}

/**
 * Generate Proxmox VM creation parameters from ESXi VM config
 */
export function mapEsxiToPveConfig(
  esxiConfig: EsxiVmConfig,
  targetVmid: number,
  targetStorage: string,
  networkBridge: string = "vmbr0",
  vlanTag?: number,
): PveVmCreateParams {
  const isEfi = esxiConfig.firmware === "efi"
  const isWin = isWindowsVm(esxiConfig)

  // virtio-scsi for every guest: data disks appear as soon as VirtIO drivers are
  // installed. The boot disk cannot rely on that (a raw byte copy never has a
  // boot-start VirtIO driver), so Windows boots from SATA — AHCI is inbox and
  // boot-start in every supported Windows. The old `lsi` fallback bluescreened
  // every modern Windows with INACCESSIBLE_BOOT_DEVICE: no inbox LSI driver
  // since the XP era (#653).
  const scsihw = "virtio-scsi-single"
  const nicModel = isWin ? "e1000" : mapNicModel(esxiConfig.nics[0]?.type || "Vmxnet3")
  // Boot disk bus: SATA when the firmware is OVMF (existing rule — OVMF cannot
  // enumerate an LSI controller) or the guest is Windows (#653). Data disks
  // stay on SCSI. IDE and SATA source disks keep their bus, see planDiskSlots.
  const diskSlots = planDiskSlots(esxiConfig.disks, { bootOnSata: isEfi || isWin })
  const bootDiskSlot = bootSlotOf(diskSlots, isEfi || isWin ? "sata0" : "scsi0")
  // q35 has no legacy IDE controller: Proxmox hangs its `ideN` off the ICH9 AHCI,
  // where only one unit per port exists (ide1 and ide3 cannot even be created)
  // and a guest built for PIIX IDE finds no disk. Any IDE slot means i440fx.
  const machine: "q35" | "pc" = diskSlots.some(s => s.startsWith("ide")) ? "pc" : "q35"
  // A guest that never had VMware Tools will not get a QEMU agent either (a
  // closed appliance); leaving the agent enabled only makes every Proxmox
  // shutdown wait for an agent that will never answer.
  const agent = vmwareToolsState(esxiConfig) === "not-installed" ? "0" : "1"

  const tagSuffix =
    typeof vlanTag === "number" && Number.isInteger(vlanTag) && vlanTag >= 1 && vlanTag <= 4094
      ? `,tag=${vlanTag}`
      : ""

  // Preserve the source NIC's MAC so the guest keeps its network identity.
  // Without this Proxmox assigns a fresh MAC, the guest (notably Windows) sees
  // a brand new adapter and its IP is stranded on the old "ghost" NIC. The
  // cold/virt-v2v path already does this (see v2vConfigMapper). Only set a
  // well-formed unicast MAC; the target boots after the source is powered off
  // (warm cutover / direct-ESXi power-off), so there is no MAC collision.
  const sourceMac = esxiConfig.nics[0]?.macAddress
  const macSuffix =
    sourceMac && /^([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/.test(sourceMac)
      ? `,macaddr=${sourceMac}`
      : ""

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
    machine,
    boot: `order=${bootDiskSlot}`,
    bootDiskSlot,
    diskSlots,
    agent,
    net0: `${nicModel},bridge=${networkBridge}${macSuffix}${tagSuffix}`,
  }

  if (isEfi) {
    // pre-enrolled-keys=1 mirrors the Proxmox GUI default for UEFI VMs:
    // OVMF ships with the standard Microsoft Secure Boot keys (PK, KEK,
    // db, dbx) so Windows (and signed Linux shim bootloaders) pass
    // Secure Boot verification after migration. Using =0 caused silent
    // boot failures when the source VM had Secure Boot enabled.
    params.efidisk0 = `${targetStorage}:1,efitype=4m,pre-enrolled-keys=1`
  }

  return params
}
