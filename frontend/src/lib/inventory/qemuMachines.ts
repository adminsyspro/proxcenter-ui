/** A versioned QEMU machine type a node supports, from PVE's capabilities/qemu/machines. */
export type QemuMachineVersion = {
  id: string
  type: 'i440fx' | 'q35'
  version: string
  changes: string | null
}
