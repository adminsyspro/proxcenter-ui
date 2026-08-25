import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/ssh/exec", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/ssh/exec")>()
  return { ...actual, executeSSH: vi.fn() }
})
vi.mock("@/lib/proxmox/client", () => ({ pveFetch: vi.fn() }))
vi.mock("./pve-vm-config", () => ({ pveSetVmConfig: vi.fn() }))
import { executeSSH } from "@/lib/ssh/exec"
import { pveFetch } from "@/lib/proxmox/client"
import { pveSetVmConfig } from "./pve-vm-config"
import { adoptFileVolume, importOrAdoptFileVolume, adoptImportAndAttachFileVolume } from "./adopt-file-volume"

const mockSSH = executeSSH as unknown as ReturnType<typeof vi.fn>
const mockFetch = pveFetch as unknown as ReturnType<typeof vi.fn>
const mockSetConfig = pveSetVmConfig as unknown as ReturnType<typeof vi.fn>

const moved = { success: true, output: "ADOPT_OK" }
/** What the guarded command yields when a `[ ... ]` test fails: no ADOPT_OK, and
 *  the non-zero exit of `test` surfaces as an SSH failure. */
const refused = { success: false, output: "", error: "Exit code 1" }

const args = {
  connectionId: "conn-1",
  nodeIp: "10.0.0.1",
  sourcePath: "/mnt/pve/nfs-01/images/250/proxcenter-mig-job7-disk0.qcow2",
  targetStorage: "nfs-01",
  imagesDir: "/mnt/pve/nfs-01/images/250",
  targetVmid: 250,
  format: "qcow2" as const,
}

beforeEach(() => {
  mockSSH.mockReset()
  mockFetch.mockReset()
  mockSetConfig.mockReset()
})

describe("adoptFileVolume", () => {
  it("renames the converted image to the canonical volume name and returns its volid", async () => {
    mockSSH.mockResolvedValueOnce(moved)

    const result = await adoptFileVolume({ ...args, vmConf: {} })

    expect(result).toEqual({
      volumeId: "nfs-01:250/vm-250-disk-0.qcow2",
      volumePath: "/mnt/pve/nfs-01/images/250/vm-250-disk-0.qcow2",
      volumeName: "vm-250-disk-0",
    })
    const cmd = mockSSH.mock.calls[0][2] as string
    expect(cmd).toContain("mv -n '/mnt/pve/nfs-01/images/250/proxcenter-mig-job7-disk0.qcow2'")
    expect(cmd).toContain("'/mnt/pve/nfs-01/images/250/vm-250-disk-0.qcow2'")
    // A rename is the whole point: no qemu-img, no qm disk import, no dd.
    expect(cmd).not.toMatch(/qemu-img|qm disk import|\bdd\b|cp /)
  })

  it("skips the disk number an OVMF shell already owns for its EFI vars", async () => {
    mockSSH.mockResolvedValueOnce(moved)

    const result = await adoptFileVolume({
      ...args,
      vmConf: { efidisk0: "nfs-01:250/vm-250-disk-0.qcow2,efitype=4m,size=528K" },
    })

    expect(result?.volumeId).toBe("nfs-01:250/vm-250-disk-1.qcow2")
  })

  it("skips the names already claimed by earlier disks of the same run", async () => {
    mockSSH.mockResolvedValueOnce(moved)

    const result = await adoptFileVolume({
      ...args,
      vmConf: {},
      taken: [{ volumeId: "nfs-01:250/vm-250-disk-0.qcow2", devicePath: "" }],
    })

    expect(result?.volumeId).toBe("nfs-01:250/vm-250-disk-1.qcow2")
  })

  it("refuses to move across filesystems: the check is in the command, not in a comment", async () => {
    mockSSH.mockResolvedValueOnce(moved)

    await adoptFileVolume({ ...args, vmConf: {} })

    const cmd = mockSSH.mock.calls[0][2] as string
    // `mv` across devices copies the whole disk silently, which is the very cost
    // this module exists to remove.
    expect(cmd).toContain('stat -c %d')
    // And it must never clobber a volume PVE or an operator already owns.
    expect(cmd).toContain('[ ! -e ')
    expect(cmd).toContain('mv -n ')
  })

  it("refuses to rename a raw image into a qcow2 volume: the extension would lie about the header", async () => {
    const logs: string[] = []

    const result = await adoptFileVolume({
      ...args,
      vmConf: {},
      format: "qcow2",
      sourceFormat: "raw",
      onLog: (m) => { logs.push(m) },
    })

    expect(result).toBeNull()
    // Not even a round trip: nothing on the node can make this safe.
    expect(mockSSH).not.toHaveBeenCalled()
    expect(logs.join(" ")).toContain("a rename cannot convert")
  })

  it("returns null instead of throwing when the move is refused, so the caller can import", async () => {
    mockSSH.mockResolvedValueOnce(refused)
    const logs: string[] = []

    const result = await adoptFileVolume({ ...args, vmConf: {}, onLog: (m) => { logs.push(m) } })

    expect(result).toBeNull()
    expect(logs.join(" ")).toContain("falling back to qm disk import")
  })

  it("treats a command that reports success without ADOPT_OK as a refusal", async () => {
    mockSSH.mockResolvedValueOnce({ success: true, output: "" })

    expect(await adoptFileVolume({ ...args, vmConf: {} })).toBeNull()
  })

  it("gives the move more than the 30 s executeSSH default", async () => {
    mockSSH.mockResolvedValueOnce(moved)

    await adoptFileVolume({ ...args, vmConf: {} })

    expect(mockSSH.mock.calls[0][3]).toBeGreaterThan(30_000)
  })
})

describe("importOrAdoptFileVolume", () => {
  it("adopts by rename when it can, and never runs qm disk import in that case", async () => {
    mockSSH.mockResolvedValueOnce(moved)

    const result = await importOrAdoptFileVolume({ ...args, vmConf: {} })

    expect(result).toEqual({ volumeId: "nfs-01:250/vm-250-disk-0.qcow2", adopted: true })
    expect(mockSSH).toHaveBeenCalledTimes(1)
    expect(mockSSH.mock.calls.map(c => c[2]).join(" ")).not.toContain("qm disk import")
  })

  it("imports when the rename is refused, and reports the volid PVE created", async () => {
    mockSSH
      .mockResolvedValueOnce(refused)
      .mockResolvedValueOnce({ success: true, output: "Successfully imported disk as 'unused0:nfs-01:250/vm-250-disk-3.qcow2'" })
      .mockResolvedValueOnce({ success: true, output: "" })

    const result = await importOrAdoptFileVolume({ ...args, vmConf: {} })

    expect(result).toEqual({ volumeId: "nfs-01:250/vm-250-disk-3.qcow2", adopted: false })
    expect(mockSSH.mock.calls[1][2]).toContain("qm disk import 250")
    // The 30 s default would cut the channel in the middle of a multi-GB import.
    expect(mockSSH.mock.calls[1][3]).toBeGreaterThanOrEqual(3600_000)
  })

  it("converts through qm disk import when virt-v2v wrote raw and the volume must be qcow2", async () => {
    mockSSH
      .mockResolvedValueOnce({ success: true, output: "Successfully imported disk as 'nfs-01:250/vm-250-disk-0.qcow2'" })
      .mockResolvedValueOnce({ success: true, output: "" })

    const result = await importOrAdoptFileVolume({ ...args, vmConf: {}, format: "qcow2", sourceFormat: "raw" })

    expect(result.adopted).toBe(false)
    // First call is the import itself: no rename was even attempted.
    expect(mockSSH.mock.calls[0][2]).toContain("qm disk import 250")
    expect(mockSSH.mock.calls[0][2]).toContain("--format qcow2")
  })

  it("also reads the older wording of the import output", async () => {
    mockSSH
      .mockResolvedValueOnce(refused)
      .mockResolvedValueOnce({ success: true, output: "unused0: successfully imported disk 'nfs-01:250/vm-250-disk-1.qcow2'" })
      .mockResolvedValueOnce({ success: true, output: "" })

    const result = await importOrAdoptFileVolume({ ...args, vmConf: {} })

    expect(result.volumeId).toBe("nfs-01:250/vm-250-disk-1.qcow2")
  })

  it("deletes the staging copy the import left behind, but never the file it moved", async () => {
    mockSSH
      .mockResolvedValueOnce(refused)
      .mockResolvedValueOnce({ success: true, output: "Successfully imported disk as 'nfs-01:250/vm-250-disk-0.qcow2'" })
      .mockResolvedValueOnce({ success: true, output: "" })

    await importOrAdoptFileVolume({ ...args, vmConf: {} })
    expect(mockSSH.mock.calls[2][2]).toContain(`rm -f '${args.sourcePath}'`)

    mockSSH.mockReset()
    mockSSH.mockResolvedValueOnce(moved)
    await importOrAdoptFileVolume({ ...args, vmConf: {} })
    expect(mockSSH.mock.calls.map(c => c[2]).join(" ")).not.toContain("rm -f")
  })

  it("asks the caller to read the VM config when the import output cannot be parsed", async () => {
    mockSSH
      .mockResolvedValueOnce(refused)
      .mockResolvedValueOnce({ success: true, output: "transferred 12.0 GiB of 12.0 GiB (100.00%)" })
      .mockResolvedValueOnce({ success: true, output: "" })

    const result = await importOrAdoptFileVolume({
      ...args,
      vmConf: {},
      resolveUnusedVolume: async () => "nfs-01:250/vm-250-disk-9.qcow2",
    })

    expect(result).toEqual({ volumeId: "nfs-01:250/vm-250-disk-9.qcow2", adopted: false })
  })

  it("still returns the expected volume name when nothing else resolves it", async () => {
    mockSSH
      .mockResolvedValueOnce(refused)
      .mockResolvedValueOnce({ success: true, output: "no wording we know" })
      .mockResolvedValueOnce({ success: true, output: "" })

    const result = await importOrAdoptFileVolume({
      ...args,
      vmConf: { efidisk0: "nfs-01:250/vm-250-disk-0.qcow2,efitype=4m" },
    })

    expect(result).toEqual({ volumeId: "nfs-01:250/vm-250-disk-1.qcow2", adopted: false })
  })

  it("fails the migration when the import itself fails", async () => {
    mockSSH
      .mockResolvedValueOnce(refused)
      .mockResolvedValueOnce({ success: false, output: "storage 'nfs-01' does not support vm images", error: "Exit code 255" })

    await expect(importOrAdoptFileVolume({ ...args, vmConf: {} })).rejects.toThrow(/does not support vm images/)
  })
})

describe("adoptImportAndAttachFileVolume", () => {
  const attachArgs = {
    ...args,
    pveConn: { baseUrl: "https://pve:8006", apiToken: "t" } as any,
    targetNode: "pve1",
    slot: "scsi0",
    driveOpts: ",discard=on",
    diskLabel: "Disk 1",
  }

  it("adopts by rename, attaches to the slot with the drive options, and reports it adopted", async () => {
    mockFetch.mockResolvedValueOnce({}) // read the VM config for the taken indexes
    mockSSH.mockResolvedValueOnce(moved) // the rename
    mockSetConfig.mockResolvedValueOnce(undefined)
    const logs: string[] = []

    const result = await adoptImportAndAttachFileVolume({ ...attachArgs, onLog: (m) => { logs.push(m) } })

    expect(result).toEqual({ volumeId: "nfs-01:250/vm-250-disk-0.qcow2", adopted: true })
    expect(mockSetConfig.mock.calls[0][1]).toBe("pve1")
    expect(mockSetConfig.mock.calls[0][2]).toBe(250)
    const body = mockSetConfig.mock.calls[0][3] as URLSearchParams
    expect(body.get("scsi0")).toBe("nfs-01:250/vm-250-disk-0.qcow2,discard=on")
    expect(logs.join(" ")).toContain("adopted in place, no copy")
  })

  it("imports when the rename is refused and reports it imported", async () => {
    mockFetch.mockResolvedValueOnce({})
    mockSSH
      .mockResolvedValueOnce(refused)
      .mockResolvedValueOnce({ success: true, output: "Successfully imported disk as 'nfs-01:250/vm-250-disk-0.qcow2'" })
      .mockResolvedValueOnce({ success: true, output: "" })
    mockSetConfig.mockResolvedValueOnce(undefined)
    const logs: string[] = []

    const result = await adoptImportAndAttachFileVolume({ ...attachArgs, onLog: (m) => { logs.push(m) } })

    expect(result.adopted).toBe(false)
    expect(logs.join(" ")).toContain("imported and attached as scsi0")
  })

  it("never throws when the attach fails: it warns and still returns the volume", async () => {
    mockFetch.mockResolvedValueOnce({})
    mockSSH.mockResolvedValueOnce(moved)
    mockSetConfig.mockRejectedValueOnce(new Error("VM is locked"))
    const logs: string[] = []

    const result = await adoptImportAndAttachFileVolume({ ...attachArgs, onLog: (m) => { logs.push(m) } })

    expect(result.adopted).toBe(true)
    expect(logs.join(" ")).toContain("Could not auto-attach scsi0")
  })

  it("leaves the volid bare when driveOpts is empty, for a block-storage attach", async () => {
    mockFetch.mockResolvedValueOnce({})
    mockSSH.mockResolvedValueOnce(moved)
    mockSetConfig.mockResolvedValueOnce(undefined)

    await adoptImportAndAttachFileVolume({ ...attachArgs, driveOpts: "", onLog: () => {} })

    const body = mockSetConfig.mock.calls[0][3] as URLSearchParams
    expect(body.get("scsi0")).toBe("nfs-01:250/vm-250-disk-0.qcow2")
  })
})
