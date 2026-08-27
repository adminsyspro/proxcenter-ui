import { beforeEach, describe, expect, it, vi } from "vitest"

const { executeMock } = vi.hoisted(() => ({ executeMock: vi.fn() }))

vi.mock("./winrm", () => ({
  WinRMClient: class { execute = executeMock },
}))

import { HyperVClient } from "./client"

const conn = { host: "hv.example", username: "Administrator", password: "pw" }
const validVmId = "11111111-2222-3333-4444-555555555555"
const nestedDisk = "D:\\HYPERV\\2025-test\\2025-test\\Virtual Hard Disks\\2025-test.vhdx"

describe("HyperVClient", () => {
  beforeEach(() => executeMock.mockReset())

  it("lists VMs and disk files in one command without using Get-VHD", async () => {
    executeMock.mockResolvedValue('{"SharePath":null,"VMs":[]}')
    await new HyperVClient(conn).listVMs()

    expect(executeMock).toHaveBeenCalledOnce()
    const script = executeMock.mock.calls[0][0]
    expect(script).toContain("Get-VMHardDiskDrive")
    expect(script).toContain("Get-Item -LiteralPath")
    expect(script).not.toContain("Get-VHD")
    expect(script).not.toContain("Get-SmbShare")
    expect(script).toContain("$sharePath = $null")
  })

  it("resolves a requested SMB share in the same list command", async () => {
    executeMock.mockResolvedValue(JSON.stringify({ SharePath: "D:\\HYPERV", VMs: [] }))
    await new HyperVClient(conn).listVMs({ shareName: "VMs" })

    expect(executeMock).toHaveBeenCalledOnce()
    expect(executeMock.mock.calls[0][0]).toContain("Get-SmbShare -Name 'VMs'")
  })

  it("maps the wrapped VM array, sums disks, and derives mount paths", async () => {
    executeMock.mockResolvedValue(JSON.stringify({
      SharePath: "D:\\HYPERV",
      VMs: [
        {
          VMId: validVmId, Name: "web-01", State: 2, ProcessorCount: 4,
          MemoryMB: 8192, DynamicMemoryMaxMB: 16384, Generation: 2,
          Disks: [
            { Path: nestedDisk, SizeBytes: 100 },
            { Path: "E:\\other\\x.vhdx", SizeBytes: 250 },
          ],
        },
        {
          VMId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", Name: "db-01", State: 3,
          ProcessorCount: 8, MemoryMB: 16384, DynamicMemoryMaxMB: 32768, Generation: 1,
          Disks: [{ Path: "D:\\HYPERV\\db\\db.vhdx", SizeBytes: 500 }],
        },
      ],
    }))

    await expect(new HyperVClient(conn).listVMs()).resolves.toEqual([
      {
        vmId: validVmId, name: "web-01", state: "Running", cpuCount: 4, memoryMB: 8192,
        diskSizeBytes: 350, diskPaths: [nestedDisk, "E:\\other\\x.vhdx"],
        diskMountPaths: [
          "/mnt/hyperv/2025-test/2025-test/Virtual Hard Disks/2025-test.vhdx",
          "/mnt/hyperv/x.vhdx",
        ],
        generation: 2,
      },
      {
        vmId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", name: "db-01", state: "Off",
        cpuCount: 8, memoryMB: 16384, diskSizeBytes: 500,
        diskPaths: ["D:\\HYPERV\\db\\db.vhdx"], diskMountPaths: ["/mnt/hyperv/db/db.vhdx"],
        generation: 1,
      },
    ])
  })

  it("prefers the startup memory over the dynamic maximum for an off VM", async () => {
    executeMock.mockResolvedValue(JSON.stringify({
      SharePath: null,
      VMs: [{ VMId: "aaaaaaaa-0000-0000-0000-000000000001", Name: "off", State: 3, ProcessorCount: 2,
        MemoryMB: 0, MemoryStartupMB: 4096, DynamicMemoryMaxMB: 1048576, Generation: 2, Disks: [] }],
    }))

    const [vm] = await new HyperVClient(conn).listVMs()

    expect(vm.memoryMB).toBe(4096)
  })

  it("falls back to maximum dynamic memory for an off VM", async () => {
    executeMock.mockResolvedValue(JSON.stringify({
      SharePath: null,
      VMs: { VMId: validVmId, Name: "off-vm", State: 3, ProcessorCount: 2, MemoryMB: 0,
        DynamicMemoryMaxMB: 4096, Generation: 2, Disks: [] },
    }))

    const [vm] = await new HyperVClient(conn).listVMs()
    expect(vm.state).toBe("Off")
    expect(vm.memoryMB).toBe(4096)
  })

  it("tolerates a bare VM and a bare disk object", async () => {
    executeMock.mockResolvedValue(JSON.stringify({
      SharePath: null,
      VMs: { VMId: validVmId, Name: "single-disk-vm", State: "Paused", ProcessorCount: 1,
        MemoryMB: 1024, Generation: 2, Disks: { Path: "C:\\VMs\\missing.vhdx", SizeBytes: 0 } },
    }))

    const [vm] = await new HyperVClient(conn).listVMs()
    expect(vm.state).toBe("Paused")
    expect(vm.diskPaths).toEqual(["C:\\VMs\\missing.vhdx"])
    expect(vm.diskMountPaths).toEqual(["/mnt/hyperv/missing.vhdx"])
    expect(vm.diskSizeBytes).toBe(0)
  })

  it.each(['{"SharePath":null,"VMs":[]}', '{"SharePath":null}'])(
    "returns an empty list for stdout %j",
    async stdout => {
      executeMock.mockResolvedValue(stdout)
      await expect(new HyperVClient(conn).listVMs()).resolves.toEqual([])
    },
  )

  it("rejects a malformed VM ID without executing PowerShell", async () => {
    await expect(new HyperVClient(conn).getVM("not-a-guid")).rejects.toThrow("Invalid VM ID format: not-a-guid")
    expect(executeMock).not.toHaveBeenCalled()
  })

  it("gets one VM by GUID using Get-VHD and maps its share-relative disks", async () => {
    executeMock.mockResolvedValue(JSON.stringify({
      SharePath: "D:\\HYPERV", VMId: validVmId, Name: "migration-vm", State: 2,
      ProcessorCount: 6, MemoryMB: 12288, DynamicMemoryMaxMB: 16384, Generation: 2,
      Disks: [{ Path: nestedDisk, SizeBytes: 1000 }, { Path: "E:\\other\\x.vhdx", SizeBytes: 2000 }],
    }))

    const vm = await new HyperVClient(conn).getVM(validVmId, { shareName: "VMs" })

    expect(executeMock).toHaveBeenCalledOnce()
    const script = executeMock.mock.calls[0][0]
    expect(script).toContain("Get-VHD")
    expect(script).toContain("Get-SmbShare -Name 'VMs'")
    expect(vm).toEqual({
      vmId: validVmId, name: "migration-vm", state: "Running", cpuCount: 6, memoryMB: 12288,
      diskSizeBytes: 3000, diskPaths: [nestedDisk, "E:\\other\\x.vhdx"],
      diskMountPaths: [
        "/mnt/hyperv/2025-test/2025-test/Virtual Hard Disks/2025-test.vhdx",
        "/mnt/hyperv/x.vhdx",
      ],
      generation: 2,
    })
  })

  it("rejects a malformed readiness VM ID without executing PowerShell", async () => {
    await expect(new HyperVClient(conn).getVmReadiness("not-a-guid")).rejects.toThrow("Invalid VM ID format: not-a-guid")
    expect(executeMock).not.toHaveBeenCalled()
  })

  it.each([
    [{ State: 3, CheckpointCount: 2 }, { state: "Off", checkpointCount: 2 }],
    [{ State: 2 }, { state: "Running", checkpointCount: 0 }],
  ])("gets VM readiness from %j", async (stdout, expected) => {
    executeMock.mockResolvedValue(JSON.stringify(stdout))
    await expect(new HyperVClient(conn).getVmReadiness(validVmId)).resolves.toEqual(expected)

    expect(executeMock).toHaveBeenCalledOnce()
    const script = executeMock.mock.calls[0][0]
    expect(script).toContain("Get-VMSnapshot")
    expect(script).toContain(`'${validVmId}'`)
  })
})
