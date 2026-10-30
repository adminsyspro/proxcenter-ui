/**
 * Firmware, machine, TPM, disk bus and display of a template deployment.
 *
 * The disk pipeline used to create every VM with SeaBIOS, i440fx, the data
 * disk on `scsi0` and `vga: serial0`. A UEFI Windows image could not boot
 * (no OVMF, no EFI disk), a Windows image without the VirtIO SCSI driver
 * bluescreened on `scsi0`, and the ProxCenter console stayed black because it
 * only speaks noVNC. These helpers turn the wizard's choices into the PVE
 * create parameters, and read the same choices back from the VM template a
 * volume image was taken from.
 */

export const DEPLOY_BIOS = ['seabios', 'ovmf'] as const
export const DEPLOY_MACHINES = ['i440fx', 'q35'] as const
export const DEPLOY_DISK_BUSES = ['scsi', 'sata', 'virtio', 'ide'] as const
export const DEPLOY_DISPLAYS = ['std', 'serial0', 'qxl', 'virtio', 'vmware'] as const

export type DeployBios = typeof DEPLOY_BIOS[number]
export type DeployMachine = typeof DEPLOY_MACHINES[number]
export type DeployDiskBus = typeof DEPLOY_DISK_BUSES[number]
export type DeployDisplay = typeof DEPLOY_DISPLAYS[number]

export interface DeployFirmware {
  bios: DeployBios
  machine: DeployMachine
  tpm: boolean
  diskBus: DeployDiskBus
  vga: DeployDisplay
}

/** What the wizard and the deploy route fall back to for a non-Windows image. */
export const DEFAULT_FIRMWARE: DeployFirmware = {
  bios: 'seabios',
  machine: 'i440fx',
  tpm: false,
  diskBus: 'scsi',
  // Standard VGA keeps the noVNC console usable; `serial0: socket` is still
  // attached so a cloud image's serial getty keeps working too.
  vga: 'std',
}

/** PVE drive key of the data disk on the chosen bus (`ide2` is the cloud-init drive). */
export function dataDiskKey(bus: DeployDiskBus | undefined): string {
  return `${bus && DEPLOY_DISK_BUSES.includes(bus) ? bus : 'scsi'}0`
}

/** Windows 11 / Server 2022+ (`win11`) and Windows 10 / Server 2016-2019 (`win10`, `w2k16`, `w2k19`) boot in UEFI. */
export function isUefiWindowsOstype(ostype: string | null | undefined): boolean {
  return ['win11', 'win10', 'w2k19', 'w2k16'].includes(String(ostype || '').toLowerCase())
}

/**
 * Defaults for an image of this ostype. Windows gets UEFI + q35 + standard
 * VGA; Windows 11 / Server 2022+ also gets a TPM, which its setup requires.
 * The bus stays SCSI: a template-derived image overrides it with the bus its
 * disk boots from (see {@link hintsFromGuestConfig}).
 */
export function firmwareDefaultsForOstype(ostype: string | null | undefined): DeployFirmware {
  if (!isUefiWindowsOstype(ostype)) return { ...DEFAULT_FIRMWARE }
  return {
    ...DEFAULT_FIRMWARE,
    bios: 'ovmf',
    machine: 'q35',
    tpm: String(ostype).toLowerCase() === 'win11',
  }
}

/**
 * Create parameters for the firmware part of a VM. `storage` receives the
 * EFI vars disk and the TPM state; both are tiny (4 MiB at most).
 * `pre-enrolled-keys=1` ships the Microsoft Secure Boot keys, required by
 * Windows 11 / Server 2025 and harmless elsewhere.
 */
export function firmwareCreateParams(fw: Partial<DeployFirmware>, storage: string): Record<string, string> {
  const merged: DeployFirmware = { ...DEFAULT_FIRMWARE, ...stripUndefined(fw) }
  const params: Record<string, string> = {
    serial0: 'socket',
    vga: merged.vga,
  }
  // i440fx is PVE's default machine: leaving it out keeps the VM on the
  // newest i440fx version, as before.
  if (merged.machine === 'q35') params.machine = 'q35'
  if (merged.bios === 'ovmf') {
    params.bios = 'ovmf'
    params.efidisk0 = `${storage}:1,efitype=4m,pre-enrolled-keys=1`
  }
  if (merged.tpm) params.tpmstate0 = `${storage}:1,version=v2.0`
  return params
}

/** Hardware read back from the VM template a volume image was taken from. */
export interface TemplateHardwareHints extends Partial<DeployFirmware> {
  ostype?: string
  scsihw?: string
}

/** VMID owning a PVE volume (`store:9940/base-9940-disk-1.qcow2`, `rbd:vm-115-disk-1`), or null. */
export function vmidFromVolumeId(volumeId: string | null | undefined): number | null {
  const m = /(?:^|[:/])(?:base|vm)-(\d+)-disk-\d+/.exec(String(volumeId || ''))
  return m ? Number(m[1]) : null
}

const DRIVE_KEY_RE = /^(scsi|sata|virtio|ide)\d+$/

/**
 * Firmware and bus of the guest whose config owns `volumeId`. Only the fields
 * the config states are returned; the wizard keeps its defaults for the rest.
 * A linked clone's drive reads `base-…/vm-…`, so the match is on the volume
 * part before the first comma, and also accepts the base volume path as a
 * prefix of the drive's volume.
 */
export function hintsFromGuestConfig(config: Record<string, unknown> | null | undefined, volumeId: string): TemplateHardwareHints {
  if (!config) return {}
  const hints: TemplateHardwareHints = {}

  hints.bios = config.bios === 'ovmf' ? 'ovmf' : 'seabios'
  hints.machine = /q35/.test(String(config.machine || '')) ? 'q35' : 'i440fx'
  hints.tpm = typeof config.tpmstate0 === 'string' && config.tpmstate0.length > 0

  const vga = String(config.vga || '').split(',')[0]
  if ((DEPLOY_DISPLAYS as readonly string[]).includes(vga)) hints.vga = vga as DeployDisplay
  else if (!vga) hints.vga = 'std'

  for (const [key, value] of Object.entries(config)) {
    const bus = DRIVE_KEY_RE.exec(key)?.[1]
    if (!bus || typeof value !== 'string') continue
    const volume = value.split(',')[0]
    if (volume === volumeId || volume.startsWith(`${volumeId}/`)) {
      hints.diskBus = bus as DeployDiskBus
      break
    }
  }

  if (typeof config.ostype === 'string' && config.ostype) hints.ostype = config.ostype
  if (typeof config.scsihw === 'string' && config.scsihw) hints.scsihw = config.scsihw
  return hints
}

function stripUndefined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>
}
