import { describe, it, expect } from "vitest"
import { planV2vImports, v2vDiskSlot } from "./v2v-disk-targets"

const FILES = ["vm-sda", "vm-sdb", "vm-sdc"]
const GiB = 1073741824
const disks = (...sizes: number[]) => sizes.map(capacityBytes => ({ capacityBytes }))

describe("planV2vImports", () => {
  it("imports every file onto the default storage, in order, when there are no per-disk choices", () => {
    const plan = planV2vImports(FILES, null, undefined, "local")
    expect(plan.excluded).toEqual([])
    expect(plan.imports).toEqual([
      { sourceIndex: 0, file: "vm-sda", storage: "local", slotIndex: 0, capacityBytes: undefined },
      { sourceIndex: 1, file: "vm-sdb", storage: "local", slotIndex: 1, capacityBytes: undefined },
      { sourceIndex: 2, file: "vm-sdc", storage: "local", slotIndex: 2, capacityBytes: undefined },
    ])
  })

  it("carries the source capacities only when the source list lines up with the output", () => {
    const aligned = planV2vImports(FILES, disks(GiB, 2 * GiB, 3 * GiB), undefined, "local")
    expect(aligned.imports.map(d => d.capacityBytes)).toEqual([GiB, 2 * GiB, 3 * GiB])
    // the VM changed since the inspection: no capacity is trusted, nothing fails
    const shorter = planV2vImports(FILES, disks(GiB, 2 * GiB), undefined, "local")
    expect(shorter.imports).toHaveLength(3)
    expect(shorter.imports.every(d => d.capacityBytes === undefined)).toBe(true)
  })

  it("places each file on the storage chosen for its source disk and skips an excluded one without leaving a slot gap", () => {
    const plan = planV2vImports(
      FILES,
      disks(GiB, 2 * GiB, 3 * GiB),
      [{ index: 1, exclude: true }, { index: 2, targetStorage: "ceph" }],
      "local",
    )
    expect(plan.excluded).toEqual([{ sourceIndex: 1, file: "vm-sdb" }])
    expect(plan.imports).toEqual([
      { sourceIndex: 0, file: "vm-sda", storage: "local", slotIndex: 0, capacityBytes: GiB },
      { sourceIndex: 2, file: "vm-sdc", storage: "ceph", slotIndex: 1, capacityBytes: 3 * GiB },
    ])
  })

  it("ignores a mapping for a disk position the source VM does not have", () => {
    const plan = planV2vImports(FILES.slice(0, 2), disks(GiB, GiB), [{ index: 5, targetStorage: "ceph" }], "local")
    expect(plan.imports.map(d => d.storage)).toEqual(["local", "local"])
    expect(plan.excluded).toEqual([])
  })

  it("refuses per-disk choices when the source disk list is not known", () => {
    expect(() => planV2vImports(FILES, null, [{ index: 1, targetStorage: "ceph" }], "local"))
      .toThrow(/source VM's disk list is not known/)
  })

  it("refuses per-disk choices when the number of converted files differs from the source disk count", () => {
    expect(() => planV2vImports(FILES, disks(GiB, GiB), [{ index: 1, exclude: true }], "local"))
      .toThrow(/the source VM has 2 disk\(s\) but virt-v2v produced 3 disk file\(s\) \(vm-sda, vm-sdb, vm-sdc\)/)
  })
})

describe("v2vDiskSlot", () => {
  it("puts a Windows boot disk on sata0 and the data disks on scsi0, scsi1...", () => {
    const bus = { winSataBoot: true, virtioBlk: false }
    expect([0, 1, 2].map(i => v2vDiskSlot(i, bus))).toEqual(["sata0", "scsi0", "scsi1"])
  })

  it("uses virtio-blk slots when virt-v2v lacks --block-driver, scsi otherwise", () => {
    expect([0, 1].map(i => v2vDiskSlot(i, { winSataBoot: false, virtioBlk: true }))).toEqual(["virtio0", "virtio1"])
    expect([0, 1].map(i => v2vDiskSlot(i, { winSataBoot: false, virtioBlk: false }))).toEqual(["scsi0", "scsi1"])
  })
})
