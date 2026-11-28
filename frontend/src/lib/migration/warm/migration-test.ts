/**
 * Test of a waiting warm migration: a throwaway VM booted on the replicated
 * copy while the migration waits for its manual cutover.
 *
 * Nothing of the migration is touched. Each replicated volume gets a qcow2
 * overlay on a file storage the operator picks (`vm-<testvmid>-test-<i>.qcow2`,
 * backing file = the volume); QEMU opens the volume read-only behind it and
 * every write of the test lands in the overlay (lab 14/11: the cutover after a
 * test passed its integrity check). The syncs are paused for the whole test:
 * the pipeline runs this from the sleep between two passes (hold-wait), and a
 * pass follows it at once to catch up.
 *
 * The guest gets the cutover's conversion on the overlays (convertGuestForTest)
 * and boots the hardware the cutover would give it, so the test rehearses the
 * cutover. Windows was copied while running: its NTFS is repaired on the
 * overlays first, or virt-v2v refuses it.
 *
 * Why not /tmp: on PVE 9 it is a tmpfs, the overlays would live in RAM.
 *
 * Load on PVE: four protected calls per test (create, start, stop, destroy)
 * and three reads before it starts; the overlays are watched over SSH, which
 * takes no pvedaemon worker.
 *
 * The test VM is removed whatever ends the test: the operator, its time limit,
 * a storage running out of space, a cutover, a cancellation or an error. A
 * server that dies meanwhile leaves its id on the job row (`testState`), where
 * the orphan cleanup finds it.
 */
import { pveFetch } from "@/lib/proxmox/client"
import { decideUnreferencedDiskPurge } from "@/lib/proxmox/unreferencedDisks"
import { executeSSH, shellEscape } from "@/lib/ssh/exec"
import type { SshTarget } from "@/lib/ssh/node-endpoint-core"

import type { PveVmCreateParams } from "../configMapper"
import { waitForPveTask } from "../pve-tasks"
import { reserveTargetVmid } from "../reserve-target-vmid"
import { buildOverlayScript, convertGuestForTest, type GuestConversionInput } from "./guest-conversion"
import { appendLog, clearWarmTest, isCancelled, isCutoverRequested, isTestStopRequested, readJobTestRequest, updateJobTestFields } from "./job-control"
import { parseTestRequest, type MigrationTestState } from "./migration-test-state"

export const TEST_VM_TAG = "proxcenter-test"
/** How often the overlays and the free space of their storage are measured. */
export const TEST_POLL_MS = 30_000
/** A test does not start with less than this free on the overlay storage. */
export const TEST_MIN_FREE_BYTES = 2 * 1024 ** 3
/** A running test stops when its overlay storage falls under this. */
export const TEST_STOP_FREE_BYTES = 1024 ** 3
/** RAM the node keeps on top of the test VM's memory. */
export const TEST_RAM_MARGIN_MB = 1024

const TICK_MS = 1000
const GiB = 1024 ** 3
/** Tries at clearing the request once a test ended, a few ticks apart. */
const CLEAR_REQUEST_ATTEMPTS = 3
const CLEAR_REQUEST_BACKOFF_TICKS = 2

/** What the pipeline that owns the copy hands the test. */
export interface MigrationTestTarget {
  jobId: string
  pveConn: any
  targetConnectionId: string
  node: string
  nodeIp: SshTarget
  /** Block device of every replicated volume, in target disk order. */
  devices: string[]
  /** What the cutover would convert the guest with; null when the migration does not convert it. */
  conversion: Omit<GuestConversionInput, "jobId" | "connectionId" | "nodeIp" | "devices" | "log" | "isCancelled"> | null
  /** The VM the cutover would create, for a converted guest or not. */
  paramsFor: (converted: boolean) => PveVmCreateParams
  /** Last change to the boot overlay before the VM starts (XCP-ng Windows: Xen PV drivers). */
  prepareBoot?: (overlayPath: string) => Promise<void>
  /** The cutover's drive options of disk i on its slot, for the VM `p` the test boots. */
  driveOpts?: (i: number, slot: string, p: PveVmCreateParams) => string
  /** Test seam: the signal and probe cadences. */
  timing?: { tickMs?: number; pollMs?: number }
}

/** What the test VM's description says: the only VM its removal ever touches carries it. */
export function testVmMarker(jobId: string): string {
  return `ProxCenter migration test of job ${jobId}`
}

/** The overlay volume of disk i of a test VM. */
export function overlayVolid(storage: string, vmid: number, i: number): string {
  return `${storage}:${vmid}/vm-${vmid}-test-${i}.qcow2`
}

/** A NIC value moved to the test bridge and VLAN, with its model and MAC kept and no firewall. */
export function retargetNet(value: string, bridge: string, vlanTag: number | null): string {
  const [model, ...rest] = value.split(",")
  const kept = rest.filter(p => !/^(bridge|tag|firewall)=/.test(p))
  return [model, `bridge=${bridge}`, ...(vlanTag === null ? [] : [`tag=${vlanTag}`]), ...kept].join(",")
}

const onStorage = (value: string, storage: string) => `${storage}${value.slice(value.indexOf(":"))}`

/** The create body of the test VM: the cutover's VM on the overlays, out of the backups. */
export function buildTestVmBody(p: PveVmCreateParams, a: {
  jobId: string; vmid: number; storage: string; overlayVolids: string[]; bridge: string | null; vlanTag: number | null
  driveOpts?: (i: number, slot: string) => string
}): URLSearchParams {
  const body = new URLSearchParams({
    vmid: String(a.vmid), name: `${p.name}-test`, ostype: p.ostype,
    cores: String(p.cores), sockets: String(p.sockets), memory: String(p.memory),
    cpu: p.cpu, scsihw: p.scsihw, bios: p.bios, machine: p.machine, agent: p.agent, serial0: "socket",
    tags: TEST_VM_TAG, onboot: "0", description: testVmMarker(a.jobId),
  })
  if (p.efidisk0) body.set("efidisk0", onStorage(p.efidisk0, a.storage))
  if (p.tpmstate0) body.set("tpmstate0", onStorage(p.tpmstate0, a.storage))
  a.overlayVolids.forEach((volid, i) => {
    const slot = p.diskSlots[i] ?? (i === 0 ? p.bootDiskSlot : `scsi${i}`)
    body.set(slot, `${volid},backup=0${a.driveOpts?.(i, slot) ?? ""}`)
  })
  body.set("boot", `order=${p.bootDiskSlot}`)
  if (a.bridge) for (const [key, value] of Object.entries(p.nets)) body.set(key, retargetNet(value, a.bridge, a.vlanTag))
  return body
}

/**
 * The directory the overlays were made in (`images/<testvmid>`), once empty:
 * PVE removes it with a VM it owned, nothing does when the test ended before
 * the VM was created. rmdir never removes a directory that still holds a file.
 */
async function removeOverlayDirs(connectionId: string, nodeIp: SshTarget, overlays: string[]): Promise<void> {
  const dirs = [...new Set(overlays.map(p => p.slice(0, p.lastIndexOf("/"))).filter(Boolean))]
  if (dirs.length > 0) await executeSSH(connectionId, nodeIp, `rmdir --ignore-fail-on-non-empty ${dirs.map(d => shellEscape(d)).join(" ")}`).catch(() => {})
}

/**
 * Remove a test VM and its overlays. The VM is touched only when its
 * description names this job's test (testVmMarker): its VMID was reserved
 * minutes before the create, and another VM may hold it by then (made in the
 * PVE wizard, or by another server), or after a restart. A VM that does not
 * exist is already gone. Ours is stopped when it runs (no `skiplock`: an API
 * token may not use it, lab 15/11) and destroyed with its disks, both tasks
 * waited for; the overlay files go last, over SSH. Never throws; says whether
 * nothing of the test is left, and why not.
 */
export async function removeTestVm(a: { pveConn: any; node: string; vmid: number; jobId: string; connectionId: string; nodeIp: SshTarget | null; overlays: string[] }): Promise<{ removed: boolean; reason?: string }> {
  const node = encodeURIComponent(a.node)
  const vm = `/nodes/${node}/qemu/${a.vmid}`
  const removeOverlays = async () => {
    if (a.nodeIp && a.overlays.length > 0) {
      await executeSSH(a.connectionId, a.nodeIp, `rm -f ${a.overlays.map(p => shellEscape(p)).join(" ")}`).catch(() => {})
      await removeOverlayDirs(a.connectionId, a.nodeIp, a.overlays)
    }
  }
  let config: any
  try {
    config = await pveFetch<any>(a.pveConn, `${vm}/config`)
  } catch (e: any) {
    const msg = String(e?.message || e)
    if (!/does not exist|not found|\b404\b/i.test(msg)) return { removed: false, reason: msg }
    await removeOverlays()
    return { removed: true }
  }
  if (!String(config?.description ?? "").includes(testVmMarker(a.jobId))) {
    // Not ours: never stopped nor destroyed. Its VMID was taken before ours was created.
    await removeOverlays()
    return { removed: true }
  }
  try {
    const current = await pveFetch<any>(a.pveConn, `${vm}/status/current`).catch(() => null)
    if (current?.status !== "stopped") {
      const stopped = await pveFetch<string>(a.pveConn, `${vm}/status/stop`, { method: "POST" })
      if (stopped) await waitForPveTask(a.pveConn, a.node, String(stopped))
    }
    // Query string, never a body: PVE's DELETE rejects one (#400, as destroyPveVm).
    // Shared volumes of this VMID another cluster may own stay (ui#1460).
    const disks = await decideUnreferencedDiskPurge({ conn: a.pveConn, connectionId: a.connectionId, node: a.node, type: "qemu", vmid: a.vmid })
    const destroyed = await pveFetch<string>(a.pveConn, `${vm}?purge=1${disks.destroyUnreferenced ? "&destroy-unreferenced-disks=1" : ""}`, { method: "DELETE" })
    if (destroyed) await waitForPveTask(a.pveConn, a.node, String(destroyed))
  } catch (e: any) {
    return { removed: false, reason: String(e?.message || e) }
  }
  await removeOverlays()
  return { removed: true }
}

/** A test that cannot start or go on, for a reason the operator can act on. */
class TestRefused extends Error {}
/** A test the operator stopped, or a cutover ended, before the VM ran. */
class TestStopped extends Error {}

const gib = (bytes: number) => `${(bytes / GiB).toFixed(1)} GiB`

/** "network on vmbr1 VLAN 30", or "no network". */
function networkLabel(bridge: string | null, vlanTag: number | null): string {
  if (!bridge) return "no network"
  return vlanTag ? `network on ${bridge} VLAN ${vlanTag}` : `network on ${bridge}`
}

/** A message without its final dots, without a backtracking regex. */
function withoutTrailingDots(s: string): string {
  let end = s.length
  while (end > 0 && s[end - 1] === ".") end--
  return s.slice(0, end)
}

/**
 * Run the test the operator asked for on this job, from the request on its
 * row to the removal of the test VM. Returns once nothing of the test is left;
 * throws only "Migration cancelled", after the cleanup.
 */
export async function runMigrationTest(t: MigrationTestTarget): Promise<void> {
  const { jobId, node } = t
  const tickMs = t.timing?.tickMs ?? TICK_MS
  const pollMs = t.timing?.pollMs ?? TEST_POLL_MS
  const ssh = (cmd: string, timeoutMs?: number) => executeSSH(t.targetConnectionId, t.nodeIp, cmd, timeoutMs)
  const log = (msg: string, level: "info" | "success" | "warn" | "error" = "info") => appendLog(jobId, `Test: ${msg}`, level).catch(() => {})
  let state: MigrationTestState = { phase: "preparing" }
  const report = async (next: Partial<MigrationTestState>) => {
    state = { ...state, ...next }
    await updateJobTestFields(jobId, { testState: state }).catch(() => {})
  }

  /** Between two steps of the preparation: a stop, a cutover or a cancellation ends it there. */
  const checkpoint = () => {
    if (isCancelled(jobId)) throw new Error("Migration cancelled")
    if (isCutoverRequested(jobId)) throw new TestStopped("a cutover was requested")
    if (isTestStopRequested(jobId)) throw new TestStopped("stopped by the operator")
  }
  const stopAsked = () => isCancelled(jobId) || isCutoverRequested(jobId) || isTestStopRequested(jobId)

  // A request already gone from the row is not a request: a mirror read in
  // flight while the previous test cleared its row can put the signal back for
  // a moment. Nothing to run, and the result of that previous test stays.
  const raw = await readJobTestRequest(jobId).catch((e: unknown) => (e instanceof Error ? e : new Error(String(e))))
  if (raw === null) {
    clearWarmTest(jobId)
    return
  }

  let vmid: number | null = null
  let overlays: string[] = []
  // Set before the create call: a create that fails half-way may still leave a VM.
  let vmCreated = false
  let ending: { reason: string; level: "info" | "warn" | "error"; failed?: boolean; leftover?: boolean } | null = null
  let cancelled = false
  try {
    if (raw instanceof Error) throw raw
    const parsed = parseTestRequest(raw)
    if (parsed.ok === false) throw new TestRefused(parsed.error)
    const request = parsed.request
    await report({ phase: "preparing", storage: request.storage, step: "checks", preparingSince: new Date().toISOString() })
    await log(`syncs paused; preparing a test VM on ${request.storage}`)
    checkpoint()

    const memoryMB = t.paramsFor(false).memory
    const status = await pveFetch<any>(t.pveConn, `/nodes/${encodeURIComponent(node)}/status`)
    const availMB = Math.floor(Number(status?.memory?.available ?? status?.memory?.free ?? 0) / 1048576)
    if (availMB < memoryMB + TEST_RAM_MARGIN_MB) {
      throw new TestRefused(`not enough RAM on ${node}: ${availMB} MiB available, the test VM needs ${memoryMB} MiB plus ${TEST_RAM_MARGIN_MB} MiB of margin`)
    }
    const storage = await pveFetch<any>(t.pveConn, `/nodes/${encodeURIComponent(node)}/storage/${encodeURIComponent(request.storage)}/status`)
    const free = Number(storage?.avail ?? 0)
    if (free < TEST_MIN_FREE_BYTES) {
      throw new TestRefused(`only ${gib(free)} free on ${request.storage}, a test needs at least ${gib(TEST_MIN_FREE_BYTES)} free`)
    }

    checkpoint()
    vmid = await reserveTargetVmid(t.pveConn, t.targetConnectionId, jobId)
    const volids = t.devices.map((_, i) => overlayVolid(request.storage, vmid!, i))
    const where = await ssh(volids.map(v => `pvesm path ${shellEscape(v)}`).join(" && "))
    overlays = (where.output || "").split("\n").map((l: string) => l.trim()).filter(Boolean)
    if (!where.success || overlays.length !== volids.length) {
      overlays = []
      throw new TestRefused(`the overlay paths on ${request.storage} could not be resolved: ${where.error || where.output || "no output"}`)
    }
    // Before anything exists on the node: a server that dies from here on
    // leaves the job row pointing at what to remove.
    await report({ testVmid: vmid, overlays })

    let converted = false
    if (t.conversion) {
      await report({ step: "conversion" })
      const r = await convertGuestForTest({
        ...t.conversion, jobId, connectionId: t.targetConnectionId, nodeIp: t.nodeIp, devices: t.devices, overlayPaths: overlays,
        log: (msg, level) => log(msg.replace(/^Guest conversion: /, "guest conversion: "), level), isCancelled: stopAsked,
      })
      converted = r.converted
      if (r.converted) {
        const os = r.os ? ` (${r.os})` : ""
        await log(`guest converted in ${r.seconds ?? 0}s${os}, as the cutover would`, "success")
      } else {
        await log(`guest conversion not applied: ${withoutTrailingDots(r.reason || "")}. The test boots the hardware the cutover would fall back to`, "warn")
      }
    }
    if (!converted) {
      if (!t.conversion) await report({ step: "overlay" })
      const made = await ssh(buildOverlayScript(t.devices, overlays))
      if (!made.success) throw new TestRefused(`the overlays could not be created: ${made.error || made.output || "qemu-img failed"}`)
    }
    await report({ step: "boot" })
    if (t.prepareBoot) await t.prepareBoot(overlays[0])
    checkpoint()

    const params = t.paramsFor(converted)
    const body = buildTestVmBody(params, { jobId, vmid, storage: request.storage, overlayVolids: volids, bridge: request.bridge, vlanTag: request.vlanTag, driveOpts: t.driveOpts && ((i, slot) => t.driveOpts!(i, slot, params)) })
    vmCreated = true
    const created = await pveFetch<string>(t.pveConn, `/nodes/${encodeURIComponent(node)}/qemu`, { method: "POST", body })
    if (created) await waitForPveTask(t.pveConn, node, String(created))
    const started = await pveFetch<string>(t.pveConn, `/nodes/${encodeURIComponent(node)}/qemu/${vmid}/status/start`, { method: "POST" })
    if (started) await waitForPveTask(t.pveConn, node, String(started))

    const startedAt = Date.now()
    const endsAt = startedAt + request.maxSec * 1000
    await report({ phase: "running", startedAt: new Date(startedAt).toISOString(), endsAt: new Date(endsAt).toISOString() })
    await log(`VM ${vmid} (${params.name}-test) started on ${node}, ${networkLabel(request.bridge, request.vlanTag)}; it stops by itself after ${request.maxSec / 3600} h`, "success")

    const dir = overlays[0].slice(0, overlays[0].lastIndexOf("/")) || "/"
    let nextProbe = 0
    for (;;) {
      if (isCancelled(jobId)) { cancelled = true; break }
      if (isCutoverRequested(jobId)) { ending = { reason: "a cutover was requested", level: "warn" }; break }
      if (isTestStopRequested(jobId)) { ending = { reason: "stopped by the operator", level: "info" }; break }
      if (Date.now() >= endsAt) { ending = { reason: "time limit reached", level: "info" }; break }
      if (Date.now() >= nextProbe) {
        nextProbe = Date.now() + pollMs
        const probe = await ssh(`du -B1 -c ${overlays.map(p => shellEscape(p)).join(" ")} 2>/dev/null | tail -n1 | cut -f1; df -B1 --output=avail ${shellEscape(dir)} | tail -n1`).catch(() => null)
        const [used, avail] = (probe?.output || "").split("\n").map((l: string) => Number(l.trim()))
        if (Number.isFinite(used) && used > 0) await report({ overlayBytes: used })
        if (Number.isFinite(avail) && avail < TEST_STOP_FREE_BYTES) {
          ending = { reason: `free space on ${request.storage} fell under ${gib(TEST_STOP_FREE_BYTES)}`, level: "warn" }
          break
        }
      }
      await new Promise(r => setTimeout(r, tickMs))
    }
  } catch (e: any) {
    const msg = String(e?.message || e)
    if (e instanceof TestStopped) ending = { reason: msg, level: "info" }
    else if (msg === "Migration cancelled" && !isCancelled(jobId)) {
      // The conversion stops on the operator's stop or cutover too (stopAsked).
      ending = { reason: isCutoverRequested(jobId) ? "a cutover was requested" : "stopped by the operator", level: "info" }
    } else if (msg === "Migration cancelled") cancelled = true
    else ending = { reason: msg, level: e instanceof TestRefused ? "warn" : "error", failed: true }
  } finally {
    if (vmCreated && vmid !== null) {
      await report({ phase: "stopping" })
      const removal = await removeTestVm({ pveConn: t.pveConn, node, vmid, jobId, connectionId: t.targetConnectionId, nodeIp: t.nodeIp, overlays })
      if (!removal.removed) {
        const leftover = `test VM ${vmid} could not be removed (${removal.reason}): stop and delete it in Proxmox`
        // What made the test fail stays first.
        ending = { reason: ending?.failed ? `${ending.reason}; ${leftover}` : leftover, level: "error", failed: true, leftover: true }
      }
    } else if (overlays.length > 0) {
      await ssh(`rm -f ${overlays.map(p => shellEscape(p)).join(" ")}`).catch(() => {})
      await removeOverlayDirs(t.targetConnectionId, t.nodeIp, overlays)
    }
    const reason = cancelled ? "the migration was cancelled" : ending?.reason ?? "ended"
    await report({ phase: ending?.failed ? "failed" : "ended", reason, endedAt: new Date().toISOString() })
    const resume = cancelled ? "" : ", syncs resume"
    let line = vmCreated
      ? `ended (${reason}); test VM ${vmid} and its overlays removed${resume}`
      : `ended (${reason}) before the test VM was created${resume}`
    if (ending?.leftover) line = reason
    else if (ending?.failed) line = vmid === null ? `not started: ${reason}` : `stopped: ${reason}. Test VM ${vmid} and its overlays removed`
    await log(line, ending?.level ?? "info")
    // Left on the row, the request would start the same test again at the next
    // hold, and the cutover would stay blocked behind it.
    let cleared = false
    for (let attempt = 0; attempt < CLEAR_REQUEST_ATTEMPTS && !cleared; attempt++) {
      if (attempt > 0) await new Promise(r => setTimeout(r, tickMs * CLEAR_REQUEST_BACKOFF_TICKS))
      cleared = await updateJobTestFields(jobId, { testRequest: null, testStopRequestedAt: null }).then(() => true, () => false)
    }
    if (!cleared) await log("could not clear the test request on the job: it may start again; stop it from the migrate dialog", "error")
    clearWarmTest(jobId)
  }
  if (cancelled) throw new Error("Migration cancelled")
}
