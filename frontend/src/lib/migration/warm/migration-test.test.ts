import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  pve: vi.fn(),
  ssh: vi.fn(),
  convert: vi.fn(),
  waitTask: vi.fn(async () => {}),
  reserve: vi.fn(async () => 9001),
  log: vi.fn(async (..._a: unknown[]) => {}),
  fields: vi.fn(async (..._a: unknown[]) => {}),
  request: vi.fn(async (): Promise<unknown> => ({ storage: "Dir-Images", bridge: null, vlanTag: null, maxSec: 3600 })),
  cancelled: false,
  cutover: false,
  stop: false,
  clear: vi.fn(),
}))

vi.mock("@/lib/proxmox/client", () => ({ pveFetch: h.pve }))
vi.mock("@/lib/ssh/exec", async (importActual) => ({ ...(await importActual<typeof import("@/lib/ssh/exec")>()), executeSSH: h.ssh }))
vi.mock("../pve-tasks", () => ({ waitForPveTask: h.waitTask }))
vi.mock("../reserve-target-vmid", () => ({ reserveTargetVmid: h.reserve }))
vi.mock("./guest-conversion", async (importActual) => ({ ...(await importActual<typeof import("./guest-conversion")>()), convertGuestForTest: h.convert }))
vi.mock("./job-control", () => ({
  appendLog: h.log,
  updateJobTestFields: h.fields,
  readJobTestRequest: h.request,
  isCancelled: () => h.cancelled,
  isCutoverRequested: () => h.cutover,
  isTestStopRequested: () => h.stop,
  clearWarmTest: h.clear,
}))

import type { PveVmCreateParams } from "../configMapper"
import { buildTestVmBody, overlayVolid, retargetNet, runMigrationTest, testVmMarker, type MigrationTestTarget } from "./migration-test"

const GiB = 1024 ** 3
const PATHS = ["/mnt/pve/ISO/dir-images/images/9001/vm-9001-test-0.qcow2", "/mnt/pve/ISO/dir-images/images/9001/vm-9001-test-1.qcow2"]

const params = (over: Partial<PveVmCreateParams> = {}): PveVmCreateParams => ({
  vmid: 115, name: "r9-i1000", ostype: "l26", cores: 2, sockets: 1, memory: 2048, cpu: "x86-64-v2-AES", scsihw: "virtio-scsi-single",
  bios: "ovmf", machine: "q35", boot: "order=net0", bootDiskSlot: "scsi0", diskSlots: ["scsi0", "scsi1"], agent: "1",
  nets: { net0: "virtio=00:50:56:9c:c0:8f,bridge=vmbr0,firewall=1" }, efidisk0: "R177-Thin:1,efitype=4m,pre-enrolled-keys=1",
  ...over,
})

describe("overlayVolid / retargetNet", () => {
  it("names the overlay volume after the test VM", () => {
    expect(overlayVolid("Dir-Images", 9001, 1)).toBe("Dir-Images:9001/vm-9001-test-1.qcow2")
  })

  it("moves a NIC to the test bridge and VLAN, keeping its model and MAC", () => {
    expect(retargetNet("virtio=00:50:56:9c:c0:8f,bridge=vmbr0,firewall=1", "vmbr9", 30)).toBe("virtio=00:50:56:9c:c0:8f,bridge=vmbr9,tag=30")
    expect(retargetNet("e1000=00:50:56:9c:a1:f0,bridge=vmbr0,tag=12", "vmbr1", null)).toBe("e1000=00:50:56:9c:a1:f0,bridge=vmbr1")
  })
})

describe("buildTestVmBody", () => {
  const body = (over: Partial<Parameters<typeof buildTestVmBody>[1]> = {}) => Object.fromEntries(buildTestVmBody(params(), {
    jobId: "j1", vmid: 9001, storage: "Dir-Images", overlayVolids: [overlayVolid("Dir-Images", 9001, 0), overlayVolid("Dir-Images", 9001, 1)], bridge: null, vlanTag: null, ...over,
  }))

  it("boots the overlays on the cutover's slots, out of the backups, tagged and named as a test", () => {
    const b = body()
    expect(b).toMatchObject({
      vmid: "9001", name: "r9-i1000-test", tags: "proxcenter-test", onboot: "0", memory: "2048", bios: "ovmf", machine: "q35", scsihw: "virtio-scsi-single",
      scsi0: "Dir-Images:9001/vm-9001-test-0.qcow2,backup=0", scsi1: "Dir-Images:9001/vm-9001-test-1.qcow2,backup=0", boot: "order=scsi0",
    })
  })

  it("marks the VM as the test of this job, which is what its removal checks", () => {
    expect(body().description).toBe(testVmMarker("j1"))
  })

  it("has no network unless a bridge was chosen", () => {
    expect(body().net0).toBeUndefined()
    expect(body({ bridge: "vmbr9", vlanTag: 30 }).net0).toBe("virtio=00:50:56:9c:c0:8f,bridge=vmbr9,tag=30")
  })

  it("puts its EFI vars on the overlay storage, never on the target's", () => {
    expect(body().efidisk0).toBe("Dir-Images:1,efitype=4m,pre-enrolled-keys=1")
  })

  it("adds the cutover's drive options", () => {
    expect(body({ driveOpts: () => ",discard=on" }).scsi1).toBe("Dir-Images:9001/vm-9001-test-1.qcow2,backup=0,discard=on")
  })
})

describe("runMigrationTest", () => {
  let avail: number
  let freeOnStorage: number
  const pveCalls = () => h.pve.mock.calls.map(c => `${(c[2] as any)?.method ?? "GET"} ${c[1]}`)
  const sshCmds = () => h.ssh.mock.calls.map(c => String(c[2]))
  const states = () => h.fields.mock.calls.map(c => (c[1] as any).testState).filter(Boolean)

  const target = (over: Partial<MigrationTestTarget> = {}): MigrationTestTarget => ({
    jobId: "j1", pveConn: {}, targetConnectionId: "tc", node: "pve1", nodeIp: "10.42.0.101",
    devices: ["/dev/r177/vm-115-disk-1", "/dev/r177/vm-115-disk-2"],
    conversion: { name: "r9-i1000", firmware: "efi", isWindows: false, memoryMB: 2048 },
    paramsFor: vi.fn((converted: boolean) => params({ scsihw: converted ? "virtio-scsi-single" : "lsi" })),
    timing: { tickMs: 1, pollMs: 1 },
    ...over,
  })

  beforeEach(() => {
    h.cancelled = false; h.cutover = false; h.stop = false
    avail = 8 * GiB; freeOnStorage = 20 * GiB
    h.pve.mockReset().mockImplementation(async (_c: unknown, path: string, init?: any) => {
      if (path === "/nodes/pve1/status") return { memory: { total: 24 * GiB, available: avail, free: avail } }
      if (path === "/nodes/pve1/storage/Dir-Images/status") return { avail: freeOnStorage, type: "dir" }
      if (path === "/nodes/pve1/qemu/9001/status/current") return { status: "running" }
      if (path === "/nodes/pve1/qemu/9001/config") return { description: testVmMarker("j1"), tags: "proxcenter-test" }
      if (init?.method === "POST" || init?.method === "DELETE") return "UPID:pve1:x"
      return null
    })
    h.ssh.mockReset().mockImplementation(async (_c: unknown, _n: unknown, cmd: string) => {
      if (cmd.startsWith("pvesm path")) return { success: true, output: `${PATHS[0]}\n${PATHS[1]}\n` }
      if (cmd.startsWith("du ")) return { success: true, output: `${600 * 1048576}\n${freeOnStorage}\n` }
      return { success: true, output: "" }
    })
    h.convert.mockReset().mockResolvedValue({ converted: true, os: "Rocky Linux 9.8", seconds: 114 })
    h.waitTask.mockClear(); h.reserve.mockClear(); h.log.mockClear(); h.fields.mockClear(); h.clear.mockClear()
    h.request.mockReset().mockResolvedValue({ storage: "Dir-Images", bridge: null, vlanTag: null, maxSec: 3600 })
  })
  afterEach(() => { vi.restoreAllMocks() })

  /** Let the test run until it reports "running", then ask it to stop. */
  const stopOnceRunning = () => h.fields.mockImplementation(async (_id: unknown, data: any) => { if (data?.testState?.phase === "running") h.stop = true })

  it("reports each step of the preparation and when it started: checks, guest conversion, boot", async () => {
    stopOnceRunning()
    await runMigrationTest(target())
    const preparing = states().filter(s => s.phase === "preparing")
    expect(typeof preparing[0].preparingSince).toBe("string")
    expect([...new Set(preparing.map(s => s.step))]).toEqual(["checks", "conversion", "boot"])
  })

  it("reports the overlay creation as its second step when the guest is not converted", async () => {
    stopOnceRunning()
    await runMigrationTest(target({ conversion: null }))
    expect([...new Set(states().filter(s => s.phase === "preparing").map(s => s.step))]).toEqual(["checks", "overlay", "boot"])
  })

  it("refuses to start without enough RAM on the node, and creates nothing", async () => {
    avail = 2 * GiB
    await runMigrationTest(target())
    expect(states().at(-1)).toMatchObject({ phase: "failed" })
    expect(states().at(-1).reason).toMatch(/RAM/)
    expect(pveCalls().some(c => c.startsWith("POST"))).toBe(false)
    expect(h.convert).not.toHaveBeenCalled()
    expect(h.clear).toHaveBeenCalledWith("j1")
  })

  it("refuses to start with under 2 GiB free on the overlay storage", async () => {
    freeOnStorage = 1.5 * GiB
    await runMigrationTest(target())
    expect(states().at(-1).reason).toMatch(/free/)
    expect(pveCalls().some(c => c.startsWith("POST"))).toBe(false)
  })

  it("converts the overlays, boots the test VM, and removes it with its overlays when asked to stop", async () => {
    stopOnceRunning()
    await runMigrationTest(target())

    expect(h.convert).toHaveBeenCalledWith(expect.objectContaining({ jobId: "j1", devices: ["/dev/r177/vm-115-disk-1", "/dev/r177/vm-115-disk-2"], overlayPaths: PATHS }))
    expect(pveCalls()).toEqual(expect.arrayContaining([
      "POST /nodes/pve1/qemu",
      "POST /nodes/pve1/qemu/9001/status/start",
      "POST /nodes/pve1/qemu/9001/status/stop",
      "DELETE /nodes/pve1/qemu/9001?purge=1&destroy-unreferenced-disks=1",
    ]))
    const order = pveCalls().filter(c => c.startsWith("POST") || c.startsWith("DELETE"))
    expect(order).toEqual(["POST /nodes/pve1/qemu", "POST /nodes/pve1/qemu/9001/status/start", "POST /nodes/pve1/qemu/9001/status/stop", "DELETE /nodes/pve1/qemu/9001?purge=1&destroy-unreferenced-disks=1"])
    expect(sshCmds()).toContain(`rm -f '${PATHS[0]}' '${PATHS[1]}'`)
    const running = states().find(s => s.phase === "running")
    expect(running).toMatchObject({ testVmid: 9001, storage: "Dir-Images", overlays: PATHS })
    expect(typeof running.endsAt).toBe("string")
    expect(states().at(-1)).toMatchObject({ phase: "ended", reason: "stopped by the operator" })
    expect(h.fields).toHaveBeenCalledWith("j1", expect.objectContaining({ testRequest: null, testStopRequestedAt: null }))
    expect(h.clear).toHaveBeenCalledWith("j1")
  })

  it("stops the test VM the way an API token may, without skiplock (lab 15/11: 400, then a destroy refused on a running VM)", async () => {
    stopOnceRunning()
    await runMigrationTest(target())
    const stopCall = h.pve.mock.calls.find(c => c[1] === "/nodes/pve1/qemu/9001/status/stop")!
    expect(String((stopCall[2] as any)?.body ?? "")).not.toContain("skiplock")
    // the destroy task is waited for before the overlay files go
    const destroyAt = h.pve.mock.calls.findIndex(c => String(c[1]).startsWith("/nodes/pve1/qemu/9001?purge=1"))
    expect(h.waitTask.mock.invocationCallOrder.some(o => o > h.pve.mock.invocationCallOrder[destroyAt])).toBe(true)
  })

  it("says the test VM is still there, and leaves its overlays, when it cannot be removed", async () => {
    stopOnceRunning()
    const base = h.pve.getMockImplementation()!
    h.pve.mockImplementation(async (c: unknown, path: string, init?: any) => {
      if (path === "/nodes/pve1/qemu/9001/status/stop") throw new Error("PVE 400: Only root may use this option")
      return base(c, path, init)
    })
    await runMigrationTest(target())
    expect(states().at(-1)).toMatchObject({ phase: "failed" })
    expect(states().at(-1).reason).toBe("test VM 9001 could not be removed (PVE 400: Only root may use this option): stop and delete it in Proxmox")
    expect(pveCalls().some(c => c.startsWith("DELETE"))).toBe(false)
    expect(sshCmds().some(c => c.startsWith("rm -f"))).toBe(false)
    expect(h.log).toHaveBeenCalledWith("j1", expect.stringContaining("Test: test VM 9001 could not be removed"), "error")
  })

  it("names its time limit in the log rather than a timestamp", async () => {
    stopOnceRunning()
    await runMigrationTest(target())
    expect(h.log).toHaveBeenCalledWith("j1", expect.stringMatching(/started on pve1, no network; it stops by itself after 1 h$/), "success")
  })

  it("records the test VM and its overlays before booting it, for the cleanup after a restart", async () => {
    stopOnceRunning()
    await runMigrationTest(target())
    const firstWithVm = h.fields.mock.calls.findIndex(c => (c[1] as any)?.testState?.testVmid === 9001)
    const createAt = h.pve.mock.invocationCallOrder[h.pve.mock.calls.findIndex(c => c[1] === "/nodes/pve1/qemu")]
    expect(h.fields.mock.invocationCallOrder[firstWithVm]).toBeLessThan(createAt)
  })

  it("boots the hardware the cutover would give the guest, converted or not", async () => {
    stopOnceRunning()
    const t = target()
    await runMigrationTest(t)
    expect(t.paramsFor).toHaveBeenLastCalledWith(true)

    h.stop = false; stopOnceRunning()
    h.convert.mockResolvedValue({ converted: false, reason: "the Windows filesystem was not shut down cleanly" })
    const t2 = target()
    await runMigrationTest(t2)
    expect(t2.paramsFor).toHaveBeenLastCalledWith(false)
    // The overlays a failed conversion touched are made again from the copy.
    expect(sshCmds().some(c => c.includes(`rm -f '${PATHS[0]}'; qemu-img create`))).toBe(true)
  })

  it("makes bare overlays when the migration does not convert the guest", async () => {
    stopOnceRunning()
    await runMigrationTest(target({ conversion: null }))
    expect(h.convert).not.toHaveBeenCalled()
    expect(sshCmds().some(c => c.includes("qemu-img create -q -f qcow2 -b '/dev/r177/vm-115-disk-1' -F raw"))).toBe(true)
  })

  it("prepares the boot overlay after the conversion and before the VM is created", async () => {
    stopOnceRunning()
    const prepareBoot = vi.fn(async () => {})
    await runMigrationTest(target({ prepareBoot }))
    expect(prepareBoot).toHaveBeenCalledWith(PATHS[0])
    const createAt = h.pve.mock.invocationCallOrder[h.pve.mock.calls.findIndex(c => c[1] === "/nodes/pve1/qemu")]
    expect(prepareBoot.mock.invocationCallOrder[0]).toBeLessThan(createAt)
    expect(prepareBoot.mock.invocationCallOrder[0]).toBeGreaterThan(h.convert.mock.invocationCallOrder[0])
  })

  it("stops by itself when the overlay storage falls under 1 GiB free", async () => {
    h.fields.mockImplementation(async (_id: unknown, data: any) => { if (data?.testState?.phase === "running") freeOnStorage = 0.5 * GiB })
    await runMigrationTest(target())
    expect(states().at(-1)).toMatchObject({ phase: "ended" })
    expect(states().at(-1).reason).toMatch(/free space/)
    expect(pveCalls()).toContain("DELETE /nodes/pve1/qemu/9001?purge=1&destroy-unreferenced-disks=1")
  })

  it("reports the size of the overlays while it runs", async () => {
    let probes = 0
    h.fields.mockImplementation(async (_id: unknown, data: any) => { if (data?.testState?.overlayBytes) { probes++; h.stop = true } })
    await runMigrationTest(target())
    expect(probes).toBeGreaterThan(0)
    expect(states().find(s => s.overlayBytes)).toMatchObject({ phase: "running", overlayBytes: 600 * 1048576 })
  })

  it("stops by itself at its time limit", async () => {
    const t0 = Date.now()
    let now = t0
    vi.spyOn(Date, "now").mockImplementation(() => now)
    h.fields.mockImplementation(async (_id: unknown, data: any) => { if (data?.testState?.phase === "running") now = t0 + 3600 * 1000 + 1 })
    await runMigrationTest(target())
    expect(states().at(-1)).toMatchObject({ phase: "ended", reason: "time limit reached" })
  })

  it("stops the test before a cutover that reached the engine anyway", async () => {
    h.fields.mockImplementation(async (_id: unknown, data: any) => { if (data?.testState?.phase === "running") h.cutover = true })
    await expect(runMigrationTest(target())).resolves.toBeUndefined()
    expect(pveCalls()).toContain("DELETE /nodes/pve1/qemu/9001?purge=1&destroy-unreferenced-disks=1")
    expect(states().at(-1).reason).toMatch(/cutover/)
  })

  it("removes the test VM on a cancellation, then lets it through", async () => {
    h.fields.mockImplementation(async (_id: unknown, data: any) => { if (data?.testState?.phase === "running") h.cancelled = true })
    await expect(runMigrationTest(target())).rejects.toThrow("Migration cancelled")
    expect(pveCalls()).toContain("DELETE /nodes/pve1/qemu/9001?purge=1&destroy-unreferenced-disks=1")
    expect(states().at(-1)).toMatchObject({ phase: "ended", reason: "the migration was cancelled" })
    expect(h.log).toHaveBeenCalledWith("j1", "Test: ended (the migration was cancelled); test VM 9001 and its overlays removed", "info")
  })

  it("removes the overlays when the conversion is cancelled, before any VM exists", async () => {
    h.convert.mockImplementation(async () => { h.cancelled = true; throw new Error("Migration cancelled") })
    await expect(runMigrationTest(target())).rejects.toThrow("Migration cancelled")
    expect(pveCalls().some(c => c.startsWith("POST"))).toBe(false)
    expect(sshCmds()).toContain(`rm -f '${PATHS[0]}' '${PATHS[1]}'`)
  })

  it("ends as failed, without throwing, when the test VM cannot be created", async () => {
    h.pve.mockImplementation(async (_c: unknown, path: string, init?: any) => {
      if (path === "/nodes/pve1/status") return { memory: { available: 8 * GiB } }
      if (path === "/nodes/pve1/storage/Dir-Images/status") return { avail: 20 * GiB }
      if (path === "/nodes/pve1/qemu" && init?.method === "POST") throw new Error("storage 'Dir-Images' does not support content-type 'images'")
      return "UPID:pve1:x"
    })
    await expect(runMigrationTest(target())).resolves.toBeUndefined()
    expect(states().at(-1)).toMatchObject({ phase: "failed" })
    expect(states().at(-1).reason).toMatch(/does not support/)
    expect(sshCmds()).toContain(`rm -f '${PATHS[0]}' '${PATHS[1]}'`)
  })

  it("never stops nor destroys a VM it did not create on its VMID (the id was taken meanwhile)", async () => {
    const base = h.pve.getMockImplementation()!
    h.pve.mockImplementation(async (c: unknown, path: string, init?: any) => {
      if (path === "/nodes/pve1/qemu" && init?.method === "POST") throw new Error("PVE 500: VM 9001 already exists on node 'pve1'")
      if (path === "/nodes/pve1/qemu/9001/config") return { name: "someone-elses-vm", description: "prod database" }
      return base(c, path, init)
    })
    await runMigrationTest(target())
    expect(pveCalls().filter(c => c.startsWith("POST /nodes/pve1/qemu/9001") || c.startsWith("DELETE"))).toEqual([])
    expect(states().at(-1)).toMatchObject({ phase: "failed" })
    expect(states().at(-1).reason).toMatch(/already exists/)
    expect(sshCmds()).toContain(`rm -f '${PATHS[0]}' '${PATHS[1]}'`)
  })

  it("treats a test VM that does not exist as gone, removes the overlays and keeps the real error", async () => {
    const base = h.pve.getMockImplementation()!
    h.pve.mockImplementation(async (c: unknown, path: string, init?: any) => {
      if (path === "/nodes/pve1/qemu" && init?.method === "POST") throw new Error("PVE 400: parameter verification failed")
      if (path.startsWith("/nodes/pve1/qemu/9001")) throw new Error("PVE 500: Configuration file 'nodes/pve1/qemu-server/9001.conf' does not exist")
      return base(c, path, init)
    })
    await runMigrationTest(target())
    expect(states().at(-1).reason).toBe("PVE 400: parameter verification failed")
    expect(sshCmds()).toContain(`rm -f '${PATHS[0]}' '${PATHS[1]}'`)
  })

  it("stops while it is still being prepared, before converting anything", async () => {
    h.stop = true
    await runMigrationTest(target())
    expect(h.convert).not.toHaveBeenCalled()
    expect(pveCalls().some(c => c.startsWith("POST"))).toBe(false)
    expect(states().at(-1)).toMatchObject({ phase: "ended", reason: "stopped by the operator" })
  })

  it("removes the overlay directory it made when no VM came to own it", async () => {
    h.stop = true
    h.convert.mockClear()
    // stopped once the paths are known: nothing of PVE removes the directory then
    h.request.mockImplementation(async () => ({ storage: "Dir-Images", bridge: null, vlanTag: null, maxSec: 3600 }))
    h.stop = false
    h.convert.mockImplementation(async () => { h.stop = true; throw new Error("Migration cancelled") })
    await runMigrationTest(target())
    expect(sshCmds()).toContain("rmdir --ignore-fail-on-non-empty '/mnt/pve/ISO/dir-images/images/9001'")
  })

  it("ends a stop asked during the conversion as a stop, not as a cancellation", async () => {
    h.convert.mockImplementation(async (a: any) => { h.stop = true; if (a.isCancelled()) throw new Error("Migration cancelled"); return { converted: true } })
    await expect(runMigrationTest(target())).resolves.toBeUndefined()
    expect(pveCalls().some(c => c === "POST /nodes/pve1/qemu")).toBe(false)
    expect(states().at(-1)).toMatchObject({ phase: "ended", reason: "stopped by the operator" })
  })

  it("refuses a request it cannot read", async () => {
    h.request.mockResolvedValue(null)
    await runMigrationTest(target())
    expect(states().at(-1)).toMatchObject({ phase: "failed", reason: "storage is required" })
  })
})
