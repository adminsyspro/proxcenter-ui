import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { pveFetchMock } = vi.hoisted(() => ({ pveFetchMock: vi.fn() }))
vi.mock("@/lib/proxmox/client", () => ({ pveFetch: pveFetchMock }))

import {
  attachGuestDiskTotals,
  DISK_TOTAL_TTL_MS,
  diskTotalKey,
  invalidateGuestDiskTotal,
  onlineNodeSet,
  peekGuestDiskTotal,
  readGuestDiskBytes,
  resetGuestDiskTotals,
  type DiskTotalGuest,
} from "./guestDiskTotals"

const G = 1024 ** 3
const CONN = "conn-a"
const ONLINE = new Set(["pve1", "pve2"])

const configs: Record<string, Record<string, string>> = {
  "qemu/104": { scsi0: "zfs:vm-104-disk-0,size=20G", scsi1: "zfs:vm-104-disk-1,size=16G" },
  "qemu/9938": { boot: "order=net0", scsi0: "zfs:vm-9938-disk-0,size=1G", scsi1: "ceph:vm-9938-disk-0,size=2G" },
  "lxc/200": { rootfs: "local:200/vm-200-disk-0.raw,size=8G", mp0: "local:200/vm-200-disk-1.raw,mp=/data,size=2G" },
}

let clock = 1_000_000
const now = () => clock

function guests(): DiskTotalGuest[] {
  return [
    { vmid: 104, type: "qemu", node: "pve1", maxdisk: 20 * G },
    { vmid: "9938", type: "qemu", node: "pve1", maxdisk: 0 },
    { vmid: 200, type: "lxc", node: "pve2", maxdisk: 8 * G },
  ]
}

function fetchFrom(table = configs) {
  return vi.fn(async (_node: string, kind: string, vmid: string) => {
    const config = table[`${kind}/${vmid}`]
    if (!config) throw new Error("HTTP 500")

    return config
  })
}

beforeEach(() => {
  resetGuestDiskTotals()
  clock = 1_000_000
  pveFetchMock.mockReset()
})

afterEach(() => {
  resetGuestDiskTotals()
})

describe("attachGuestDiskTotals (#938)", () => {
  it("sets the sum of every disk, including a VM PVE reports with maxdisk 0", async () => {
    const list = guests()
    await attachGuestDiskTotals(null, CONN, list, { onlineNodes: ONLINE, fetchConfig: fetchFrom(), now })

    expect(list.map(g => g.diskTotal)).toEqual([36 * G, 3 * G, 10 * G])
    expect(list[0].maxdisk).toBe(20 * G)
  })

  it("reads each config through pveFetch by default", async () => {
    pveFetchMock.mockImplementation(async (_conn: unknown, path: string) => {
      const m = /^\/nodes\/([^/]+)\/(qemu|lxc)\/([^/]+)\/config$/.exec(path)

      return m ? configs[`${m[2]}/${m[3]}`] : null
    })
    const list = guests()
    await attachGuestDiskTotals({ id: "c" }, CONN, list, { onlineNodes: ONLINE })

    expect(pveFetchMock).toHaveBeenCalledWith({ id: "c" }, "/nodes/pve1/qemu/104/config")
    expect(pveFetchMock).toHaveBeenCalledWith({ id: "c" }, "/nodes/pve2/lxc/200/config")
    expect(list.map(g => g.diskTotal)).toEqual([36 * G, 3 * G, 10 * G])
  })

  it("serves the cache inside the TTL, with no config read", async () => {
    const fetchConfig = fetchFrom()
    await attachGuestDiskTotals(null, CONN, guests(), { onlineNodes: ONLINE, fetchConfig, now, random: () => 0 })
    expect(fetchConfig).toHaveBeenCalledTimes(3)

    clock += DISK_TOTAL_TTL_MS - 1
    const list = guests()
    await attachGuestDiskTotals(null, CONN, list, { onlineNodes: ONLINE, fetchConfig, now, random: () => 0 })

    expect(fetchConfig).toHaveBeenCalledTimes(3)
    expect(list[0].diskTotal).toBe(36 * G)
  })

  it("re-reads past the TTL, shortened by up to a fifth of it at random", async () => {
    const fetchConfig = fetchFrom()
    // random() = 1: the shortest life, 80% of the TTL.
    await attachGuestDiskTotals(null, CONN, guests(), { onlineNodes: ONLINE, fetchConfig, now, random: () => 1 })

    clock += DISK_TOTAL_TTL_MS * 0.8 - 1
    await attachGuestDiskTotals(null, CONN, guests(), { onlineNodes: ONLINE, fetchConfig, now })
    expect(fetchConfig).toHaveBeenCalledTimes(3)

    clock += 2
    const grown = { ...configs, "qemu/104": { ...configs["qemu/104"], scsi2: "zfs:vm-104-disk-2,size=4G" } }
    const refetch = fetchFrom(grown)
    const list = guests()
    await attachGuestDiskTotals(null, CONN, list, { onlineNodes: ONLINE, fetchConfig: refetch, now })

    expect(refetch).toHaveBeenCalledTimes(3)
    expect(list[0].diskTotal).toBe(40 * G)
  })

  it("re-reads a guest whose maxdisk moved (boot disk resized) before its TTL", async () => {
    await attachGuestDiskTotals(null, CONN, guests(), { onlineNodes: ONLINE, fetchConfig: fetchFrom(), now })

    const resized = { ...configs, "qemu/104": { ...configs["qemu/104"], scsi0: "zfs:vm-104-disk-0,size=30G" } }
    const refetch = fetchFrom(resized)
    const list = guests()
    list[0].maxdisk = 30 * G
    await attachGuestDiskTotals(null, CONN, list, { onlineNodes: ONLINE, fetchConfig: refetch, now })

    expect(refetch).toHaveBeenCalledTimes(1)
    expect(list[0].diskTotal).toBe(46 * G)
  })

  it("keeps the previous figure when the config read fails, and sets none without one", async () => {
    await attachGuestDiskTotals(null, CONN, guests(), { onlineNodes: ONLINE, fetchConfig: fetchFrom(), now })
    clock += DISK_TOTAL_TTL_MS + 1

    const failing = vi.fn(async () => { throw new Error("HTTP 595") })
    const list = [...guests(), { vmid: 300, type: "qemu", node: "pve1", maxdisk: 5 * G } as DiskTotalGuest]
    await attachGuestDiskTotals(null, CONN, list, { onlineNodes: ONLINE, fetchConfig: failing, now })

    expect(failing).toHaveBeenCalledTimes(4)
    expect(list.map(g => g.diskTotal)).toEqual([36 * G, 3 * G, 10 * G, undefined])
  })

  it("does not call a node that is offline, and still serves its expired figure", async () => {
    await attachGuestDiskTotals(null, CONN, guests(), { onlineNodes: ONLINE, fetchConfig: fetchFrom(), now })
    clock += DISK_TOTAL_TTL_MS + 1

    const fetchConfig = fetchFrom()
    const list = guests()
    await attachGuestDiskTotals(null, CONN, list, { onlineNodes: new Set(["pve2"]), fetchConfig, now })

    expect(fetchConfig).toHaveBeenCalledTimes(1)
    expect(fetchConfig).toHaveBeenCalledWith("pve2", "lxc", "200")
    expect(list.map(g => g.diskTotal)).toEqual([36 * G, 3 * G, 10 * G])
  })

  it("asks every node when node status is unknown", async () => {
    const fetchConfig = fetchFrom()
    await attachGuestDiskTotals(null, CONN, guests(), { onlineNodes: null, fetchConfig, now })

    expect(fetchConfig).toHaveBeenCalledTimes(3)
  })

  it("skips anything that is not a qemu or lxc guest", async () => {
    const fetchConfig = fetchFrom()
    const list: DiskTotalGuest[] = [{ vmid: 1, type: "storage", node: "pve1" }, { type: "qemu", node: "pve1" }, { vmid: 7, type: "qemu" }]
    await attachGuestDiskTotals(null, CONN, list, { onlineNodes: ONLINE, fetchConfig, now })

    expect(fetchConfig).not.toHaveBeenCalled()
    expect(list.map(g => g.diskTotal)).toEqual([undefined, undefined, undefined])
  })

  it("drops the figures of guests gone from the connection, and only of that connection", async () => {
    await attachGuestDiskTotals(null, CONN, guests(), { onlineNodes: ONLINE, fetchConfig: fetchFrom(), now })
    await attachGuestDiskTotals(null, "conn-b", guests(), { onlineNodes: ONLINE, fetchConfig: fetchFrom(), now })

    await attachGuestDiskTotals(null, CONN, guests().slice(0, 1), { onlineNodes: ONLINE, fetchConfig: fetchFrom(), now })

    expect(peekGuestDiskTotal(CONN, "qemu", 104)).toBe(36 * G)
    expect(peekGuestDiskTotal(CONN, "lxc", 200)).toBeUndefined()
    expect(peekGuestDiskTotal("conn-b", "lxc", 200)).toBe(10 * G)

    // An empty list (failed /cluster/resources) prunes nothing.
    await attachGuestDiskTotals(null, "conn-b", [], { onlineNodes: ONLINE, fetchConfig: fetchFrom(), now })
    expect(peekGuestDiskTotal("conn-b", "lxc", 200)).toBe(10 * G)
  })

  it("answers at once from the cache when not blocking, and fills it behind", async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>(resolve => { release = resolve })
    const fetchConfig = vi.fn(async (_n: string, kind: string, vmid: string) => {
      await gate

      return configs[`${kind}/${vmid}`]
    })

    const first = guests()
    await attachGuestDiskTotals(null, CONN, first, { onlineNodes: ONLINE, fetchConfig, now, blocking: false })
    expect(first.map(g => g.diskTotal)).toEqual([undefined, undefined, undefined])

    release()
    await vi.waitFor(() => expect(peekGuestDiskTotal(CONN, "qemu", 104)).toBe(36 * G))

    const second = guests()
    await attachGuestDiskTotals(null, CONN, second, { onlineNodes: ONLINE, fetchConfig, now, blocking: false })
    expect(second[0].diskTotal).toBe(36 * G)
    expect(fetchConfig).toHaveBeenCalledTimes(3)
  })

  it("shares one config read between two concurrent callers", async () => {
    const fetchConfig = fetchFrom()
    const a = guests()
    const b = guests()
    await Promise.all([
      attachGuestDiskTotals(null, CONN, a, { onlineNodes: ONLINE, fetchConfig, now }),
      attachGuestDiskTotals(null, CONN, b, { onlineNodes: ONLINE, fetchConfig, now }),
    ])

    expect(fetchConfig).toHaveBeenCalledTimes(3)
    expect(b.map(g => g.diskTotal)).toEqual([36 * G, 3 * G, 10 * G])
  })

  it("re-reads a guest after ProxCenter changed its disks", async () => {
    await attachGuestDiskTotals(null, CONN, guests(), { onlineNodes: ONLINE, fetchConfig: fetchFrom(), now })
    invalidateGuestDiskTotal(CONN, "qemu", "104")
    expect(peekGuestDiskTotal(CONN, "qemu", 104)).toBeUndefined()

    const fetchConfig = fetchFrom()
    await attachGuestDiskTotals(null, CONN, guests(), { onlineNodes: ONLINE, fetchConfig, now })
    expect(fetchConfig).toHaveBeenCalledTimes(1)
    expect(fetchConfig).toHaveBeenCalledWith("pve1", "qemu", "104")
  })
})

describe("helpers", () => {
  it("keys a guest by connection and type/vmid, whatever the vmid type", () => {
    expect(diskTotalKey("c", "qemu", 104)).toBe(diskTotalKey("c", "qemu", "104"))
    expect(diskTotalKey("c", "qemu", 104)).not.toBe(diskTotalKey("c", "lxc", 104))
  })

  it("lists the online nodes of a /nodes answer, null when it failed", () => {
    expect(onlineNodeSet([
      { node: "pve1", status: "online" },
      { node: "pve2", status: "offline" },
      { status: "online" },
    ])).toEqual(new Set(["pve1"]))
    expect(onlineNodeSet(null)).toBeNull()
  })
})

describe("readGuestDiskBytes (#938, vDC quotas)", () => {
  it("reads every config now, even a fresh cached one, and refreshes the cache", async () => {
    await attachGuestDiskTotals(null, CONN, guests(), { onlineNodes: ONLINE, fetchConfig: fetchFrom(), now })
    const grown = { ...configs, "qemu/104": { ...configs["qemu/104"], scsi2: "zfs:vm-104-disk-2,size=4G" } }
    const fetchConfig = fetchFrom(grown)

    const bytes = await readGuestDiskBytes(null, CONN, guests(), { fetchConfig, now })

    expect(fetchConfig).toHaveBeenCalledTimes(3)
    expect(bytes).toEqual([40 * G, 3 * G, 10 * G])
    expect(peekGuestDiskTotal(CONN, "qemu", 104)).toBe(40 * G)
  })

  it("counts maxdisk, never 0, and warns for a config it cannot read or a guest it cannot place", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const list: DiskTotalGuest[] = [
      { vmid: 104, type: "qemu", node: "pve1", maxdisk: 20 * G },
      { vmid: 5, type: "qemu", maxdisk: 7 * G },
      { vmid: 6, type: "storage", node: "pve1", maxdisk: 9 * G },
    ]
    const bytes = await readGuestDiskBytes(null, CONN, list, { fetchConfig: vi.fn(async () => { throw new Error("HTTP 595") }) })

    expect(bytes).toEqual([20 * G, 7 * G, 9 * G])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("HTTP 595"))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("no node"))
    warn.mockRestore()
  })

  it("adds the size of every detached volume, so detaching a disk never frees quota", async () => {
    const list: DiskTotalGuest[] = [{ vmid: 300, type: "qemu", node: "pve1", maxdisk: 10 * G }]
    const fetchConfig = vi.fn(async () => ({
      scsi0: "local-lvm:vm-300-disk-0,size=10G",
      unused0: "local-lvm:vm-300-disk-1",
      unused1: "ceph:vm-300-disk-2",
    }))
    const fetchVolumeSize = vi.fn(async (_node: string, volid: string) => (volid.startsWith("ceph:") ? 30 * G : 50 * G))

    const bytes = await readGuestDiskBytes(null, CONN, list, { fetchConfig, fetchVolumeSize })

    expect(fetchVolumeSize).toHaveBeenCalledWith("pve1", "local-lvm:vm-300-disk-1")
    expect(fetchVolumeSize).toHaveBeenCalledWith("pve1", "ceph:vm-300-disk-2")
    expect(bytes).toEqual([90 * G])
    // The inventory figure stays the attached disks: detached ones are a quota matter.
    expect(peekGuestDiskTotal(CONN, "qemu", 300)).toBe(10 * G)
  })

  it("keeps the attached total and warns when a detached volume cannot be sized", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const list: DiskTotalGuest[] = [{ vmid: 301, type: "qemu", node: "pve1", maxdisk: 10 * G }]
    const fetchConfig = vi.fn(async () => ({ scsi0: "local-lvm:vm-301-disk-0,size=10G", unused0: "local-lvm:vm-301-disk-1" }))
    const fetchVolumeSize = vi.fn(async () => { throw new Error("HTTP 500") })

    const bytes = await readGuestDiskBytes(null, CONN, list, { fetchConfig, fetchVolumeSize })

    expect(bytes).toEqual([10 * G])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("local-lvm:vm-301-disk-1"))
    warn.mockRestore()
  })

  it("asks the storage content API for a detached volume by default", async () => {
    pveFetchMock.mockImplementation(async (_conn: unknown, path: string) =>
      path.endsWith("/config") ? { scsi0: "local-lvm:vm-302-disk-0,size=10G", unused0: "local-lvm:vm-302-disk-1" } : { size: 5 * G })
    const bytes = await readGuestDiskBytes({ id: "c" }, CONN, [{ vmid: 302, type: "qemu", node: "pve1", maxdisk: 10 * G }])

    expect(pveFetchMock).toHaveBeenCalledWith({ id: "c" }, "/nodes/pve1/storage/local-lvm/content/local-lvm%3Avm-302-disk-1")
    expect(bytes).toEqual([15 * G])
  })

  it("goes through pveFetch by default", async () => {
    pveFetchMock.mockResolvedValue(configs["qemu/104"])
    const bytes = await readGuestDiskBytes({ id: "c" }, CONN, guests().slice(0, 1))

    expect(pveFetchMock).toHaveBeenCalledWith({ id: "c" }, "/nodes/pve1/qemu/104/config")
    expect(bytes).toEqual([36 * G])
  })
})
