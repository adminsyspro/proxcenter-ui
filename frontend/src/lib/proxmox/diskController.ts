/**
 * Which controller a guest disk sits on, as the hardware tab shows it (#1000:
 * after a migration, the operator checks at a glance that the disks landed on
 * VirtIO). A `scsiN` disk sits on the VM's SCSI controller (`scsihw`); the
 * other buses carry their own.
 */

/** Display names of the Proxmox SCSI controller models (`scsihw`). */
export const SCSI_CONTROLLER_LABELS: Record<string, string> = {
  'lsi': 'LSI 53C895A', 'lsi53c810': 'LSI 53C810',
  'megasas': 'MegaRAID SAS 8708EM2', 'pvscsi': 'VMware PVSCSI',
  'virtio-scsi-pci': 'VirtIO SCSI', 'virtio-scsi-single': 'VirtIO SCSI single',
}

/** Display name of a `scsihw` value; Proxmox's default when absent. */
export function scsiControllerLabel(scsihw?: string | null): string {
  const hw = scsihw || 'virtio-scsi-single'
  return SCSI_CONTROLLER_LABELS[hw] || hw
}

/**
 * The controller of a disk slot (`scsi0`, `virtio1`, `sata0`, `ide2`), and
 * whether it is a VirtIO one. Null for what is not a bus slot (efidisk0,
 * tpmstate0, unusedN, a container's rootfs/mpN).
 */
export function diskControllerLabel(diskId: string, scsihw?: string | null): { label: string; virtio: boolean } | null {
  const bus = /^(scsi|virtio|sata|ide)\d+$/.exec(diskId || '')?.[1]
  if (!bus) return null
  if (bus === 'scsi') {
    const hw = scsihw || 'virtio-scsi-single'
    return { label: scsiControllerLabel(hw), virtio: hw.startsWith('virtio') }
  }
  if (bus === 'virtio') return { label: 'VirtIO Block', virtio: true }
  return { label: bus === 'sata' ? 'SATA' : 'IDE', virtio: false }
}
