import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/proxmox/client", () => ({ pveFetch: vi.fn() }))
vi.mock("@/lib/connections/getConnection", () => ({ getConnectionById: vi.fn(async () => ({ id: "pve" })) }))
vi.mock("@/lib/migration/batch-disk-sizes", () => ({ readBatchDiskSizes: vi.fn() }))

import { batchSpaceMessage, bytesPerNode, checkBatchSpaceForRequest, checkBatchTargetSpace, evaluateBatchSpace, requestDiskBytes } from "./batch-space"
import { pveFetch } from "@/lib/proxmox/client"
import { readBatchDiskSizes } from "@/lib/migration/batch-disk-sizes"

const GB = 1024 ** 3
const exact = (targetNode: string, gb: number) => ({ targetNode, diskBytes: gb * GB, estimatedBytes: (gb + 1) * GB })
const vms = [exact("pve1", 3), exact("pve2", 3), exact("pve1", 3)]

describe("batch target space (roadmap#53)", () => {
  it("adds up what each node receives, exact and exact-or-estimated", () => {
    expect([...bytesPerNode([...vms, { targetNode: "pve3", diskBytes: null, estimatedBytes: 2 * GB }, { targetNode: "pve3", diskBytes: -1 }])]).toEqual([
      ["pve1", { exact: 6 * GB, estimate: 6 * GB, hasEstimate: false }],
      ["pve2", { exact: 3 * GB, estimate: 3 * GB, hasEstimate: false }],
      ["pve3", { exact: 0, estimate: 2 * GB, hasEstimate: true }],
    ])
  })

  it("blocks a local storage node by node on the disks' exact capacity", async () => {
    const read = vi.fn(async (node: string) => ({ type: "zfspool", shared: 0, avail: node === "pve1" ? 6.5 * GB : 10 * GB }))
    const r = await evaluateBatchSpace("ZFS-Pool", vms, read)
    expect(r.ok).toBe(false)
    expect(r.problems).toEqual([expect.objectContaining({ node: "pve1", requiredBytes: 6 * GB })])
    expect(r.problems[0].message).toBe("Not enough space on ZFS-Pool (pve1): 6.5 GB free, this batch needs 6.0 GB plus a 10% margin")
    expect(r.warnings).toEqual([])
    expect(read).toHaveBeenCalledTimes(2)
  })

  it("lets through a batch that fits on exact sizes even if the list's estimates would not", async () => {
    // 10 GB free: 9.0 + 10% fits; the estimates (12.0) would not, but they are not used for exact VMs.
    const r = await evaluateBatchSpace("ZFS-Pool", vms.map(v => ({ ...v, targetNode: "pve1" })), async () => ({ shared: 0, avail: 10 * GB }))
    expect(r).toEqual({ ok: true, problems: [], warnings: [] })
  })

  it("checks a shared storage once against the whole batch", async () => {
    const read = vi.fn(async () => ({ type: "rbd", shared: 1, avail: 9.5 * GB }))
    const r = await evaluateBatchSpace("CephStoragePool", vms, read)
    expect(read).toHaveBeenCalledTimes(1)
    expect(r.problems).toEqual([expect.objectContaining({ node: null, requiredBytes: 9 * GB })])
    expect(r.problems[0].message).toBe("Not enough space on CephStoragePool: 9.5 GB free, this batch needs 9.0 GB plus a 10% margin")
    expect((await evaluateBatchSpace("CephStoragePool", vms, async () => ({ shared: 1, avail: 20 * GB }))).ok).toBe(true)
  })

  it("only warns when the shortfall rests on estimated sizes", async () => {
    const mixed = [exact("pve1", 3), { targetNode: "pve1", diskBytes: null, estimatedBytes: 5 * GB }]
    const r = await evaluateBatchSpace("ZFS-Pool", mixed, async () => ({ shared: 0, avail: 6 * GB }))
    expect(r.ok).toBe(true)
    expect(r.problems).toEqual([])
    expect(r.warnings).toEqual([expect.objectContaining({ node: "pve1", requiredBytes: 8 * GB, estimated: true })])
    expect(r.warnings[0].message).toBe("Maybe not enough space on ZFS-Pool (pve1): 6.0 GB free, this batch needs about 8.0 GB plus a 10% margin (estimated from the source's used space)")
  })

  it("blocks a node that cannot report the storage, and says why", async () => {
    const r = await evaluateBatchSpace("ZFS-Pool", vms, async node => { if (node === "pve2") throw new Error("storage 'ZFS-Pool' does not exist"); return { shared: 0, avail: 100 * GB } })
    expect(r.ok).toBe(false)
    expect(r.problems[0].message).toBe("Cannot read free space on ZFS-Pool (pve2): storage 'ZFS-Pool' does not exist")
  })

  it("does not read a storage when no size is known at all", async () => {
    const read = vi.fn()
    expect(await evaluateBatchSpace("ZFS-Pool", [{ targetNode: "pve1", diskBytes: null }], read)).toEqual({ ok: true, problems: [], warnings: [] })
    expect(read).not.toHaveBeenCalled()
  })

  it("reads the live status of each node of the target cluster", async () => {
    vi.mocked(pveFetch).mockResolvedValue({ shared: 0, avail: 100 * GB })
    expect((await checkBatchTargetSpace("pve", "local-zfs", vms)).ok).toBe(true)
    expect(vi.mocked(pveFetch).mock.calls.map(c => c[1])).toEqual(["/nodes/pve1/storage/local-zfs/status", "/nodes/pve2/storage/local-zfs/status"])
  })

  it("uses the exact sizes read from the source and the request's estimate for the others", async () => {
    vi.mocked(readBatchDiskSizes).mockResolvedValueOnce(new Map([["vm-1", 3 * GB], ["vm-2", null]]))
    vi.mocked(pveFetch).mockReset().mockResolvedValue({ shared: 0, avail: 5 * GB })
    const r = await checkBatchSpaceForRequest({
      tenantId: "default", sourceConnectionId: "vc", targetConnectionId: "pve", storage: "ZFS-Pool",
      vms: [{ sourceVmId: "vm-1", targetNode: "pve1", estimatedBytes: 4 * GB }, { sourceVmId: "vm-2", targetNode: "pve1", estimatedBytes: 4 * GB }],
    })
    expect(readBatchDiskSizes).toHaveBeenCalledWith("default", "vc", ["vm-1", "vm-2"])
    expect(r.ok).toBe(true)
    expect(r.warnings[0]).toMatchObject({ requiredBytes: 7 * GB, estimated: true })
  })

  it("parses the per-VM bytes of a request", () => {
    expect([3 * GB, "42", -1, "x", null, undefined, 2 ** 60].map(requestDiskBytes)).toEqual([3 * GB, 42, 0, 0, 0, 0, 0])
    expect(batchSpaceMessage({ storage: "s", node: null, availableBytes: 0, requiredBytes: 0, error: "boom" })).toBe("Cannot read free space on s: boom")
  })
})
