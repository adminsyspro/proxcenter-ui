import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

/**
 * Integration test of runMigrationPipeline for the per-disk target storage and
 * disk exclusion of #317 (lot 2).
 *
 * Drives the real direct-ESXi cold pipeline end to end with every external
 * dependency mocked, in the style of v2v-pipeline.integration.test.ts: SSH
 * commands are answered by a router keyed on the command shape, the PVE API
 * and the job row are fakes, SOAP is stubbed, and the fake PVE keeps the VM
 * config that attach calls write so disk numbering follows the real rule.
 *
 * Everything runs under fake timers: the transfer loops sleep 3 to 5 s per poll.
 */

// `executeSSHWithTimeout` (the qemu-img convert of the HTTPS and live file paths)
// opens its own ssh2 session; this fake answers CONVERT_OK to anything and
// records the command. Hoisted because the mock factory runs before imports.
const ssh2Commands = vi.hoisted(() => [] as string[])

vi.mock("ssh2", async () => {
  const { EventEmitter } = await import("node:events")
  class FakeStream extends EventEmitter {
    stderr = new EventEmitter()
  }
  class Client extends EventEmitter {
    connect() {
      queueMicrotask(() => this.emit("ready"))
    }
    exec(command: string, cb: (err: Error | null, stream: FakeStream) => void) {
      ssh2Commands.push(command)
      const stream = new FakeStream()
      cb(null, stream)
      queueMicrotask(() => {
        stream.emit("data", Buffer.from("CONVERT_OK"))
        stream.emit("close", 0)
      })
    }
    end() {}
  }
  return { Client }
})
vi.mock("@/lib/ssh/exec", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/ssh/exec")>()
  return { ...actual, executeSSH: vi.fn() } // keep the real shellEscape
})
vi.mock("@/lib/proxmox/client", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/proxmox/client")>()
  return { ...actual, pveFetch: vi.fn() }
})
vi.mock("@/lib/connections/getConnection", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/connections/getConnection")>()
  return { ...actual, getConnectionById: vi.fn() }
})
vi.mock("@/lib/tenant", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/tenant")>()
  return { ...actual, getTenantPrisma: vi.fn() }
})
vi.mock("@/lib/crypto/secret", () => ({
  encryptSecret: (s: string) => s,
  decryptSecret: (s: string) => s,
}))
vi.mock("@/lib/vmware/soap", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/vmware/soap")>()
  return {
    ...actual,
    soapLogin: vi.fn(), soapGetVmConfig: vi.fn(), parseVmConfig: vi.fn(), soapLogout: vi.fn(),
    soapPowerOffVm: vi.fn(), soapCreateSnapshot: vi.fn(), soapRemoveAllSnapshots: vi.fn(),
  }
})
vi.mock("./integrity", async importOriginal => {
  const actual = await importOriginal<typeof import("./integrity")>()
  return { ...actual, verifyDiskIntegrity: vi.fn(), faultInjectionFromEnv: () => null }
})
vi.mock("./integrity-target", () => ({
  resolveIntegritySettings: vi.fn(async () => ({ enabled: true, regionCount: 8, regionSizeMiB: 4 })),
}))
vi.mock("./job-heartbeat", () => ({ startJobHeartbeat: vi.fn() }))
vi.mock("./pve-vm-config", () => ({ pveSetVmConfig: vi.fn(), destroyPveVm: vi.fn() }))
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }))

import { executeSSH } from "@/lib/ssh/exec"
import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { getTenantPrisma } from "@/lib/tenant"
import { soapLogin, soapGetVmConfig, parseVmConfig, soapCreateSnapshot, soapRemoveAllSnapshots } from "@/lib/vmware/soap"
import { verifyDiskIntegrity } from "./integrity"
import { startJobHeartbeat } from "./job-heartbeat"
import { pveSetVmConfig, destroyPveVm } from "./pve-vm-config"
import { audit } from "@/lib/audit"
import { runMigrationPipeline } from "./pipeline"

type ColdConfig = Parameters<typeof runMigrationPipeline>[1]

const GIB = 1073741824
const VMID = 120
const PVE_CONN = { id: "conn-pve", baseUrl: "https://pve.example:8006", apiToken: "root@pam!t=x", insecureDev: true }

/** Source host with password SSH, so SSHFS and the live clone are available. */
const ESXI_CONN = {
  id: "conn-esxi", name: "esxi-lab", baseUrl: "https://10.42.0.21", apiTokenEnc: "root:secret", insecureTLS: true,
  type: "vmware", sshEnabled: true, sshPort: 22, sshUser: "root", sshAuthMethod: "password", sshKeyEnc: null, sshPassEnc: "esxipw",
}
/** Target connection row as executeSSHWithTimeout and the endpoint resolver read it. */
const PVE_CONN_ROW = {
  sshEnabled: true, sshPort: 22, sshUser: "root", sshAuthMethod: "password", sshKeyEnc: null, sshPassEnc: "pvepw", sshUseSudo: false,
}

/** The storages of the fake cluster: the job default is block, "ISO" is a dir storage. */
const STORAGES: Record<string, { type: string; path?: string }> = {
  "local-lvm": { type: "lvmthin" },
  ISO: { type: "dir", path: "/var/lib/vz" },
}

function makeVm(powerState = "poweredOff") {
  return {
    name: "web-01", guestOS: "Ubuntu Linux (64-bit)", guestId: "ubuntu64Guest", numCPU: 2, numCoresPerSocket: 2, sockets: 1,
    memoryMB: 2048, firmware: "bios", uuid: "4201-web", vmxVersion: "vmx-19", vmPathName: "[ds1] web-01/web-01.vmx",
    powerState, committed: 0, snapshotCount: 0, nics: [], hasVtpm: false,
    disks: [
      {
        label: "Hard disk 1", fileName: "[ds1] web-01/web-01.vmdk", capacityBytes: 10 * GIB, thinProvisioned: true,
        datastoreName: "ds1", relativePath: "web-01/web-01.vmdk", controllerType: "scsi", controllerKey: 1000, unitNumber: 0,
      },
      {
        label: "Hard disk 2", fileName: "[ds1] web-01/web-01_1.vmdk", capacityBytes: 20 * GIB, thinProvisioned: true,
        datastoreName: "ds1", relativePath: "web-01/web-01_1.vmdk", controllerType: "scsi", controllerKey: 1000, unitNumber: 1,
      },
    ],
  }
}

// ── Fakes ──

/** Free bytes per storage, overridden by the space test. */
let storageAvail: Record<string, number>
/** VM config as the fake PVE sees it: attach calls write into it, config reads return it. */
let vmConf: Record<string, string>
/** Answer of the adoption attempt (#292); empty = rename refused, import fallback. */
let adoptAnswer: string
/** Answer of the `qm disk import` fallback. */
let importAnswer: { success: boolean; output: string }

function ok(output = "") {
  return { success: true as const, output }
}

async function sshRouter(_connId: string, _host: string, command: string) {
  if (command === "echo ok") return ok("ok")
  if (command.startsWith("which ")) return ok(`/usr/bin/${command.slice(6).trim()}`)
  // Datastore symlink resolution before the SSHFS mount
  if (command.includes("readlink -f")) return ok("/vmfs/volumes/5f0e-ds1")
  // Mount verification: the datastore has files
  if (command.startsWith('ls "')) return ok("web-01\n")
  if (command.includes("&& echo EXISTS || echo MISSING")) return ok("EXISTS")
  if (command.startsWith("nohup bash ")) return ok("4242") // fake pid
  // Exit-file polls of every background step: finished, exit 0
  if (command.includes("|| echo RUNNING")) return ok("0")
  // qemu-img convert progress, then dd progress
  if (command.includes("/100%")) return ok("100.00")
  if (command.startsWith("tail -c 200 ")) return ok(String(10 * GIB))
  // curl stats of the HTTPS download
  if (command.startsWith("cat ") && command.includes(".stats")) return ok('{"speed":104857600,"size":10737418240,"time":10,"http_code":200}')
  if (command.startsWith("stat -c %s ")) return ok(String(10 * GIB))
  const alloc = command.match(/^pvesm alloc '([^']+)' (\d+) '([^']+)' (\d+)/)
  if (alloc) return ok(`successfully created '${alloc[1]}:${alloc[3]}'`)
  const path = command.match(/^pvesm path '[^:']+:([^']+)'/)
  if (path) return ok(`/dev/pve/${path[1]}`)
  if (command.includes("echo ADOPT_OK")) return ok(adoptAnswer)
  if (command.startsWith("qm disk import ")) return importAnswer
  // mkdir -p, cat > script, echo pid > file, rm -f, fusermount, sshfs mount: plain success
  return ok("")
}

async function pveRouter(_conn: unknown, path: string, init?: { method?: string }) {
  // VM create accepted; falsy return skips the task-status polling
  if (path.endsWith("/qemu") && init?.method === "POST") return ""
  const storage = path.match(/^\/storage\/([^/]+)$/)
  if (storage) return STORAGES[decodeURIComponent(storage[1])] ?? { type: "dir" }
  const status = path.match(/^\/nodes\/[^/]+\/storage\/([^/]+)\/status$/)
  if (status) return { active: 1, avail: storageAvail[decodeURIComponent(status[1])] ?? 1000 * GIB }
  if (path.endsWith(`/qemu/${VMID}/config`)) return { ...vmConf }
  return {}
}

function makeFakePrisma() {
  const row: Record<string, any> = { config: {}, logs: [] as any[], progress: 0, status: "pending" }
  const update = vi.fn(async ({ data }: any) => {
    Object.assign(row, data)
    return row
  })
  return {
    row,
    migrationJob: {
      findUnique: vi.fn(async () => ({ ...row })),
      update,
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    connection: {
      findUnique: vi.fn(async ({ where }: any) => (where.id === ESXI_CONN.id ? ESXI_CONN : PVE_CONN_ROW)),
    },
    managedHost: {
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
    },
  }
}

let prisma: ReturnType<typeof makeFakePrisma>

const messages = () => (prisma.row.logs as Array<{ msg: string }>).map(l => l.msg)
const sshCommands = () => vi.mocked(executeSSH).mock.calls.map(c => String(c[2]))
const pvePaths = () => vi.mocked(pveFetch).mock.calls.map(c => String(c[1]))
/** The slot -> value pairs every attach call wrote, in order. */
const attached = () => vi.mocked(pveSetVmConfig).mock.calls.flatMap(c => [...(c[3] as URLSearchParams).entries()])
const slotValue = (slot: string) => attached().find(([k]) => k === slot)?.[1]

function makeConfig(overrides: Partial<ColdConfig> = {}): ColdConfig {
  return {
    sourceConnectionId: ESXI_CONN.id,
    sourceVmId: "vm-12",
    targetConnectionId: PVE_CONN.id,
    targetNode: "pve1",
    targetStorage: "local-lvm",
    networkBridge: "vmbr0",
    startAfterMigration: false,
    targetVmid: VMID,
    ...overrides,
  }
}

/** Run the pipeline to completion under fake timers (the poll loops sleep 3-5 s). */
async function runPipelineToEnd(jobId: string, config: ColdConfig): Promise<void> {
  let settled = false
  const run = runMigrationPipeline(jobId, config, "tenant-test").finally(() => {
    settled = true
  })
  for (let i = 0; i < 600 && !settled; i++) {
    await vi.advanceTimersByTimeAsync(1000)
  }
  if (!settled) throw new Error("pipeline did not settle within the fake-time budget")
  await run
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  ssh2Commands.length = 0
  storageAvail = {}
  vmConf = {}
  adoptAnswer = "ADOPT_OK"
  importAnswer = { success: true, output: `Successfully imported disk as 'unused0:ISO:${VMID}/vm-${VMID}-disk-9.qcow2'` }
  prisma = makeFakePrisma()
  vi.mocked(getTenantPrisma).mockImplementation(() => prisma as any)
  vi.mocked(getConnectionById).mockResolvedValue(PVE_CONN as any)
  vi.mocked(startJobHeartbeat).mockReturnValue(() => {})
  vi.mocked(pveSetVmConfig).mockImplementation((async (_c: unknown, _n: string, _v: number, body: URLSearchParams) => {
    for (const [k, v] of body.entries()) vmConf[k] = v
  }) as any)
  vi.mocked(destroyPveVm).mockResolvedValue(undefined as any)
  vi.mocked(audit).mockResolvedValue("audit-1" as any)
  vi.mocked(executeSSH).mockImplementation(sshRouter as any)
  vi.mocked(pveFetch).mockImplementation(pveRouter as any)
  vi.mocked(soapLogin).mockResolvedValue({ cookie: 'vmware_soap_session="abc"' } as any)
  vi.mocked(soapGetVmConfig).mockResolvedValue("<xml/>")
  vi.mocked(parseVmConfig).mockReturnValue(makeVm() as any)
  vi.mocked(verifyDiskIntegrity).mockResolvedValue({} as any)
  vi.mocked(soapCreateSnapshot).mockResolvedValue(undefined as any)
  vi.mocked(soapRemoveAllSnapshots).mockResolvedValue(undefined as any)
})

afterEach(() => {
  vi.useRealTimers()
})

describe("runMigrationPipeline per-disk target storage (#317 lot 2)", () => {
  it("SSHFS: streams disk 1 raw to the block default and converts disk 2 to qcow2 on the file-based ISO", { timeout: 20000 }, async () => {
    const jobId = "pd-sshfs-mixed"
    await runPipelineToEnd(jobId, makeConfig({ disks: [{ index: 1, targetStorage: "ISO" }] }))

    expect(prisma.row.status).toBe("completed")
    const logs = messages()
    expect(logs).toContain("Per-disk choices: storage disk 1->local-lvm, disk 2->ISO")
    // free space is checked per storage, each against its own share
    expect(pvePaths().filter(p => /\/storage\/[^/]+\/status$/.test(p))).toEqual([
      "/nodes/pve1/storage/local-lvm/status", "/nodes/pve1/storage/ISO/status",
    ])
    expect(logs.some(m => m.startsWith('Target storage "local-lvm":') && m.endsWith("need 10.0 GB"))).toBe(true)
    expect(logs.some(m => m.startsWith('Target storage "ISO":') && m.endsWith("need 20.0 GB"))).toBe(true)
    // both storage configs are read, and only the file-based one gets a temp dir
    expect(pvePaths()).toContain("/storage/local-lvm")
    expect(pvePaths()).toContain("/storage/ISO")
    const commands = sshCommands()
    expect(commands.filter(c => c === `mkdir -p "/var/lib/vz/images/${VMID}"`)).toHaveLength(1)
    expect(logs).toContain(`Temp directory: /var/lib/vz/images/${VMID} (on target storage "ISO")`)
    // disk 1: one raw volume on the block storage, dd'd from the SSHFS mount
    const allocs = commands.filter(c => c.startsWith("pvesm alloc "))
    expect(allocs).toEqual([`pvesm alloc 'local-lvm' ${VMID} 'vm-${VMID}-disk-0' ${10 * GIB / 1024} --format raw 2>&1`])
    expect(commands.some(c => c.includes(`dd if="/tmp/proxcenter-sshfs-${jobId}/web-01/web-01-flat.vmdk" of="/dev/pve/vm-${VMID}-disk-0"`))).toBe(true)
    // disk 2: qemu-img convert to qcow2 straight into ISO's images dir, adopted by rename
    const tmp1 = `/var/lib/vz/images/${VMID}/proxcenter-mig-${jobId}-disk1`
    expect(commands.some(c => c.includes(`qemu-img convert -p -f raw -O qcow2 "/tmp/proxcenter-sshfs-${jobId}/web-01/web-01_1-flat.vmdk" "${tmp1}.qcow2"`))).toBe(true)
    const adopt = commands.find(c => c.includes("echo ADOPT_OK")) || ""
    expect(adopt).toContain(`mv -n '${tmp1}.qcow2' '/var/lib/vz/images/${VMID}/vm-${VMID}-disk-1.qcow2'`)
    expect(logs).toContain('Adding disk to storage "ISO"...')
    expect(commands.some(c => c.startsWith("qm disk import "))).toBe(false)
    // attached on their own storage, discard only on the file volume
    expect(slotValue("scsi0")).toBe(`local-lvm:vm-${VMID}-disk-0`)
    expect(slotValue("scsi1")).toBe(`ISO:${VMID}/vm-${VMID}-disk-1.qcow2,discard=on`)
    // the integrity check targets each disk's own copy
    const verified = vi.mocked(verifyDiskIntegrity).mock.calls.map(c => c[0])
    expect(verified).toHaveLength(2)
    expect(verified[0]).toMatchObject({ diskIndex: 0, target: { kind: "raw", path: `/dev/pve/vm-${VMID}-disk-0` } })
    expect(verified[0]).not.toHaveProperty("checkImage")
    expect(verified[1]).toMatchObject({
      diskIndex: 1, target: { kind: "image", path: `${tmp1}.qcow2`, format: "qcow2" }, checkImage: { path: `${tmp1}.qcow2`, format: "qcow2" },
    })
  })

  it("HTTPS: streams disk 1 through curl|dd to the block default and downloads, converts and adopts disk 2 on ISO", { timeout: 20000 }, async () => {
    const jobId = "pd-https-mixed"
    await runPipelineToEnd(jobId, makeConfig({ transferMode: "https", disks: [{ index: 1, targetStorage: "ISO" }] }))

    expect(prisma.row.status).toBe("completed")
    const commands = sshCommands()
    expect(commands.filter(c => c.startsWith("pvesm alloc "))).toEqual([
      `pvesm alloc 'local-lvm' ${VMID} 'vm-${VMID}-disk-0' ${10 * GIB / 1024} --format raw 2>&1`,
    ])
    expect(commands.some(c => c.includes("curl -sk --fail -b 'vmware_soap_session=abc' 'https://10.42.0.21/folder/web-01/web-01-flat.vmdk?dcPath=ha-datacenter&dsName=ds1'")
      && c.includes(`| dd of="/dev/pve/vm-${VMID}-disk-0"`))).toBe(true)
    // disk 2 is downloaded onto ISO's own images dir, not into the temp base
    const tmp1 = `/var/lib/vz/images/${VMID}/proxcenter-mig-${jobId}-disk1`
    expect(commands.some(c => c.includes(`-o "${tmp1}.vmdk"`) && c.includes("web-01_1-flat.vmdk"))).toBe(true)
    expect(commands.some(c => c.includes(`/tmp/proxcenter-mig-${jobId}-disk1`))).toBe(false)
    // converted to qcow2 (the format of ISO) over the long-timeout SSH session
    expect(ssh2Commands).toEqual([`qemu-img convert -f raw -O qcow2 "${tmp1}.vmdk" "${tmp1}.qcow2" 2>&1 && echo CONVERT_OK`])
    expect(messages()).toContain("[Disk 2/2] Converting to qcow2 format...")
    const adopt = commands.find(c => c.includes("echo ADOPT_OK")) || ""
    expect(adopt).toContain(`mv -n '${tmp1}.qcow2' '/var/lib/vz/images/${VMID}/vm-${VMID}-disk-1.qcow2'`)
    expect(slotValue("scsi0")).toBe(`local-lvm:vm-${VMID}-disk-0`)
    expect(slotValue("scsi1")).toBe(`ISO:${VMID}/vm-${VMID}-disk-1.qcow2,discard=on`)
  })

  it("live: clones both disks on ESXi, streams disk 1 to the block volume and converts disk 2 on ISO after the power-off", { timeout: 20000 }, async () => {
    const jobId = "pd-live-mixed"
    vi.mocked(parseVmConfig).mockReturnValue(makeVm("poweredOn") as any)
    await runPipelineToEnd(jobId, makeConfig({ migrationType: "live", disks: [{ index: 1, targetStorage: "ISO" }] }))

    expect(prisma.row.error).toBeUndefined()
    expect(prisma.row.status).toBe("completed")
    expect(soapCreateSnapshot).toHaveBeenCalledTimes(1)
    expect(soapRemoveAllSnapshots).toHaveBeenCalledTimes(1)
    const commands = sshCommands()
    expect(commands.filter(c => c.includes("vmkfstools -i '/vmfs/volumes/ds1/web-01/web-01.vmdk'"))).toHaveLength(1)
    expect(commands.filter(c => c.includes("vmkfstools -i '/vmfs/volumes/ds1/web-01/web-01_1.vmdk'"))).toHaveLength(1)
    // disk 1: streamed from the clone into the block volume while the source ran
    expect(commands.filter(c => c.startsWith("pvesm alloc "))).toEqual([
      `pvesm alloc 'local-lvm' ${VMID} 'vm-${VMID}-disk-0' ${10 * GIB / 1024} --format raw 2>&1`,
    ])
    expect(commands.some(c => c.includes(`.proxcenter-clone-${jobId}-disk0-flat.vmdk' bs=4M" | dd of="/dev/pve/vm-${VMID}-disk-0"`))).toBe(true)
    // disk 2: downloaded onto ISO, converted and adopted in phase 3
    const tmp1 = `/var/lib/vz/images/${VMID}/proxcenter-mig-${jobId}-disk1`
    expect(commands.some(c => c.includes(`.proxcenter-clone-${jobId}-disk1-flat.vmdk' bs=4M" > "${tmp1}.vmdk"`))).toBe(true)
    expect(ssh2Commands).toEqual([`qemu-img convert -f raw -O qcow2 "${tmp1}.vmdk" "${tmp1}.qcow2" 2>&1 && echo CONVERT_OK`])
    const logs = messages()
    expect(logs).toContain("Attaching pre-streamed volumes to VM...")
    expect(logs).toContain("Converting and importing disks to Proxmox...")
    expect(slotValue("scsi0")).toBe(`local-lvm:vm-${VMID}-disk-0`)
    expect(slotValue("scsi1")).toBe(`ISO:${VMID}/vm-${VMID}-disk-1.qcow2,discard=on`)
    // live mode never verifies (the clone is gone): the converted disk says so,
    // the SSH-dd block stream has no check point at all
    expect(verifyDiskIntegrity).not.toHaveBeenCalled()
    expect(logs.filter(m => m.includes("not available in live mode"))).toHaveLength(1)
  })

  it("copies and attaches only disk 1 when disk 2 is excluded", { timeout: 20000 }, async () => {
    await runPipelineToEnd("pd-exclude", makeConfig({ disks: [{ index: 1, exclude: true }] }))

    expect(prisma.row.status).toBe("completed")
    const logs = messages()
    expect(logs).toContain("Per-disk choices: excluded disk 2")
    // the source still has two disks, the job copies one
    expect(logs.some(m => m.startsWith("VM config:") && m.includes("2 disk(s)"))).toBe(true)
    expect(prisma.row.totalDisks).toBe(1)
    expect(logs.some(m => m.startsWith('Target storage "local-lvm":') && m.endsWith("need 10.0 GB"))).toBe(true)
    expect(logs.some(m => m.includes("[Disk 1/1]"))).toBe(true)
    expect(logs.some(m => m.includes("Hard disk 2"))).toBe(false)
    const commands = sshCommands()
    expect(commands.filter(c => c.startsWith("pvesm alloc "))).toHaveLength(1)
    expect(commands.some(c => c.includes("web-01_1-flat.vmdk"))).toBe(false)
    expect(slotValue("scsi0")).toBe(`local-lvm:vm-${VMID}-disk-0`)
    expect(slotValue("scsi1")).toBeUndefined()
  })

  it("refuses before creating anything when one storage is short, naming that storage", { timeout: 20000 }, async () => {
    // local-lvm has room for its 10 GB; ISO has 21 GB for 20 GB, under the 1.1 margin
    storageAvail = { ISO: 21 * GIB }
    await runPipelineToEnd("pd-space", makeConfig({ disks: [{ index: 1, targetStorage: "ISO" }] }))

    expect(prisma.row.status).toBe("failed")
    expect(prisma.row.error).toBe('Insufficient disk space on "ISO": 21.0 GB free, need 20.0 GB')
    const logs = messages()
    expect(logs.some(m => m.startsWith('Target storage "local-lvm":') && m.endsWith("need 10.0 GB"))).toBe(true)
    expect(logs).toContain('Target storage "ISO": 21.0 GB free, need 20.0 GB')
    // nothing was created or copied
    expect(vi.mocked(pveFetch).mock.calls.some(c => String(c[1]).endsWith("/qemu") && c[2]?.method === "POST")).toBe(false)
    expect(sshCommands().some(c => c.startsWith("pvesm alloc "))).toBe(false)
    expect(destroyPveVm).not.toHaveBeenCalled()
  })

  it("sweeps the temp files of the file-based storage when a later step fails", { timeout: 20000 }, async () => {
    const jobId = "pd-cleanup"
    adoptAnswer = "" // rename refused, import fallback
    importAnswer = { success: false, output: "storage 'ISO' is read-only" }
    await runPipelineToEnd(jobId, makeConfig({ disks: [{ index: 1, targetStorage: "ISO" }] }))

    expect(prisma.row.status).toBe("failed")
    expect(String(prisma.row.error)).toContain("Disk import failed")
    const commands = sshCommands()
    // the import fallback targeted the disk's own storage
    expect(commands.some(c => c.startsWith(`qm disk import ${VMID} '/var/lib/vz/images/${VMID}/proxcenter-mig-${jobId}-disk1.qcow2' 'ISO' --format qcow2`))).toBe(true)
    // and the failure path swept that storage's images dir
    expect(commands).toContain(
      `rm -f "/var/lib/vz/images/${VMID}"/proxcenter-mig-${jobId}-disk*.vmdk "/var/lib/vz/images/${VMID}"/proxcenter-mig-${jobId}-disk*.qcow2 "/var/lib/vz/images/${VMID}"/proxcenter-mig-${jobId}-disk*.raw`,
    )
    expect(destroyPveVm).toHaveBeenCalledTimes(1)
  })
})

describe("runMigrationPipeline without per-disk choices (unchanged behaviour)", () => {
  it("block default: every disk is a raw volume on targetStorage, one storage read, no plan line", { timeout: 20000 }, async () => {
    const jobId = "pd-baseline-block"
    await runPipelineToEnd(jobId, makeConfig())

    expect(prisma.row.status).toBe("completed")
    const logs = messages()
    expect(logs.some(m => m.startsWith("Per-disk choices"))).toBe(false)
    expect(pvePaths().filter(p => /\/storage\/[^/]+\/status$/.test(p))).toEqual(["/nodes/pve1/storage/local-lvm/status"])
    expect(pvePaths().filter(p => p.startsWith("/storage/"))).toEqual(["/storage/local-lvm"])
    expect(logs.some(m => m.startsWith('Target storage "local-lvm":') && m.endsWith("need 30.0 GB"))).toBe(true)
    const commands = sshCommands()
    expect(commands.filter(c => c.startsWith("pvesm alloc "))).toEqual([
      `pvesm alloc 'local-lvm' ${VMID} 'vm-${VMID}-disk-0' ${10 * GIB / 1024} --format raw 2>&1`,
      `pvesm alloc 'local-lvm' ${VMID} 'vm-${VMID}-disk-1' ${20 * GIB / 1024} --format raw 2>&1`,
    ])
    expect(commands.some(c => c.startsWith("mkdir -p \"/var/lib/vz/images/"))).toBe(false)
    expect(logs.some(m => m.startsWith("Temp directory:"))).toBe(false)
    expect(slotValue("scsi0")).toBe(`local-lvm:vm-${VMID}-disk-0`)
    expect(slotValue("scsi1")).toBe(`local-lvm:vm-${VMID}-disk-1`)
  })

  it("file-based default: every disk is converted into one images dir and adopted with discard", { timeout: 20000 }, async () => {
    const jobId = "pd-baseline-file"
    await runPipelineToEnd(jobId, makeConfig({ targetStorage: "ISO" }))

    expect(prisma.row.status).toBe("completed")
    const logs = messages()
    expect(pvePaths().filter(p => /\/storage\/[^/]+\/status$/.test(p))).toEqual(["/nodes/pve1/storage/ISO/status"])
    expect(logs.filter(m => m.startsWith("Temp directory:"))).toEqual([`Temp directory: /var/lib/vz/images/${VMID} (on target storage "ISO")`])
    const commands = sshCommands()
    expect(commands.some(c => c.startsWith("pvesm alloc "))).toBe(false)
    expect(commands.filter(c => c === `mkdir -p "/var/lib/vz/images/${VMID}"`)).toHaveLength(1)
    const dir = `/var/lib/vz/images/${VMID}`
    expect(commands.some(c => c.includes(`-O qcow2 "/tmp/proxcenter-sshfs-${jobId}/web-01/web-01-flat.vmdk" "${dir}/proxcenter-mig-${jobId}-disk0.qcow2"`))).toBe(true)
    expect(commands.some(c => c.includes(`-O qcow2 "/tmp/proxcenter-sshfs-${jobId}/web-01/web-01_1-flat.vmdk" "${dir}/proxcenter-mig-${jobId}-disk1.qcow2"`))).toBe(true)
    expect(logs.filter(m => m === 'Adding disk to storage "ISO"...')).toHaveLength(2)
    expect(slotValue("scsi0")).toBe(`ISO:${VMID}/vm-${VMID}-disk-0.qcow2,discard=on`)
    expect(slotValue("scsi1")).toBe(`ISO:${VMID}/vm-${VMID}-disk-1.qcow2,discard=on`)
  })
})
