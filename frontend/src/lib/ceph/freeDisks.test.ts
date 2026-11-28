import { describe, expect, it } from 'vitest'

import lab from './__fixtures__/disks-list-lab.json'
import { freeDisks } from './freeDisks'

/*
   ui#1450: the disks of a node an OSD can be created on, out of PVE's
   /nodes/{n}/disks/list. A disk PVE reports as used (partitions, LVM, ZFS,
   an OSD already) is never offered.
*/

describe('freeDisks', () => {
  it('offers nothing on the lab node, whose disks are all used', () => {
    expect(freeDisks(lab)).toEqual([])
  })

  it('offers a disk without a use, with its size, model and type', () => {
    const blank = { devpath: '/dev/sdg', size: 10737418240, model: 'QEMU_HARDDISK', serial: 'drive-scsi6', type: 'hdd', wearout: 'N/A', osdid: -1, gpt: 0, health: 'OK' }
    expect(freeDisks([...lab, blank])).toEqual([{ devpath: '/dev/sdg', sizeBytes: 10737418240, model: 'QEMU_HARDDISK', serial: 'drive-scsi6', type: 'hdd', wearout: 'N/A' }])
  })

  it('leaves out an OSD disk, a used disk and a path a command could not take', () => {
    const rows = [
      { devpath: '/dev/sdh', size: 1, osdid: 4 },
      { devpath: '/dev/sdi', size: 1, used: 'partitions' },
      { devpath: '/dev/sd j', size: 1 },
      { devpath: '/tmp/x', size: 1 },
      null,
    ]
    expect(freeDisks(rows)).toEqual([])
  })

  it('reads anything that is not a list as no disk', () => {
    expect(freeDisks(null)).toEqual([])
    expect(freeDisks({ data: [] })).toEqual([])
  })
})
