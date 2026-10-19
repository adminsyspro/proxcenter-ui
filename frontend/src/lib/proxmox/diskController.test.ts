import { describe, it, expect } from 'vitest'

import { diskControllerLabel, scsiControllerLabel } from './diskController'

describe('diskControllerLabel (#1000)', () => {
  it('names the SCSI controller of a scsiN disk, VirtIO or not', () => {
    expect(diskControllerLabel('scsi0', 'virtio-scsi-single')).toEqual({ label: 'VirtIO SCSI single', virtio: true })
    expect(diskControllerLabel('scsi3', undefined)).toEqual({ label: 'VirtIO SCSI single', virtio: true })
    expect(diskControllerLabel('scsi1', 'lsi')).toEqual({ label: 'LSI 53C895A', virtio: false })
    expect(diskControllerLabel('scsi1', 'some-new-model')).toEqual({ label: 'some-new-model', virtio: false })
  })

  it('names the other buses', () => {
    expect(diskControllerLabel('virtio0', 'lsi')).toEqual({ label: 'VirtIO Block', virtio: true })
    expect(diskControllerLabel('sata0')).toEqual({ label: 'SATA', virtio: false })
    expect(diskControllerLabel('ide2')).toEqual({ label: 'IDE', virtio: false })
  })

  it('says nothing for what is not a bus slot', () => {
    for (const id of ['efidisk0', 'tpmstate0', 'unused0', 'rootfs', 'mp0', '']) expect(diskControllerLabel(id)).toBeNull()
  })

  it('labels the scsihw values', () => {
    expect(scsiControllerLabel('pvscsi')).toBe('VMware PVSCSI')
    expect(scsiControllerLabel(null)).toBe('VirtIO SCSI single')
  })
})
