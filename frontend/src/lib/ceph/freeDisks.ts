import { isBlockDevice } from './pvecephCommands'

/*
   The disks of a node an OSD can be created on (ui#1450), out of PVE's
   `GET /nodes/{n}/disks/list`: no use reported (partitions, LVM, ZFS, mounted,
   BIOS boot...), no OSD on it, and a device path the pveceph rule accepts.
   PVE itself refuses a disk in use; this only keeps the dialog honest.
*/

export interface FreeDisk {
  devpath: string
  sizeBytes: number
  model: string
  serial: string
  type: string
  wearout: string
}

const text = (v: unknown) => (typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v))

export function freeDisks(list: unknown): FreeDisk[] {
  const rows = Array.isArray(list) ? list : []
  return rows
    .filter((d: any) => d && isBlockDevice(d.devpath) && !d.used && !(Number(d.osdid) >= 0))
    .map((d: any) => ({
      devpath: d.devpath,
      sizeBytes: Number(d.size) || 0,
      model: text(d.model),
      serial: text(d.serial),
      type: text(d.type),
      wearout: text(d.wearout),
    }))
}
