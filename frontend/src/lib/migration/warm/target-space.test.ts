import { describe, it, expect, vi, beforeEach } from "vitest"
import { getConnectionById } from "@/lib/connections/getConnection"
import { pveFetch } from "@/lib/proxmox/client"
import { evaluateTargetSpace, checkTargetStorageSpace, assertTargetStorageSpace, gib } from "./target-space"

vi.mock("@/lib/connections/getConnection", () => ({ getConnectionById: vi.fn() }))
vi.mock("@/lib/proxmox/client", () => ({ pveFetch: vi.fn() }))

const GiB = 1024 ** 3
const mockConnection = vi.mocked(getConnectionById)
const mockFetch = vi.mocked(pveFetch)

describe("evaluateTargetSpace", () => {
  it.each([22, 23])("accepts %i GiB for 20 GiB of disks, including the 10% margin", (availableGiB) => {
    expect(evaluateTargetSpace("ZFS-Pool", { avail: availableGiB * GiB, type: "zfspool" }, 20 * GiB)).toEqual({
      storage: "ZFS-Pool",
      type: "zfspool",
      availableBytes: availableGiB * GiB,
      requiredBytes: 20 * GiB,
      sufficient: true,
    })
  })

  it.each([0, 21])("rejects %i GiB when 20 GiB plus the margin is required", (availableGiB) => {
    expect(evaluateTargetSpace("ZFS-Pool", { avail: availableGiB * GiB }, 20 * GiB)).toMatchObject({
      availableBytes: availableGiB * GiB,
      sufficient: false,
    })
  })

  it.each([
    { label: "missing avail", status: {} },
    { label: "non-numeric avail", status: { avail: "abc" } },
    { label: "negative avail", status: { avail: -1 } },
    { label: "null status", status: null },
    { label: "undefined status", status: undefined },
  ])("treats $label as zero available bytes", ({ status }) => {
    expect(evaluateTargetSpace("ZFS-Pool", status, 20 * GiB)).toMatchObject({
      availableBytes: 0,
      sufficient: false,
    })
  })

  it.each([undefined, null, 123, false, {}])("does not copy a non-string storage type (%j)", (type) => {
    expect(evaluateTargetSpace("ZFS-Pool", { avail: 22 * GiB, type }, 20 * GiB).type).toBeUndefined()
  })

  it("accepts zero required bytes even when no space is available", () => {
    expect(evaluateTargetSpace("empty-pool", { avail: 0 }, 0)).toEqual({
      storage: "empty-pool",
      type: undefined,
      availableBytes: 0,
      requiredBytes: 0,
      sufficient: true,
    })
  })
})

describe("checkTargetStorageSpace", () => {
  const connection = {
    id: "target-conn",
    name: "Target",
    baseUrl: "https://pve.local:8006",
    apiToken: "test-token",
    insecureDev: false,
    behindProxy: false,
  }

  beforeEach(() => {
    vi.resetAllMocks()
    mockConnection.mockResolvedValue(connection)
  })

  it.each([
    { node: "pve1", storage: "ZFS-Pool", path: "/nodes/pve1/storage/ZFS-Pool/status", availableGiB: 22, sufficient: true },
    { node: "pve1", storage: "ZFS Pool+backup", path: "/nodes/pve1/storage/ZFS%20Pool%2Bbackup/status", availableGiB: 21, sufficient: false },
    { node: "pve 1", storage: "ZFS-Pool", path: "/nodes/pve%201/storage/ZFS-Pool/status", availableGiB: 22, sufficient: true },
  ])("fetches $path and returns the evaluated verdict", async ({ node, storage, path, availableGiB, sufficient }) => {
    mockFetch.mockResolvedValue({ avail: availableGiB * GiB, type: "zfspool" })

    const result = await checkTargetStorageSpace("target-conn", node, storage, 20 * GiB)

    expect(mockConnection).toHaveBeenCalledExactlyOnceWith("target-conn")
    expect(mockFetch).toHaveBeenCalledExactlyOnceWith(connection, path)
    expect(mockFetch.mock.calls[0][0]).toBe(connection)
    expect(result).toEqual({ storage, type: "zfspool", availableBytes: availableGiB * GiB, requiredBytes: 20 * GiB, sufficient })
  })

  it("returns an insufficient verdict without throwing when PVE rejects", async () => {
    mockFetch.mockRejectedValue(new Error("PVE 400 ...No such storage"))

    await expect(checkTargetStorageSpace("target-conn", "pve1", "ZFS-Pool", 20 * GiB)).resolves.toEqual({
      storage: "ZFS-Pool",
      availableBytes: 0,
      requiredBytes: 20 * GiB,
      sufficient: false,
      error: "PVE 400 ...No such storage",
    })
  })

  it("returns an insufficient verdict without throwing when connection lookup rejects", async () => {
    mockConnection.mockRejectedValue(new Error("Connection not found"))

    await expect(checkTargetStorageSpace("target-conn", "pve1", "ZFS-Pool", 20 * GiB)).resolves.toEqual({
      storage: "ZFS-Pool",
      availableBytes: 0,
      requiredBytes: 20 * GiB,
      sufficient: false,
      error: "Connection not found",
    })
    expect(mockFetch).not.toHaveBeenCalled()
  })
})

describe("gib", () => {
  it.each([
    { bytes: 13079048192, expected: "12.2" },
    { bytes: 0, expected: "0.0" },
  ])("formats $bytes bytes as $expected GiB", ({ bytes, expected }) => {
    expect(gib(bytes)).toBe(expected)
  })
})

describe("assertTargetStorageSpace (planning-time guard)", () => {
  beforeEach(() => {
    mockConnection.mockReset()
    mockFetch.mockReset()
    mockConnection.mockResolvedValue({ baseUrl: "https://pve.local:8006", apiToken: "t" } as never)
  })

  it("returns the verdict when the storage can hold the disks plus the margin", async () => {
    mockFetch.mockResolvedValue({ avail: 44.7 * GiB, type: "zfspool" })
    await expect(assertTargetStorageSpace("tgt", "pve1", "ZFS-Pool", 16 * GiB)).resolves.toMatchObject({
      storage: "ZFS-Pool",
      type: "zfspool",
      requiredBytes: 16 * GiB,
      sufficient: true,
    })
  })

  it("throws the operator-facing message with both figures when the storage is too small", async () => {
    mockFetch.mockResolvedValue({ avail: 12.2 * GiB, type: "zfspool" })
    await expect(assertTargetStorageSpace("tgt", "pve1", "ZFS-Pool", 16 * GiB)).rejects.toThrow(
      'Insufficient disk space on "ZFS-Pool": 12.2 GB free, need 16.0 GB plus a 10% margin',
    )
  })

  it("throws a read error, not a space verdict, when the node cannot report the storage", async () => {
    mockFetch.mockRejectedValue(new Error("PVE 400 /nodes/pve1/storage/nope/status: No such storage."))
    await expect(assertTargetStorageSpace("tgt", "pve1", "nope", 16 * GiB)).rejects.toThrow(
      /^Cannot read free space on "nope" \(node pve1\): PVE 400 .*No such storage\.$/,
    )
  })
})
