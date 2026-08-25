import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

/**
 * Integration test for runV2vMigrationPipeline (#738).
 *
 * Drives the real pipeline end to end with every external dependency mocked:
 * SSH commands are answered by a router keyed on the command shape, virt-v2v
 * runs are scripted through queueV2vRuns(), the PVE API and the DB are fakes.
 * The hyperv + diskPaths source is used on purpose: it needs no credentials,
 * no SMB mount and no SOAP, so the run lands on the conversion phase (where
 * the multi-boot behaviour lives) with a minimal harness.
 *
 * Everything runs under fake timers: the pipeline sleeps 5s per poll and the
 * operator gate polls every 3s, so real timers would cost minutes.
 */

// The root-choice gate timeout is read from the env at module load, so it must
// be set before ./v2v-pipeline is imported. 9s = three 3s gate polls.
vi.hoisted(() => {
  process.env.V2V_ROOT_CHOICE_TIMEOUT_MS = "9000"
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
vi.mock("@/lib/ssh/node-ip", () => ({ getNodeIp: vi.fn() }))
vi.mock("./job-heartbeat", () => ({ startJobHeartbeat: vi.fn() }))
vi.mock("./pve-vm-config", () => ({ pveSetVmConfig: vi.fn(), destroyPveVm: vi.fn() }))
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }))

import { executeSSH } from "@/lib/ssh/exec"
import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { getTenantPrisma } from "@/lib/tenant"
import { getNodeIp } from "@/lib/ssh/node-ip"
import { startJobHeartbeat } from "./job-heartbeat"
import { pveSetVmConfig, destroyPveVm } from "./pve-vm-config"
import { audit } from "@/lib/audit"
import {
  runV2vMigrationPipeline,
  requestV2vRootChoice,
  V2V_AWAITING_ROOT_CHOICE_STEP,
  type V2vMigrationConfig,
} from "./v2v-pipeline"

// ── virt-v2v output fixtures ──
// Real capture from discussion #738 (typographic quotes included): one real
// root plus snapper snapshot subvolumes of the same system.
const MULTIBOOT_PROMPT_SNAPPER = `[   3.8] Inspecting the source

***
Dual- or multi-boot operating system detected.  Choose the root filesystem
that contains the main operating system from the list below:

 [1] /dev/sda (13.3)
 [2] btrfsvol:/dev/sda/.snapshots/1/snapshot (13.3)
 [3] btrfsvol:/dev/sda/.snapshots/2/snapshot (13.3)

Enter a number between 1 and 3, or ‘exit’: { "message": "exception: End_of_file", "type": "error" }
virt-v2v: error: exception: End_of_file
`

// Same prompt with a second real root: a genuine dual boot, nothing to pick
// automatically.
const MULTIBOOT_PROMPT_DUAL = `[   3.8] Inspecting the source

***
Dual- or multi-boot operating system detected.  Choose the root filesystem
that contains the main operating system from the list below:

 [1] /dev/sda (13.3)
 [2] btrfsvol:/dev/sda/.snapshots/1/snapshot (13.3)
 [3] btrfsvol:/dev/sda/.snapshots/2/snapshot (13.3)
 [4] /dev/sdb1 (Debian GNU/Linux 12)

Enter a number between 1 and 4, or ‘exit’: { "message": "exception: End_of_file", "type": "error" }
virt-v2v: error: exception: End_of_file
`

const SUCCESS_LOG = `[   0.0] Setting up the source: -i disk /mnt/hyperv/vm.vhdx
[   1.5] Opening the source
[   3.8] Inspecting the source
[  12.9] Converting Ubuntu 22.04 to run on KVM
[ 136.0] Copying disk 1/1
[ 400.9] Creating output metadata
[ 401.0] Finishing off
`

// A failure that has nothing to do with root selection.
const PLAIN_FAILURE_LOG = `[   3.8] Inspecting the source
virt-v2v: error: inspection could not detect the source guest (or physical machine).
`

// ── SSH command router ──

interface ScriptedRun {
  exit: number
  log: string
}

const PVE_CONN = { id: "conn-target", baseUrl: "https://pve.example:8006", apiToken: "root@pam!t=x", insecureDev: true }

let scriptedRuns: ScriptedRun[]
let currentRun: ScriptedRun | null
/** Inner virt-v2v commands, un-escaped, in launch order. */
let v2vLaunches: string[]
/** What Phase 6 "ls -1 <outputDir>" reports as converted disk files. */
let diskListing: string
/**
 * Output of the adoption attempt (#292: `mkdir -p images/<vmid> && stat && mv -n
 * && echo ADOPT_OK`). Empty = rename refused, so the pipeline falls back to
 * `qm disk import`, which is what every pre-#292 test exercised.
 */
let adoptAnswer: string

function queueV2vRuns(runs: ScriptedRun[]) {
  scriptedRuns.push(...runs)
}

function ok(output = "") {
  return { success: true as const, output }
}

/** Reverse shellEscape's single-quote wrapping (one level). */
function unescapeSingleQuoted(s: string): string {
  const t = s.trim()
  if (!t.startsWith("'") || !t.endsWith("'")) return t
  return t.slice(1, -1).replaceAll("'\\''", "'")
}

async function sshRouter(_connId: string, _host: string, command: string) {
  if (command.startsWith("nohup bash -c ")) {
    const tail = " > /dev/null 2>&1 & echo $!"
    const inner = unescapeSingleQuoted(command.slice("nohup bash -c ".length, command.lastIndexOf(tail)))
    v2vLaunches.push(inner)
    currentRun = scriptedRuns.shift() ?? { exit: 0, log: "" }
    return ok("4242") // fake pid
  }
  if (command.startsWith("which ")) return ok("/usr/bin/virt-v2v")
  if (command.startsWith("virt-v2v --help")) return ok("yes") // --block-driver probe
  if (command.startsWith("cat ") && command.includes("/v2v.exit")) return ok(String(currentRun?.exit ?? 0))
  if ((command.startsWith("tail -c 4000 ") || command.startsWith("cat ")) && command.includes("/v2v.log")) {
    return ok(currentRun?.log ?? "")
  }
  if (command.startsWith("cat ") && command.includes("*.xml")) return ok("") // no domain XML: fallback VM config
  if (command.startsWith("ls -1 ")) return ok(diskListing)
  if (command.startsWith("mkdir -p ") && command.includes("echo ADOPT_OK")) {
    return ok(adoptAnswer)
  }
  if (command.startsWith("qm disk import ")) {
    return ok("Successfully imported disk as 'unused0:local:120/vm-120-disk-0.qcow2'")
  }
  if (command.startsWith("du -sb ")) return ok("1073741824")
  // mkdir -p, rm -f, rm -rf, find ... -delete, kill, umount: plain success
  return ok("")
}

async function pveRouter(_conn: unknown, path: string, init?: { method?: string }) {
  if (path === "/cluster/nextid") return "120"
  // VM create accepted; falsy return skips the task-status polling
  if (path.endsWith("/qemu") && init?.method === "POST") return ""
  if (path.startsWith("/storage/")) return { type: "dir" }
  // Node-level storage status: the direct-write gate (#292) requires the
  // storage to be positively active before staging the conversion on it.
  if (/^\/nodes\/[^/]+\/storage\/[^/]+\/status$/.test(path)) return { active: 1 }
  return {}
}

// ── Job row fake ──

function makeFakePrisma() {
  const row: Record<string, any> = { config: {}, logs: [] as any[], progress: 0 }
  const stepHistory: string[] = []
  const update = vi.fn(async ({ data }: any) => {
    if (data.currentStep !== undefined) stepHistory.push(data.currentStep)
    Object.assign(row, data)
    return row
  })
  return {
    row,
    stepHistory,
    migrationJob: {
      findUnique: vi.fn(async () => ({ ...row })),
      update,
    },
    connection: {
      // No apiTokenEnc: the hyperv SMB auto-mount phase is skipped entirely.
      findUnique: vi.fn(async () => ({ baseUrl: "https://hyperv.local", apiTokenEnc: null, hypervShareName: null })),
    },
  }
}

let prisma: ReturnType<typeof makeFakePrisma>

const messages = () => (prisma.row.logs as Array<{ msg: string }>).map(l => l.msg)

function makeConfig(overrides: Partial<V2vMigrationConfig> = {}): V2vMigrationConfig {
  return {
    sourceConnectionId: "conn-src",
    sourceVmId: "vm-1",
    sourceVmName: "testvm",
    sourceType: "hyperv",
    targetConnectionId: "conn-target",
    targetNode: "pve1",
    targetStorage: "local",
    networkBridge: "vmbr0",
    startAfterMigration: false,
    diskPaths: ["/mnt/hyperv/vm.vhdx"],
    ...overrides,
  }
}

/** Run the pipeline to completion under fake timers (the poll loops sleep 3-5s). */
async function runPipelineToEnd(jobId: string, config: V2vMigrationConfig): Promise<void> {
  let settled = false
  const run = runV2vMigrationPipeline(jobId, config, "tenant-test").finally(() => {
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
  scriptedRuns = []
  currentRun = null
  v2vLaunches = []
  diskListing = "testvm-sda\n"
  adoptAnswer = ""
  prisma = makeFakePrisma()
  vi.mocked(getTenantPrisma).mockImplementation(() => prisma as any)
  vi.mocked(getConnectionById).mockResolvedValue(PVE_CONN as any)
  vi.mocked(getNodeIp).mockResolvedValue("10.0.0.1")
  vi.mocked(startJobHeartbeat).mockReturnValue(() => {})
  vi.mocked(pveSetVmConfig).mockResolvedValue(undefined as any)
  vi.mocked(destroyPveVm).mockResolvedValue(undefined as any)
  vi.mocked(audit).mockResolvedValue("audit-1" as any)
  vi.mocked(executeSSH).mockImplementation(sshRouter as any)
  vi.mocked(pveFetch).mockImplementation(pveRouter as any)
})

afterEach(() => {
  vi.useRealTimers()
})

describe("runV2vMigrationPipeline multi-boot recovery (#738)", () => {
  it("retries once with the only real root when the others are snapper snapshots", { timeout: 15000 }, async () => {
    queueV2vRuns([
      { exit: 1, log: MULTIBOOT_PROMPT_SNAPPER },
      { exit: 0, log: SUCCESS_LOG },
    ])

    await runPipelineToEnd("v2v-it-auto", makeConfig())

    expect(v2vLaunches).toHaveLength(2)
    expect(v2vLaunches[0]).not.toContain("--root")
    expect(v2vLaunches[1]).toContain("--root '/dev/sda'")
    const logs = messages()
    expect(logs.some(m => m.includes("Guest inspection found 3 candidate(s)"))).toBe(true)
    expect(logs.some(m => m.includes("[1] /dev/sda (13.3)"))).toBe(true)
    expect(logs.some(m => m.includes("Selecting /dev/sda"))).toBe(true)
    // and the pipeline went on past the conversion, all the way to the end
    expect(logs.some(m => m.includes("virt-v2v conversion completed"))).toBe(true)
    expect(prisma.row.status).toBe("completed")
    expect(destroyPveVm).not.toHaveBeenCalled()
  })

  it("parks the job for the operator when two real roots remain, then resumes with the pick", { timeout: 15000 }, async () => {
    const jobId = "v2v-it-gate"
    queueV2vRuns([
      { exit: 1, log: MULTIBOOT_PROMPT_DUAL },
      { exit: 0, log: SUCCESS_LOG },
    ])
    // Operator double: watches the row from a (fake) timer and answers as soon
    // as the job parks. Answering earlier would be wiped by the gate's entry
    // purge, exactly like a stale pick from a previous gate.
    const answer = setInterval(() => {
      if (prisma.row.currentStep === V2V_AWAITING_ROOT_CHOICE_STEP) {
        clearInterval(answer)
        requestV2vRootChoice(jobId, "/dev/sdb1")
      }
    }, 200)

    try {
      await runPipelineToEnd(jobId, makeConfig())
    } finally {
      clearInterval(answer)
    }

    expect(prisma.stepHistory).toContain(V2V_AWAITING_ROOT_CHOICE_STEP)
    // Only the two real roots are offered, the snapshot subvolumes are not.
    expect(prisma.row.config.v2vRootCandidates).toEqual([
      { device: "/dev/sda", description: "13.3" },
      { device: "/dev/sdb1", description: "Debian GNU/Linux 12" },
    ])
    expect(v2vLaunches).toHaveLength(2)
    expect(v2vLaunches[1]).toContain("--root '/dev/sdb1'")
    expect(messages().some(m => m.includes("Operator chose /dev/sdb1"))).toBe(true)
    expect(prisma.row.status).toBe("completed")
  })

  it("fails with the candidate hint when nobody picks before the gate expires", { timeout: 15000 }, async () => {
    queueV2vRuns([{ exit: 1, log: MULTIBOOT_PROMPT_DUAL }])

    await runPipelineToEnd("v2v-it-expiry", makeConfig())

    expect(prisma.row.status).toBe("failed")
    expect(String(prisma.row.error)).toContain("Root filesystem (advanced)")
    expect(String(prisma.row.error)).toContain("/dev/sda")
    expect(String(prisma.row.error)).toContain("/dev/sdb1")
    expect(v2vLaunches).toHaveLength(1) // no pick, no retry
    expect(destroyPveVm).not.toHaveBeenCalled()
  })

  it("puts a pinned config.v2vRoot on the first command and never enters the gate", { timeout: 15000 }, async () => {
    queueV2vRuns([{ exit: 0, log: SUCCESS_LOG }])

    await runPipelineToEnd("v2v-it-pinned", makeConfig({ v2vRoot: "/dev/sda1" }))

    expect(v2vLaunches).toHaveLength(1)
    expect(v2vLaunches[0]).toContain("--root '/dev/sda1'")
    expect(prisma.stepHistory).not.toContain(V2V_AWAITING_ROOT_CHOICE_STEP)
    expect(prisma.row.status).toBe("completed")
  })

  it("rejects an unsafe config.v2vRoot before any virt-v2v launch", { timeout: 15000 }, async () => {
    await runPipelineToEnd("v2v-it-badroot", makeConfig({ v2vRoot: "/dev/sda1; reboot" }))

    expect(prisma.row.status).toBe("failed")
    expect(String(prisma.row.error)).toContain('Invalid root filesystem "/dev/sda1; reboot"')
    expect(v2vLaunches).toHaveLength(0)
    expect(destroyPveVm).not.toHaveBeenCalled()
  })
})

describe("runV2vMigrationPipeline cleanup guard (#738)", () => {
  it("does not destroy anything when the conversion fails before the VM exists", { timeout: 15000 }, async () => {
    queueV2vRuns([{ exit: 1, log: PLAIN_FAILURE_LOG }])

    await runPipelineToEnd("v2v-it-novm", makeConfig())

    expect(prisma.row.status).toBe("failed")
    // The VMID was only a reservation: nothing to destroy, nothing to advise.
    expect(destroyPveVm).not.toHaveBeenCalled()
    expect(messages().some(m => m.includes("qm destroy"))).toBe(false)
  })

  it("destroys the created VM when a step after the create fails", { timeout: 15000 }, async () => {
    queueV2vRuns([{ exit: 0, log: SUCCESS_LOG }])
    diskListing = "" // Phase 6 finds no converted disks and throws, after the create

    await runPipelineToEnd("v2v-it-partial", makeConfig())

    expect(prisma.row.status).toBe("failed")
    expect(String(prisma.row.error)).toContain("produced no disk files")
    expect(destroyPveVm).toHaveBeenCalledTimes(1)
    expect(destroyPveVm).toHaveBeenCalledWith(expect.objectContaining({ id: "conn-target" }), "pve1", 120)
    expect(messages().some(m => m.includes("Cleaned up partial VM 120"))).toBe(true)
  })
})

describe("runV2vMigrationPipeline direct storage write (#292)", () => {
  const sshCommands = () => vi.mocked(executeSSH).mock.calls.map(c => String(c[2]))

  it("converts onto the storage and adopts the disk by rename, no qm disk import", { timeout: 15000 }, async () => {
    queueV2vRuns([{ exit: 0, log: SUCCESS_LOG }])
    adoptAnswer = "ADOPT_OK"
    // A dir/NFS storage's path is arbitrary and comes from the storage config.
    vi.mocked(pveFetch).mockImplementation((async (conn: unknown, path: string, init?: { method?: string }) => {
      if (path.startsWith("/storage/")) return { type: "nfs", path: "/mnt/pve/nfs-vmstore" }
      return pveRouter(conn, path, init)
    }) as any)

    await runPipelineToEnd("v2v-it-adopt", makeConfig())

    expect(prisma.row.status).toBe("completed")
    // virt-v2v was pointed at the staging dir ON the storage and asked for qcow2
    expect(v2vLaunches).toHaveLength(1)
    expect(v2vLaunches[0]).toContain("-of qcow2")
    expect(v2vLaunches[0]).toContain("-os '/mnt/pve/nfs-vmstore/proxcenter-v2v/v2v-it-adopt'")
    // the whole point: the disk is never copied a second time
    const commands = sshCommands()
    expect(commands.some(c => c.startsWith("qm disk import "))).toBe(false)
    // the rename targeted the storage's own images/<vmid> directory
    const adoptCmd = commands.find(c => c.includes("echo ADOPT_OK")) || ""
    expect(adoptCmd).toContain("mkdir -p '/mnt/pve/nfs-vmstore/images/120'")
    expect(adoptCmd).toContain(
      "mv -n '/mnt/pve/nfs-vmstore/proxcenter-v2v/v2v-it-adopt/testvm-sda' '/mnt/pve/nfs-vmstore/images/120/vm-120-disk-0.qcow2'",
    )
    // the adopted volume is what got attached
    const attach = vi.mocked(pveSetVmConfig).mock.calls.find(c => c[3].has("scsi0"))
    expect(attach?.[3].get("scsi0")).toBe("local:120/vm-120-disk-0.qcow2,discard=on")
    // both the staging dir on the storage AND the temp dir are cleaned up
    expect(commands).toContain("rm -rf '/mnt/pve/nfs-vmstore/proxcenter-v2v/v2v-it-adopt'")
    expect(commands).toContain("rm -rf '/tmp/v2v-v2v-it-adopt'")
  })

  it("falls back to qm disk import when the rename is refused, and still completes", { timeout: 15000 }, async () => {
    queueV2vRuns([{ exit: 0, log: SUCCESS_LOG }])
    // adoptAnswer stays "": the rename is refused, as on a cross-filesystem move

    await runPipelineToEnd("v2v-it-fallback", makeConfig())

    expect(prisma.row.status).toBe("completed")
    // direct-write mode was still on (dir storage, path fallback /var/lib/vz)
    expect(v2vLaunches[0]).toContain("-of qcow2")
    expect(v2vLaunches[0]).toContain("-os '/var/lib/vz/proxcenter-v2v/v2v-it-fallback'")
    // the fallback is the converting import, fed with the staged qcow2
    const importCmd = sshCommands().find(c => c.startsWith("qm disk import ")) || ""
    expect(importCmd).toContain(
      "qm disk import 120 '/var/lib/vz/proxcenter-v2v/v2v-it-fallback/testvm-sda' 'local' --format qcow2",
    )
    expect(messages().some(m => m.includes("falling back to qm disk import"))).toBe(true)
    const attach = vi.mocked(pveSetVmConfig).mock.calls.find(c => c[3].has("scsi0"))
    expect(attach?.[3].get("scsi0")).toBe("local:120/vm-120-disk-0.qcow2,discard=on")
  })

  it("keeps the legacy temp staging when the storage is not reported active", { timeout: 15000 }, async () => {
    queueV2vRuns([{ exit: 0, log: SUCCESS_LOG }])
    // dead NFS mount: writing "onto the storage" would land under the mountpoint
    vi.mocked(pveFetch).mockImplementation((async (conn: unknown, path: string, init?: { method?: string }) => {
      if (/\/storage\/.+\/status$/.test(path)) return { active: 0 }
      return pveRouter(conn, path, init)
    }) as any)

    await runPipelineToEnd("v2v-it-inactive", makeConfig())

    expect(prisma.row.status).toBe("completed")
    // no direct write: raw conversion into the temp dir, byte-for-byte legacy
    expect(v2vLaunches[0]).not.toContain("-of qcow2")
    expect(v2vLaunches[0]).toContain("-os '/tmp/v2v-v2v-it-inactive'")
    // and the disk reaches the storage through the converting import
    const importCmd = sshCommands().find(c => c.startsWith("qm disk import ")) || ""
    expect(importCmd).toContain("qm disk import 120 '/tmp/v2v-v2v-it-inactive/testvm-sda' 'local' --format qcow2")
  })
})
