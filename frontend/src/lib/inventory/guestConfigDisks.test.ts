import { describe, expect, it } from "vitest"

import { isGuestDiskKey, sumGuestConfigDisks } from "./guestConfigDisks"

const G = 1024 ** 3

describe("sumGuestConfigDisks (#938)", () => {
  it("sums every bus of a VM, the EFI vars disk and the TPM state", () => {
    const config = {
      boot: "order=scsi0;ide2;net0",
      scsi0: "ZFS-Pool:vm-104-disk-0,size=20G",
      scsi1: "ZFS-Pool:vm-104-disk-1,iothread=1,size=16G",
      virtio0: "ceph:vm-104-disk-2,size=1T",
      sata0: "local-lvm:vm-104-disk-3,size=512M",
      ide0: "local-lvm:vm-104-disk-4,size=1048576",
      efidisk0: "local-lvm:vm-104-disk-5,efitype=4m,pre-enrolled-keys=1,size=528K",
      tpmstate0: "local-lvm:vm-104-disk-6,size=4M,version=v2.0",
      memory: "2048",
      net0: "virtio=BC:24:11:00:00:01,bridge=vmbr0",
    }

    expect(sumGuestConfigDisks(config, "qemu")).toBe(
      20 * G + 16 * G + 1024 * G + 512 * 1024 ** 2 + 1048576 + 528 * 1024 + 4 * 1024 ** 2,
    )
  })

  it("counts no optical drive, empty slot or cloud-init seed, even when it carries a size", () => {
    const config = {
      scsi0: "local-lvm:vm-1-disk-0,size=10G",
      ide2: "local:iso/debian.iso,media=cdrom,size=630M",
      ide0: "none,media=cdrom",
      ide1: "cdrom,media=cdrom",
      sata1: "none",
      ide3: "local-lvm:vm-1-cloudinit,media=cdrom,size=4M",
    }

    expect(sumGuestConfigDisks(config, "qemu")).toBe(10 * G)
  })

  it("leaves detached volumes and pending changes out", () => {
    const config = {
      scsi0: "local-lvm:vm-1-disk-0,size=8G",
      unused0: "local-lvm:vm-1-disk-1",
      unused1: "local-lvm:vm-1-disk-2,size=100G",
      pending: { scsi1: "local-lvm:vm-1-disk-3,size=50G" },
    }

    expect(sumGuestConfigDisks(config, "qemu")).toBe(8 * G)
  })

  it("reads the rootfs and every mount point of a container, a bind mount counting for nothing", () => {
    const config = {
      hostname: "ct",
      rootfs: "local-lvm:vm-200-disk-0,size=8G",
      mp0: "local-lvm:vm-200-disk-1,mp=/data,backup=1,size=32G",
      mp1: "/srv/host-share,mp=/mnt/share",
      unused0: "local-lvm:vm-200-disk-2,size=4G",
      scsi0: "not-a-container-key,size=99G",
    }

    expect(sumGuestConfigDisks(config, "lxc")).toBe(40 * G)
  })

  it("accepts the iB unit spelling and decimal sizes", () => {
    expect(sumGuestConfigDisks({ scsi0: "s:v,size=1.5TiB", scsi1: "s:v,size=2GiB" }, "qemu"))
      .toBe(Math.round(1.5 * 1024 * G) + 2 * G)
  })

  it("answers 0 for a guest without a disk and null when there is no config to read", () => {
    expect(sumGuestConfigDisks({ memory: "512", net0: "virtio,bridge=vmbr0" }, "qemu")).toBe(0)
    expect(sumGuestConfigDisks(null, "qemu")).toBeNull()
    expect(sumGuestConfigDisks(undefined, "lxc")).toBeNull()
    expect(sumGuestConfigDisks("scsi0: x", "qemu")).toBeNull()
    expect(sumGuestConfigDisks([], "qemu")).toBeNull()
  })

  it("ignores a disk key whose value is not a drive string", () => {
    expect(sumGuestConfigDisks({ scsi0: 42, scsi1: "s:v,size=1G" }, "qemu")).toBe(G)
  })
})

describe("isGuestDiskKey", () => {
  it("knows the disk keys of each guest type", () => {
    for (const key of ["scsi0", "virtio15", "ide3", "sata5", "efidisk0", "tpmstate0"]) {
      expect(isGuestDiskKey(key, "qemu")).toBe(true)
    }
    for (const key of ["unused0", "net0", "rootfs", "mp0", "scsihw", "efidisk1"]) {
      expect(isGuestDiskKey(key, "qemu")).toBe(false)
    }
    expect(isGuestDiskKey("rootfs", "lxc")).toBe(true)
    expect(isGuestDiskKey("mp9", "lxc")).toBe(true)
    expect(isGuestDiskKey("scsi0", "lxc")).toBe(false)
    expect(isGuestDiskKey("unused0", "lxc")).toBe(false)
  })
})
