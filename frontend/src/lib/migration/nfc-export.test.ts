import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

/**
 * The NFC export phase of the cold vCenter path (#807), driven end to end with
 * SSH and SOAP faked: curl launches are recorded, each fake download advances
 * one step per poll, and the stream probe answers from the same fake state.
 * Fake timers stand in for the 5 s poll sleeps.
 */

vi.mock("@/lib/ssh/exec", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/ssh/exec")>()
  return { ...actual, executeSSH: vi.fn() } // keep the real shellEscape
})
vi.mock("@/lib/vmware/soap", () => ({
  soapExportVm: vi.fn(),
  soapExportSnapshot: vi.fn(),
  soapWaitForNfcLease: vi.fn(),
  soapNfcLeaseProgress: vi.fn(),
  soapNfcLeaseComplete: vi.fn(),
  soapNfcLeaseAbort: vi.fn(),
}))

import { executeSSH } from "@/lib/ssh/exec"
import {
  soapExportVm,
  soapExportSnapshot,
  soapWaitForNfcLease,
  soapNfcLeaseProgress,
  soapNfcLeaseComplete,
  soapNfcLeaseAbort,
} from "@/lib/vmware/soap"
import type { EsxiVmConfig, SoapSession } from "@/lib/vmware/soap"
import { runVcenterNfcExport, type NfcJobIo } from "./nfc-export"

const GiB = 1073741824
const OUT = "/tmp/v2v-job1"
const SESSION: SoapSession = { baseUrl: "https://vc.example", cookie: 'vmware_soap_session="abc"', insecureTLS: true } as SoapSession

/** One step of a fake download, applied at each poll of that disk. */
interface Step { size: number; position: number; exit?: number; eos?: boolean }

interface FakeDownload {
  pid: string
  steps: Step[]
  size: number
  position: number
  exit: number | null
  eos: boolean
  killed: boolean
}

let downloads: Map<string, FakeDownload>
let plans: Map<string, Step[]>
let capacities: Map<string, number>
let probeMode: "ok" | "fail"
let running: number
let peakRunning: number
let removed: string[]
let launchOrder: string[]

function ok(output = "") {
  return { success: true as const, output }
}

/** Reverse shellEscape's single-quote wrapping (one level). */
function unq(s: string): string {
  const t = s.trim()
  if (!t.startsWith("'") || !t.endsWith("'")) return t
  return t.slice(1, -1).replaceAll("'\\''", "'")
}

/** Default plan: two polls of progress, then a clean exit at full capacity. */
function defaultPlan(capacity: number): Step[] {
  return [
    { size: Math.round(capacity * 0.1), position: Math.round(capacity * 0.5) },
    { size: Math.round(capacity * 0.2), position: capacity, exit: 0, eos: true },
  ]
}

function byCtrl(path: string): FakeDownload | undefined {
  return downloads.get(path.replace(/\.ctrl\.(pid|exit|err|stats|curlcfg)$/, ""))
}

async function sshRouter(_connId: string, _host: string, command: string) {
  if (command.startsWith("nohup bash -c ")) {
    const cfg = unq(/curl -K ('[^']*(?:'\\''[^']*)*')/.exec(command)![1])
    const localPath = cfg.replace(/\.ctrl\.curlcfg$/, "")
    const capacity = capacities.get(localPath) ?? 100 * GiB
    const pid = `pid-${downloads.size + 1}`
    downloads.set(localPath, {
      pid, steps: [...(plans.get(localPath) ?? defaultPlan(capacity))],
      size: 0, position: 0, exit: null, eos: false, killed: false,
    })
    launchOrder.push(localPath)
    running++
    peakRunning = Math.max(peakRunning, running)
    return ok(pid)
  }
  if (command.startsWith("cat ") && command.includes(".ctrl.exit")) {
    const d = byCtrl(unq(command.slice(4).split(" 2>")[0]))!
    if (d.exit === null && !d.killed) {
      const step = d.steps.shift()
      if (step) {
        d.size = step.size
        d.position = step.position
        if (step.exit !== undefined) {
          d.exit = step.exit
          d.eos = step.eos ?? false
          running--
        }
      }
    }
    return ok(d.exit === null ? "RUNNING" : String(d.exit))
  }
  if (command.startsWith("perl ")) {
    if (probeMode === "fail") return ok("PROBE_FAILED")
    const file = unq(command.split(" ")[2])
    const d = downloads.get(file)!
    const capacity = capacities.get(file) ?? 100 * GiB
    return ok(`size=${d.size} pos=${d.size} position=${d.position} capacity=${capacity} eos=${d.eos ? 1 : 0}`)
  }
  if (command.startsWith("stat -c '%s' ")) {
    const d = downloads.get(unq(command.slice("stat -c '%s' ".length).split(" 2>")[0]))
    return ok(String(d?.size ?? 0))
  }
  if (command.startsWith("head -c 4 ")) return ok("KDMV")
  if (command.startsWith("tail -c 1000 ")) return ok("")
  if (command.startsWith("cat ") && command.includes(".ctrl.stats")) return ok("http_code=200\nsize_download=1")
  if (command.startsWith("pkill ") || command.startsWith("kill ")) {
    // curl runs under a `bash -c` wrapper whose pid is what nohup echoed: a
    // kill of the wrapper alone leaves curl streaming (and the lease alive).
    // The fake only counts a download as stopped when its children are killed.
    const m = /^pkill -TERM -P (\S+) 2>\/dev\/null; kill \1 2>\/dev\/null/.exec(command)
    if (m) {
      for (const d of downloads.values()) {
        if (d.pid === m[1] && !d.killed && d.exit === null) {
          d.killed = true
          running--
        }
      }
    }
    for (const q of command.matchAll(/'([^']+)'/g)) removed.push(q[1])
    return ok("")
  }
  if (command.startsWith("rm -f ")) {
    for (const m of command.matchAll(/'([^']+)'/g)) removed.push(m[1])
    return ok("")
  }
  // mkdir -p, printf of the curl config and of the probe script, echo pid: plain success
  return ok("")
}

function makeIo() {
  const logs: Array<{ msg: string; level: string }> = []
  const updates: Array<Record<string, unknown>> = []
  let cancelled = false
  const io: NfcJobIo = {
    appendLog: vi.fn(async (_jobId, msg, level = "info") => { logs.push({ msg, level }) }),
    updateJob: vi.fn(async (_jobId, _status, extra) => { updates.push(extra) }),
    isCancelled: vi.fn(() => cancelled),
  }
  return { io, logs, updates, cancel: () => { cancelled = true } }
}

function vmConfig(capacityList: number[]): EsxiVmConfig {
  return {
    disks: capacityList.map((c, i) => ({ label: `Hard disk ${i + 1}`, fileName: `[ds] vm/disk${i}.vmdk`, capacityBytes: c, thinProvisioned: true, datastoreName: "ds", relativePath: `vm/disk${i}.vmdk` })),
  } as unknown as EsxiVmConfig
}

function setupDisks(capacityList: number[]) {
  capacityList.forEach((c, i) => capacities.set(`${OUT}/disk-${i}.vmdk`, c))
  vi.mocked(soapWaitForNfcLease).mockResolvedValue(
    capacityList.map((_c, i) => ({ key: `d${i}`, url: `https://vc.example/nfc/disk-${i}.vmdk`, fileSize: 0, disk: true, targetId: `disk-${i}.vmdk` })),
  )
  return vmConfig(capacityList)
}

async function runToEnd<T>(p: Promise<T>): Promise<T> {
  let settled = false
  const guarded = p.finally(() => { settled = true })
  // Attach a handler now: a rejection landing mid-loop must not surface as unhandled.
  guarded.catch(() => {})
  for (let i = 0; i < 400 && !settled; i++) await vi.advanceTimersByTimeAsync(1000)
  if (!settled) throw new Error("export did not settle within the fake-time budget")
  return guarded
}

function exportWith(io: NfcJobIo, config: EsxiVmConfig | null, concurrency: number) {
  return runVcenterNfcExport({
    jobId: "job1",
    targetConnectionId: "conn-target",
    sourceVmId: "vm-1",
    nodeIp: "10.0.0.1",
    session: SESSION,
    outputDir: OUT,
    sourceVmwareConfig: config,
    snapshotMor: null,
    band: { offset: 0, scale: 50 },
    concurrency,
  }, io)
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  downloads = new Map()
  plans = new Map()
  capacities = new Map()
  probeMode = "ok"
  running = 0
  peakRunning = 0
  removed = []
  launchOrder = []
  let leases = 0
  vi.mocked(executeSSH).mockImplementation(sshRouter as any)
  vi.mocked(soapExportVm).mockImplementation(async () => `lease-${++leases}`)
  vi.mocked(soapExportSnapshot).mockImplementation(async () => `snap-lease-${++leases}`)
  vi.mocked(soapNfcLeaseProgress).mockResolvedValue(undefined)
  vi.mocked(soapNfcLeaseComplete).mockResolvedValue(undefined)
  vi.mocked(soapNfcLeaseAbort).mockResolvedValue(undefined)
})

afterEach(() => {
  vi.useRealTimers()
})

describe("runVcenterNfcExport", () => {
  it("downloads the disks in parallel up to the concurrency limit, one fresh lease each", async () => {
    const { io, logs } = makeIo()
    const config = setupDisks([100 * GiB, 100 * GiB, 100 * GiB])

    const paths = await runToEnd(exportWith(io, config, 2))

    expect(paths).toEqual([`${OUT}/disk-0.vmdk`, `${OUT}/disk-1.vmdk`, `${OUT}/disk-2.vmdk`])
    expect(peakRunning).toBe(2)
    expect(launchOrder.slice(0, 2)).toEqual([`${OUT}/disk-0.vmdk`, `${OUT}/disk-1.vmdk`])
    // one probe lease to count the disks, then one lease per disk, all completed
    expect(soapExportVm).toHaveBeenCalledTimes(4)
    expect(soapNfcLeaseComplete).toHaveBeenCalledTimes(4)
    expect(soapNfcLeaseAbort).not.toHaveBeenCalled()
    expect(logs.some(l => l.msg.includes("up to 2 at a time"))).toBe(true)
  })

  it("stays sequential when the concurrency is 1", async () => {
    const { io } = makeIo()
    const config = setupDisks([10 * GiB, 10 * GiB])
    await runToEnd(exportWith(io, config, 1))
    expect(peakRunning).toBe(1)
  })

  it("reports progress from the position inside the disk, not from the bytes on the wire", async () => {
    const { io, logs, updates } = makeIo()
    const config = setupDisks([100 * GiB])

    await runToEnd(exportWith(io, config, 2))

    // First poll: 10 GiB on the wire, half of the disk streamed -> 50 % of the disk, 25 % of the 0..50 band.
    const halfway = updates.find(u => u.progress === 25)
    expect(halfway).toBeDefined()
    expect(halfway!.bytesTransferred).toBe(BigInt(50 * GiB))
    expect(halfway!.totalBytes).toBe(BigInt(100 * GiB))
    expect(logs.some(l => l.msg.includes("[NFC disk 1/1] 50% (50.0 GB of 100.0 GB, 10.0 GB on the wire"))).toBe(true)
    // Done: the band is full and the completion line shows both units.
    expect(updates.at(-1)!.progress).toBe(50)
    expect(logs.some(l => l.level === "success" && l.msg.includes("20.0 GB on the wire for a 100.0 GB disk"))).toBe(true)
    expect(logs.some(l => l.msg.includes("until the stream header confirms the size"))).toBe(true)
    // No more "expected ~X GB" warning on a healthy thin disk.
    expect(logs.some(l => l.level === "warn")).toBe(false)
  })

  it("takes the capacity from the stream header when vCenter gave no size at all", async () => {
    const { io, updates } = makeIo()
    setupDisks([100 * GiB])
    await runToEnd(exportWith(io, null, 1))
    expect(updates.some(u => u.progress === 25 && u.totalBytes === BigInt(100 * GiB))).toBe(true)
  })

  it("kills the running downloads, aborts the leases and removes every file when one disk fails", async () => {
    const { io } = makeIo()
    const config = setupDisks([100 * GiB, 100 * GiB])
    plans.set(`${OUT}/disk-1.vmdk`, [{ size: 1024, position: 0, exit: 22 }])
    // disk-0 would need several polls: it must be interrupted, not finished.
    plans.set(`${OUT}/disk-0.vmdk`, Array.from({ length: 30 }, (_, n) => ({ size: n * GiB, position: n * 2 * GiB })))

    await expect(runToEnd(exportWith(io, config, 2))).rejects.toThrow(/curl exit 22/)

    const disk0 = downloads.get(`${OUT}/disk-0.vmdk`)!
    expect(disk0.killed).toBe(true)
    expect(removed).toContain(`${OUT}/disk-0.vmdk`)
    expect(removed).toContain(`${OUT}/disk-1.vmdk`)
    expect(soapNfcLeaseAbort).toHaveBeenCalled()
    expect(running).toBe(0)
  })

  it("stops every download when the job is cancelled", async () => {
    const { io, cancel } = makeIo()
    const config = setupDisks([100 * GiB, 100 * GiB])
    for (const i of [0, 1]) {
      plans.set(`${OUT}/disk-${i}.vmdk`, Array.from({ length: 30 }, (_, n) => ({ size: n * GiB, position: n * 2 * GiB })))
    }
    const run = exportWith(io, config, 2)
    await vi.advanceTimersByTimeAsync(7000)
    cancel()

    await expect(runToEnd(run)).rejects.toThrow("Migration cancelled")
    expect([...downloads.values()].every(d => d.killed)).toBe(true)
    expect(running).toBe(0)
  })

  it("falls back to bytes on the wire when the probe cannot run, and says so once", async () => {
    const { io, logs, updates } = makeIo()
    const config = setupDisks([100 * GiB])
    probeMode = "fail"
    plans.set(`${OUT}/disk-0.vmdk`, [
      { size: 30 * GiB, position: 0 },
      { size: 40 * GiB, position: 0 },
      { size: 45 * GiB, position: 0, exit: 0 },
    ])

    await runToEnd(exportWith(io, config, 1))

    // 30 GiB on the wire out of a 100 GiB disk: 30 % of the disk, 15 % of the band.
    expect(updates.some(u => u.progress === 15)).toBe(true)
    expect(logs.filter(l => l.level === "warn" && l.msg.includes("probe")).length).toBe(1)
  })

  it("warns when curl finished but the stream has no end-of-stream marker", async () => {
    const { io, logs } = makeIo()
    const config = setupDisks([100 * GiB])
    plans.set(`${OUT}/disk-0.vmdk`, [{ size: 5 * GiB, position: 60 * GiB, exit: 0, eos: false }])

    const paths = await runToEnd(exportWith(io, config, 1))

    expect(paths).toHaveLength(1)
    expect(logs.some(l => l.level === "warn" && l.msg.includes("end-of-stream"))).toBe(true)
  })

  it("shows an empty thin disk in megabytes rather than as 0.0 GB", async () => {
    const { io, logs } = makeIo()
    const config = setupDisks([8 * GiB])
    plans.set(`${OUT}/disk-0.vmdk`, [{ size: 68608, position: 8 * GiB, exit: 0, eos: true }])

    await runToEnd(exportWith(io, config, 1))

    expect(logs.some(l => l.level === "success" && l.msg.includes("Download complete") && l.msg.includes("0.1 MB on the wire for a 8.0 GB disk"))).toBe(true)
  })

  it("exports from the snapshot when a snapshot MOR is given", async () => {
    const { io } = makeIo()
    const config = setupDisks([10 * GiB])
    await runToEnd(runVcenterNfcExport({
      jobId: "job1", targetConnectionId: "conn-target", sourceVmId: "vm-1", nodeIp: "10.0.0.1",
      session: SESSION, outputDir: OUT, sourceVmwareConfig: config, snapshotMor: "snapshot-9",
      band: { offset: 0, scale: 50 }, concurrency: 1,
    }, io))
    expect(soapExportSnapshot).toHaveBeenCalledWith(SESSION, "snapshot-9")
    expect(soapExportVm).not.toHaveBeenCalled()
  })
})
