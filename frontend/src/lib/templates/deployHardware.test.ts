import { describe, expect, it } from 'vitest'

import {
  DEFAULT_FIRMWARE,
  dataDiskKey,
  firmwareCreateParams,
  firmwareDefaultsForOstype,
  hintsFromGuestConfig,
  isUefiWindowsOstype,
  vmidFromVolumeId,
} from './deployHardware'

describe('dataDiskKey', () => {
  it('maps every bus to its first slot', () => {
    expect(dataDiskKey('scsi')).toBe('scsi0')
    expect(dataDiskKey('sata')).toBe('sata0')
    expect(dataDiskKey('virtio')).toBe('virtio0')
    expect(dataDiskKey('ide')).toBe('ide0')
  })

  it('falls back to scsi0 for a missing or unknown bus', () => {
    expect(dataDiskKey(undefined)).toBe('scsi0')
    expect(dataDiskKey('nvme' as any)).toBe('scsi0')
  })
})

describe('firmwareDefaultsForOstype', () => {
  it('keeps SeaBIOS, i440fx, SCSI and a standard display for Linux', () => {
    expect(firmwareDefaultsForOstype('l26')).toEqual(DEFAULT_FIRMWARE)
    expect(firmwareDefaultsForOstype(undefined)).toEqual(DEFAULT_FIRMWARE)
    expect(DEFAULT_FIRMWARE.vga).toBe('std')
  })

  it('gives Windows 11 / Server 2022+ UEFI, q35 and a TPM', () => {
    expect(firmwareDefaultsForOstype('win11')).toEqual({ bios: 'ovmf', machine: 'q35', tpm: true, diskBus: 'scsi', vga: 'std' })
  })

  it('gives older UEFI Windows UEFI and q35 without a TPM', () => {
    for (const ot of ['win10', 'w2k19', 'W2K16']) {
      expect(firmwareDefaultsForOstype(ot)).toMatchObject({ bios: 'ovmf', machine: 'q35', tpm: false })
    }
  })

  it('leaves legacy Windows on SeaBIOS', () => {
    expect(isUefiWindowsOstype('win7')).toBe(false)
    expect(firmwareDefaultsForOstype('wxp')).toEqual(DEFAULT_FIRMWARE)
  })
})

describe('firmwareCreateParams', () => {
  it('attaches a serial socket and a standard display by default, nothing else', () => {
    expect(firmwareCreateParams({}, 'local-lvm')).toEqual({ serial0: 'socket', vga: 'std' })
  })

  it('creates the EFI vars disk and the TPM state on the target storage for UEFI Windows', () => {
    expect(firmwareCreateParams({ bios: 'ovmf', machine: 'q35', tpm: true }, 'ceph')).toEqual({
      serial0: 'socket',
      vga: 'std',
      machine: 'q35',
      bios: 'ovmf',
      efidisk0: 'ceph:1,efitype=4m,pre-enrolled-keys=1',
      tpmstate0: 'ceph:1,version=v2.0',
    })
  })

  it('keeps a serial display when it is asked for', () => {
    expect(firmwareCreateParams({ vga: 'serial0' }, 's')).toEqual({ serial0: 'socket', vga: 'serial0' })
  })

  it('ignores undefined fields instead of overwriting the defaults', () => {
    expect(firmwareCreateParams({ bios: undefined, vga: undefined }, 's')).toEqual({ serial0: 'socket', vga: 'std' })
  })
})

describe('vmidFromVolumeId', () => {
  it('reads the owner of template, VM and block volumes', () => {
    expect(vmidFromVolumeId('Dir-Images:9940/base-9940-disk-1.qcow2')).toBe(9940)
    expect(vmidFromVolumeId('CephStoragePool:vm-115-disk-1')).toBe(115)
    expect(vmidFromVolumeId('local-lvm:base-100-disk-0')).toBe(100)
  })

  it('returns null for an image file that belongs to no guest', () => {
    expect(vmidFromVolumeId('local:import/debian-13.qcow2')).toBeNull()
    expect(vmidFromVolumeId(null)).toBeNull()
    expect(vmidFromVolumeId('local:iso/my-vm-12-disk-0.iso')).toBeNull()
  })
})

describe('hintsFromGuestConfig', () => {
  // Template 9940 of the lab: a UEFI Windows Server 2025 that boots from SATA.
  const template = {
    bios: 'ovmf',
    machine: 'pc-q35-11.0+pve2',
    efidisk0: 'Dir-Images:9940/base-9940-disk-0.qcow2,efitype=4m,ms-cert=2023k,pre-enrolled-keys=1,size=528K',
    sata0: 'Dir-Images:9940/base-9940-disk-1.qcow2,size=60G',
    tpmstate0: 'Dir-Images:9940/base-9940-disk-2.raw,size=4M,version=v2.0',
    vga: 'std',
    ostype: 'win10',
    scsihw: 'virtio-scsi-single',
    template: 1,
  }

  it('reads firmware, machine, TPM, the bus of the image volume, display and ostype', () => {
    expect(hintsFromGuestConfig(template, 'Dir-Images:9940/base-9940-disk-1.qcow2')).toEqual({
      bios: 'ovmf',
      machine: 'q35',
      tpm: true,
      diskBus: 'sata',
      vga: 'std',
      ostype: 'win10',
      scsihw: 'virtio-scsi-single',
    })
  })

  it('matches a linked clone drive on its base volume', () => {
    const linked = { scsi1: 'Dir-Images:9940/base-9940-disk-1.qcow2/9942/vm-9942-disk-1.qcow2,size=60G' }
    expect(hintsFromGuestConfig(linked, 'Dir-Images:9940/base-9940-disk-1.qcow2').diskBus).toBe('scsi')
  })

  it('reads a SeaBIOS i440fx guest without TPM, and a missing vga as standard', () => {
    expect(hintsFromGuestConfig({ virtio0: 'local-lvm:vm-100-disk-0,size=8G' }, 'local-lvm:vm-100-disk-0')).toEqual({
      bios: 'seabios',
      machine: 'i440fx',
      tpm: false,
      diskBus: 'virtio',
      vga: 'std',
    })
  })

  it('keeps a known display type and drops an unknown one', () => {
    expect(hintsFromGuestConfig({ vga: 'serial0' }, 'x').vga).toBe('serial0')
    expect(hintsFromGuestConfig({ vga: 'qxl,memory=32' }, 'x').vga).toBe('qxl')
    expect(hintsFromGuestConfig({ vga: 'cirrus' }, 'x').vga).toBeUndefined()
  })

  it('leaves the bus out when no drive holds the volume, and ignores cdroms that are not strings', () => {
    const hints = hintsFromGuestConfig({ ide2: 'none,media=cdrom', scsi0: 42 as any }, 'store:vm-1-disk-0')
    expect(hints.diskBus).toBeUndefined()
  })

  it('returns nothing for a missing config', () => {
    expect(hintsFromGuestConfig(null, 'x')).toEqual({})
  })
})
