import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/ssh/exec", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/ssh/exec")>()
  return { ...actual, executeSSH: vi.fn() }
})
import { executeSSH } from "@/lib/ssh/exec"
import {
  allocateBlockVolumeAndResolvePath,
  allocateAndMapBlockVolume,
  nextFreeDiskName,
  reserveVolumeSlot,
  volumesToFree,
  volumesToKeep,
  type AllocatedVolume,
} from "./pvesm-alloc"

const mockSSH = executeSSH as unknown as ReturnType<typeof vi.fn>

const created = (volumeId: string) => ({ success: true, output: `successfully created '${volumeId}'` })
const path = (dev: string) => ({ success: true, output: dev })
/** What pvesm really returns on failure: the message on stdout (the command runs
 *  with 2>&1) and a meaningless exit code as the error. */
const failed = (message: string) => ({ success: false, output: message, error: "Exit code 17" })

const LVM_COLLISION =
  `lvcreate 'FC-HDC-01/vm-250-disk-2' error:   Logical Volume "vm-250-disk-2" already exists in volume group "FC-HDC-01"`

beforeEach(() => {
  mockSSH.mockReset()
})

describe("allocateBlockVolumeAndResolvePath", () => {
  it("asks pvesm for a raw volume so PVE 9 does not format the LV as qcow2 (#587)", async () => {
    mockSSH
      .mockResolvedValueOnce(created("FC-HDC-01:vm-250-disk-1"))
      .mockResolvedValueOnce(path("/dev/FC-HDC-01/vm-250-disk-1"))

    await allocateBlockVolumeAndResolvePath("conn-1", "10.0.0.1", "FC-HDC-01", 250, "vm-250-disk-1", 20971520)

    expect(mockSSH.mock.calls[0][2]).toContain("--format raw")
  })

  it("lets a multi-TB allocation run past the 30 s executeSSH default", async () => {
    mockSSH
      .mockResolvedValueOnce(created("FC-HDC-01:vm-250-disk-1"))
      .mockResolvedValueOnce(path("/dev/FC-HDC-01/vm-250-disk-1"))

    await allocateBlockVolumeAndResolvePath("conn-1", "10.0.0.1", "FC-HDC-01", 250, "vm-250-disk-1", 3251404800)

    // 3.1 TB took 47 s on the reporter's FC array, and thick plugins take minutes.
    expect(mockSSH.mock.calls[0][3]).toBeGreaterThanOrEqual(5 * 60_000)
  })

  it("registers the volume BEFORE allocating so an alloc that creates it then fails is still freed (#587)", async () => {
    const slot: AllocatedVolume = { volumeId: "", devicePath: "" }
    mockSSH.mockImplementationOnce(async () => {
      // The volume must already be registered for cleanup while pvesm is still
      // running: it can create the volume and report a failure afterwards.
      expect(slot.volumeId).toBe("FC-HDC-01:vm-250-disk-2")
      return failed('  Logical volume "vm-250-disk-2" created.\nunable to create image')
    })

    await expect(
      allocateBlockVolumeAndResolvePath("conn-1", "10.0.0.1", "FC-HDC-01", 250, "vm-250-disk-2", 3251404800, { slot }),
    ).rejects.toThrow(/unable to create image/)

    // Still registered after the failure: the volume may well exist on the storage.
    expect(volumesToFree([slot])).toEqual([slot])
  })

  it("un-registers a name that turned out to be taken — a pre-existing volume is not ours to free", async () => {
    // Every attempt collides, so nothing was created by us. Freeing the last name
    // tried would delete a volume that belongs to whoever left it there.
    mockSSH.mockResolvedValue(failed(LVM_COLLISION))
    const slot: AllocatedVolume = { volumeId: "", devicePath: "" }

    await expect(
      allocateBlockVolumeAndResolvePath("conn-1", "10.0.0.1", "FC-HDC-01", 250, "vm-250-disk-2", 20971520, { slot }),
    ).rejects.toThrow(/already exists/)

    expect(slot.volumeId).toBe("")
    expect(volumesToFree([slot])).toEqual([])
  })

  it("surfaces the pvesm message and not the meaningless exit code", async () => {
    mockSSH.mockResolvedValueOnce(
      failed(`lvcreate 'FC-HDC-01/vm-250-disk-1' error:   Volume group "FC-HDC-01" has insufficient free space`),
    )

    // pvesm is Perl: `die` exits with the current errno, and the cluster lock
    // helper leaves EEXIST (17) behind, so "Exit code 17" says nothing at all.
    let message = ""
    try {
      await allocateBlockVolumeAndResolvePath("conn-1", "10.0.0.1", "FC-HDC-01", 250, "vm-250-disk-1", 20971520)
    } catch (e) {
      message = (e as Error).message
    }

    expect(message).toContain("insufficient free space")
    expect(message).not.toContain("Exit code 17")
  })

  it("bumps the disk number when a leftover volume already owns the name", async () => {
    const slot: AllocatedVolume = { volumeId: "", devicePath: "" }
    mockSSH
      .mockResolvedValueOnce(failed(LVM_COLLISION))
      .mockResolvedValueOnce(created("FC-HDC-01:vm-250-disk-3"))
      .mockResolvedValueOnce(path("/dev/FC-HDC-01/vm-250-disk-3"))

    const res = await allocateBlockVolumeAndResolvePath(
      "conn-1", "10.0.0.1", "FC-HDC-01", 250, "vm-250-disk-2", 3251404800, { slot },
    )

    expect(res.volumeId).toBe("FC-HDC-01:vm-250-disk-3")
    expect(mockSSH.mock.calls[1][2]).toContain("vm-250-disk-3")
    // The bumped name is what cleanup must cover, never the one that was taken.
    expect(slot.volumeId).toBe("FC-HDC-01:vm-250-disk-3")
  })

  it("bumps on the RBD wording for a taken name as well", async () => {
    mockSSH
      .mockResolvedValueOnce(failed("rbd: create error: (17) File exists"))
      .mockResolvedValueOnce(created("rbd-pool:vm-250-disk-2"))
      .mockResolvedValueOnce(path("/dev/rbd0"))

    const res = await allocateBlockVolumeAndResolvePath(
      "conn-1", "10.0.0.1", "rbd-pool", 250, "vm-250-disk-1", 20971520,
    )

    expect(res.volumeId).toBe("rbd-pool:vm-250-disk-2")
  })

  it("bumps on the ZFS wording for a taken name as well", async () => {
    mockSSH
      .mockResolvedValueOnce(failed("cannot create 'tank/vm-250-disk-1': dataset already exists"))
      .mockResolvedValueOnce(created("zfs-pool:vm-250-disk-2"))
      .mockResolvedValueOnce(path("/dev/zvol/tank/vm-250-disk-2"))

    const res = await allocateBlockVolumeAndResolvePath(
      "conn-1", "10.0.0.1", "zfs-pool", 250, "vm-250-disk-1", 20971520,
    )

    expect(res.volumeId).toBe("zfs-pool:vm-250-disk-2")
  })

  it("stops bumping after a bounded number of attempts and reports the last message", async () => {
    mockSSH.mockResolvedValue(failed(LVM_COLLISION))

    await expect(
      allocateBlockVolumeAndResolvePath("conn-1", "10.0.0.1", "FC-HDC-01", 250, "vm-250-disk-2", 20971520),
    ).rejects.toThrow(/already exists/)

    // One initial attempt plus a bounded number of bumps, never an endless loop.
    expect(mockSSH.mock.calls.length).toBeLessThanOrEqual(4)
    expect(mockSSH.mock.calls.length).toBeGreaterThan(1)
  })

  it("does not bump on a failure that is not a name collision", async () => {
    mockSSH.mockResolvedValueOnce(failed("storage 'FC-HDC-01' does not exist"))

    await expect(
      allocateBlockVolumeAndResolvePath("conn-1", "10.0.0.1", "FC-HDC-01", 250, "vm-250-disk-1", 20971520),
    ).rejects.toThrow(/does not exist/)

    expect(mockSSH).toHaveBeenCalledTimes(1)
  })

  it("skips the pvesm path call when alloc already printed a device path (LVM on iSCSI multipath)", async () => {
    mockSSH.mockResolvedValueOnce({
      success: true,
      output: "successfully created '/dev/mpath-vg/vm-250-disk-1'",
    })

    const res = await allocateBlockVolumeAndResolvePath(
      "conn-1", "10.0.0.1", "mpath-storage", 250, "vm-250-disk-1", 20971520,
    )

    expect(res).toEqual({ volumeId: "mpath-storage:vm-250-disk-1", devicePath: "/dev/mpath-vg/vm-250-disk-1" })
    expect(mockSSH).toHaveBeenCalledTimes(1)
  })

  it("resolves the device path through pvesm path for plugins that print the volume ID", async () => {
    mockSSH
      .mockResolvedValueOnce(created("FC-HDC-01:vm-250-disk-1"))
      .mockResolvedValueOnce(path("/dev/FC-HDC-01/vm-250-disk-1"))

    const res = await allocateBlockVolumeAndResolvePath(
      "conn-1", "10.0.0.1", "FC-HDC-01", 250, "vm-250-disk-1", 20971520,
    )

    expect(mockSSH.mock.calls[1][2]).toContain("pvesm path 'FC-HDC-01:vm-250-disk-1'")
    expect(res.devicePath).toBe("/dev/FC-HDC-01/vm-250-disk-1")
  })

  it("surfaces the command output when the path resolution fails", async () => {
    mockSSH
      .mockResolvedValueOnce(created("FC-HDC-01:vm-250-disk-1"))
      .mockResolvedValueOnce(failed("no such volume 'FC-HDC-01:vm-250-disk-1'"))

    let message = ""
    try {
      await allocateBlockVolumeAndResolvePath("conn-1", "10.0.0.1", "FC-HDC-01", 250, "vm-250-disk-1", 20971520)
    } catch (e) {
      message = (e as Error).message
    }

    expect(message).toContain("no such volume")
    expect(message).not.toContain("Exit code 17")
  })
})

describe("nextFreeDiskName", () => {
  it("starts at disk 0 when the VM shell owns no disk yet", () => {
    expect(nextFreeDiskName({ name: "hdc-rsyslog02", cores: 2 }, [], 250)).toBe("vm-250-disk-0")
  })

  it("starts after the efidisk an OVMF shell already owns", () => {
    // `qm create` with bios=ovmf allocates vm-<vmid>-disk-0 for the EFI vars, and on
    // PVE 9 LVM with snapshot-as-volume-chain it carries a .qcow2 suffix.
    const conf = { efidisk0: "FC-HDC-01:vm-250-disk-0.qcow2,efitype=4m,size=528K" }

    expect(nextFreeDiskName(conf, [], 250)).toBe("vm-250-disk-1")
  })

  it("accounts for the volumes already allocated in this run", () => {
    const conf = { efidisk0: "FC-HDC-01:vm-250-disk-0.qcow2" }
    const allocated: AllocatedVolume[] = [{ volumeId: "FC-HDC-01:vm-250-disk-1", devicePath: "/dev/x" }]

    expect(nextFreeDiskName(conf, allocated, 250)).toBe("vm-250-disk-2")
  })

  it("takes the highest number, not the disk count, so a gap never causes a collision", () => {
    const conf = { scsi0: "FC-HDC-01:vm-250-disk-4", scsi1: "FC-HDC-01:vm-250-disk-2" }

    expect(nextFreeDiskName(conf, [], 250)).toBe("vm-250-disk-5")
  })

  it("ignores a reserved slot whose allocation has not started", () => {
    expect(nextFreeDiskName({}, [{ volumeId: "", devicePath: "" }], 250)).toBe("vm-250-disk-0")
  })
})

describe("allocateAndMapBlockVolume", () => {
  const args = {
    connectionId: "conn-1",
    nodeIp: "10.0.0.1",
    targetStorage: "FC-HDC-01",
    targetVmid: 250,
    volName: "vm-250-disk-1",
    sizeKB: 20971520,
  }

  it("returns the device path as-is for a plain block volume, with nothing to map", async () => {
    mockSSH
      .mockResolvedValueOnce(created("FC-HDC-01:vm-250-disk-1"))
      .mockResolvedValueOnce(path("/dev/FC-HDC-01/vm-250-disk-1"))

    const vol = await allocateAndMapBlockVolume(args)

    expect(vol).toMatchObject({
      volumeId: "FC-HDC-01:vm-250-disk-1",
      devicePath: "/dev/FC-HDC-01/vm-250-disk-1",
      rbdMapped: false,
    })
    expect(mockSSH).toHaveBeenCalledTimes(2)
  })

  it("maps a librbd volume to a kernel device (krbd 0)", async () => {
    mockSSH
      .mockResolvedValueOnce(created("rbd-pool:vm-250-disk-1"))
      .mockResolvedValueOnce(path("rbd:CephPool/vm-250-disk-1:conf=/etc/pve/ceph.conf"))
      .mockResolvedValueOnce(path("/dev/rbd0"))

    const vol = await allocateAndMapBlockVolume({ ...args, targetStorage: "rbd-pool" })

    expect(mockSSH.mock.calls[2][2]).toContain("rbd map 'CephPool/vm-250-disk-1'")
    expect(vol.devicePath).toBe("/dev/rbd0")
    expect(vol.rbdMapped).toBe(true)
  })

  it("maps a KRBD symlink and keeps the device path Proxmox reported (krbd 1)", async () => {
    const krbd = "/dev/rbd-pve/2a4f/CephPool/vm-250-disk-1"
    mockSSH
      .mockResolvedValueOnce(created("rbd-pool:vm-250-disk-1"))
      .mockResolvedValueOnce(path(krbd))
      .mockResolvedValueOnce({ success: true, output: "" })

    const vol = await allocateAndMapBlockVolume({ ...args, targetStorage: "rbd-pool" })

    expect(mockSSH.mock.calls[2][2]).toContain("rbd device map 'CephPool/vm-250-disk-1'")
    // The symlink only resolves after the map; the path itself does not change.
    expect(vol.devicePath).toBe(krbd)
    expect(vol.rbdMapped).toBe(true)
  })

  it("registers the volume in the caller's cleanup registry before allocating (#587)", async () => {
    const allocatedVolumes: AllocatedVolume[] = []
    mockSSH.mockResolvedValueOnce(failed("unable to create image"))

    await expect(allocateAndMapBlockVolume({ ...args, allocatedVolumes })).rejects.toThrow(/unable to create image/)

    expect(volumesToFree(allocatedVolumes)).toEqual([
      { volumeId: "FC-HDC-01:vm-250-disk-1", devicePath: "" },
    ])
  })

  it("keeps one registry slot per disk so the attach step stays aligned", async () => {
    const allocatedVolumes: AllocatedVolume[] = []
    mockSSH
      .mockResolvedValueOnce(created("FC-HDC-01:vm-250-disk-1"))
      .mockResolvedValueOnce(path("/dev/FC-HDC-01/vm-250-disk-1"))
      .mockResolvedValueOnce(created("FC-HDC-01:vm-250-disk-2"))
      .mockResolvedValueOnce(path("/dev/FC-HDC-01/vm-250-disk-2"))

    await allocateAndMapBlockVolume({ ...args, allocatedVolumes })
    await allocateAndMapBlockVolume({ ...args, volName: "vm-250-disk-2", allocatedVolumes })

    expect(allocatedVolumes.map(v => v.volumeId)).toEqual([
      "FC-HDC-01:vm-250-disk-1",
      "FC-HDC-01:vm-250-disk-2",
    ])
  })

  it("refuses a device path that is not absolute rather than writing to a bogus target", async () => {
    mockSSH
      .mockResolvedValueOnce(created("FC-HDC-01:vm-250-disk-1"))
      .mockResolvedValueOnce(path("FC-HDC-01:vm-250-disk-1"))

    await expect(allocateAndMapBlockVolume(args)).rejects.toThrow(/absolute path/)
  })

  it("reports the mapping and the allocation through the caller's logger", async () => {
    const logs: string[] = []
    mockSSH
      .mockResolvedValueOnce(created("FC-HDC-01:vm-250-disk-1"))
      .mockResolvedValueOnce(path("/dev/FC-HDC-01/vm-250-disk-1"))

    await allocateAndMapBlockVolume({ ...args, onLog: async (m) => { logs.push(m) } })

    expect(logs).toEqual(["Allocated volume FC-HDC-01:vm-250-disk-1 → /dev/FC-HDC-01/vm-250-disk-1"])
  })
})

describe("reserveVolumeSlot", () => {
  it("keeps allocatedVolumes[i] aligned with disk i so the attach step targets the right volume", () => {
    const allocatedVolumes: { volumeId: string; devicePath: string }[] = []

    const disk0 = reserveVolumeSlot(allocatedVolumes)
    disk0.volumeId = "FC-HDC-01:vm-250-disk-1"
    const disk1 = reserveVolumeSlot(allocatedVolumes)
    disk1.volumeId = "FC-HDC-01:vm-250-disk-2"

    expect(allocatedVolumes.map(v => v.volumeId)).toEqual([
      "FC-HDC-01:vm-250-disk-1",
      "FC-HDC-01:vm-250-disk-2",
    ])
  })
})

describe("volumesToFree", () => {
  it("frees a volume whose allocation reported a failure", () => {
    // The #587 case: pvesm created the volume, then returned an error, so the
    // slot carries a volume ID but never got a device path.
    const volumes = [{ volumeId: "FC-HDC-01:vm-250-disk-2", devicePath: "" }]

    expect(volumesToFree(volumes)).toEqual(volumes)
  })

  it("never frees a volume already attached to the VM", () => {
    const volumes = [{ volumeId: "FC-HDC-01:vm-250-disk-1", devicePath: "/dev/x", attached: true }]

    expect(volumesToFree(volumes)).toEqual([])
  })

  it("skips a reserved slot whose allocation never started", () => {
    const volumes = [{ volumeId: "", devicePath: "" }]

    expect(volumesToFree(volumes)).toEqual([])
  })

  it("never frees a volume that holds a completed copy of the source disk (#612)", () => {
    // Disks attach only at the very end of the cutover, so a fully copied target
    // is still unattached; freeing it would delete hours of finished transfer.
    const volumes = [{ volumeId: "FC-HDC-01:vm-250-disk-1", devicePath: "/dev/x", copied: true }]

    expect(volumesToFree(volumes)).toEqual([])
  })

  it("never frees a volume that is both copied and attached", () => {
    const volumes = [{ volumeId: "FC-HDC-01:vm-250-disk-1", devicePath: "/dev/x", copied: true, attached: true }]

    expect(volumesToFree(volumes)).toEqual([])
  })

  it("still frees a registered volume that is neither copied nor attached", () => {
    // A volume that failed mid first copy holds no usable image; it stays freeable.
    const volumes = [{ volumeId: "FC-HDC-01:vm-250-disk-1", devicePath: "/dev/x" }]

    expect(volumesToFree(volumes)).toEqual(volumes)
  })
})

describe("volumesToKeep", () => {
  it("reports a copied volume awaiting attach, so cleanup can log what it left behind", () => {
    const volumes = [{ volumeId: "FC-HDC-01:vm-250-disk-1", devicePath: "/dev/x", copied: true }]

    expect(volumesToKeep(volumes)).toEqual(volumes)
  })

  it("does not report an attached volume: it lives on with the VM, nothing was abandoned", () => {
    const volumes = [{ volumeId: "FC-HDC-01:vm-250-disk-1", devicePath: "/dev/x", copied: true, attached: true }]

    expect(volumesToKeep(volumes)).toEqual([])
  })

  it("does not report a volume with no completed copy: volumesToFree owns that one", () => {
    const volumes = [{ volumeId: "FC-HDC-01:vm-250-disk-1", devicePath: "/dev/x" }]

    expect(volumesToKeep(volumes)).toEqual([])
  })

  it("skips a reserved slot whose allocation never started", () => {
    const volumes = [{ volumeId: "", devicePath: "", copied: true }]

    expect(volumesToKeep(volumes)).toEqual([])
  })
})
