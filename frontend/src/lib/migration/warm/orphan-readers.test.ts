import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/db/prisma", () => ({ prisma: { migrationJob: { findMany: vi.fn() } } }))
vi.mock("@/lib/ssh/exec", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/ssh/exec")>()
  return { ...actual, executeSSH: vi.fn() }
})

import { executeSSH } from "@/lib/ssh/exec"
import {
  buildOrphanReaderListCmd, parseReaderProcesses, classifyReaders, buildOrphanReaderKillCmd, sweepOrphanReaders,
  type ReaderProcess,
} from "./orphan-readers"

const mockSSH = executeSSH as unknown as ReturnType<typeof vi.fn>

const JOB_OLD = "cmgold000000000000000001"
const JOB_LIVE = "cmglive00000000000000002"
const JOB_GONE = "cmggone00000000000000003"
const JOB_ME = "cmgme0000000000000000004"

// What `pgrep -a` prints on a node: pid, then the unquoted argv of each nbdkit.
const LISTING = [
  `4242 nbdkit -r -U /tmp/proxcenter-vddk-${JOB_OLD}-2000.sock vddk libdir=/usr/lib/vmware-vix-disklib server=10.42.0.20 user=administrator@vsphere.local password=+/tmp/proxcenter-vddk-${JOB_OLD}-2000.pw thumbprint=AB:CD vm=moref=vm-10936 snapshot=snapshot-991 file=[Datastore (1)] Alma/Alma.vmdk`,
  `4243 nbdkit -r -U /tmp/proxcenter-vddk-${JOB_OLD}-2001.sock vddk libdir=/usr/lib/vmware-vix-disklib server=10.42.0.20 user=root password=+/tmp/x.pw thumbprint=AB vm=moref=vm-1 file=[ds] a/a_1.vmdk`,
  `5100 nbdkit -r -U /tmp/proxcenter-xapi-${JOB_LIVE}-vdi0.sock nbd uri=nbds://x tls-certificates=/tmp/proxcenter-xapi-${JOB_LIVE}-vdi0.sock.ca`,
  `6100 nbdkit -r -U /tmp/proxcenter-vddk-${JOB_GONE}-vrfy-2000.sock vddk libdir=/l server=s user=u password=+/p thumbprint=t vm=moref=vm-2 file=f`,
  `7000 nbdkit -r -U /tmp/proxcenter-vddk-${JOB_ME}-2000.sock vddk libdir=/l server=s user=u password=+/p thumbprint=t vm=moref=vm-3 file=f`,
  `8000 nbdkit -U /tmp/someone-else.sock file /srv/img.raw`,
  ``,
].join("\n")

describe("buildOrphanReaderListCmd", () => {
  it("lists only this product's nbdkit readers and never matches its own shell", () => {
    const c = buildOrphanReaderListCmd()
    expect(c).toContain("pgrep -a -f")
    // One-character class: the shell running this command carries the literal
    // pattern in its argv and must not be listed (nor killed later).
    expect(c).toContain("'^[n]bdkit .* -U /tmp/proxcenter-(vddk|xapi)-'")
    expect(c).not.toMatch(/-f '\^nbdkit/)
    // No match is pgrep exit 1, not a failure of the sweep.
    expect(c.endsWith("|| true")).toBe(true)
  })
})

describe("parseReaderProcesses", () => {
  it("reads the pid, the family and the owning job from the socket path, ignoring foreign nbdkits", () => {
    const procs = parseReaderProcesses(LISTING)
    expect(procs.map(p => p.pid)).toEqual([4242, 4243, 5100, 6100, 7000])
    expect(procs[0]).toEqual({ pid: 4242, jobId: JOB_OLD, family: "vddk", sock: `/tmp/proxcenter-vddk-${JOB_OLD}-2000.sock` })
    expect(procs[2].family).toBe("xapi")
    expect(procs[2].jobId).toBe(JOB_LIVE)
    // the verify reader's "-vrfy-" tag does not leak into the job id
    expect(procs[3].jobId).toBe(JOB_GONE)
  })
  it("tolerates empty or undefined output", () => {
    expect(parseReaderProcesses(undefined)).toEqual([])
    expect(parseReaderProcesses("")).toEqual([])
  })
})

describe("classifyReaders", () => {
  const procs = parseReaderProcesses(LISTING)
  it("kills only the readers of TERMINAL jobs; live, unknown and the current job are kept", () => {
    const statuses = new Map<string, string>([[JOB_OLD, "failed"], [JOB_LIVE, "delta_sync"], [JOB_ME, "planning"]])
    const v = classifyReaders(procs, statuses, JOB_ME)
    expect(v.orphans.map(p => p.pid)).toEqual([4242, 4243])
    expect(v.live.map(p => p.pid)).toEqual([5100, 7000])
    // JOB_GONE has no row on this server: it cannot be judged, so it is kept.
    expect(v.unknown.map(p => p.pid)).toEqual([6100])
  })
  it("treats every terminal status alike and the current job as live whatever the row says", () => {
    for (const st of ["completed", "failed", "cancelled"]) {
      const v = classifyReaders(procs.slice(0, 1), new Map([[JOB_OLD, st]]), JOB_ME)
      expect(v.orphans).toHaveLength(1)
    }
    const v = classifyReaders(procs.slice(4, 5), new Map([[JOB_ME, "completed"]]), JOB_ME)
    expect(v.live).toHaveLength(1)
    expect(v.orphans).toHaveLength(0)
  })
})

describe("buildOrphanReaderKillCmd", () => {
  const S1 = `/tmp/proxcenter-vddk-${JOB_OLD}-2000.sock`
  const S2 = `/tmp/proxcenter-vddk-${JOB_OLD}-2001.sock`
  const S3 = `/tmp/proxcenter-xapi-${JOB_LIVE}-vdi0.sock`
  const orphans: ReaderProcess[] = [
    { pid: 4242, jobId: JOB_OLD, family: "vddk", sock: S1 },
    { pid: 4243, jobId: JOB_OLD, family: "vddk", sock: S2 },
    { pid: 5100, jobId: JOB_LIVE, family: "xapi", sock: S3 },
  ]

  it("re-checks each pid against its OWN socket before the SIGTERM and again before the SIGKILL", () => {
    const c = buildOrphanReaderKillCmd(orphans)!
    expect(c).toContain(`case "$c" in "nbdkit "*" -U $2 "*) return 0;; esac`)
    for (const [pid, sock] of [[4242, S1], [4243, S2], [5100, S3]]) {
      expect(c).toContain(`chk ${pid} '${sock}' && kill ${pid} 2>/dev/null`)
      expect(c).toContain(`chk ${pid} '${sock}' && kill -9 ${pid} 2>/dev/null`)
    }
    // the escalation is never unconditional: a pid reused during the grace second is spared
    expect(c).not.toMatch(/\[ -d \/proc\/\$p \] && kill -9/)
    expect(c.indexOf("sleep 1")).toBeGreaterThan(c.indexOf("&& kill 5100"))
    expect(c.indexOf("sleep 1")).toBeLessThan(c.indexOf("&& kill -9 4242"))
    expect(c).toContain(`rm -f /tmp/proxcenter-vddk-${JOB_OLD}-* /tmp/proxcenter-xapi-${JOB_LIVE}-*`)
    // never a pkill by pattern here: pids were verified against the database
    expect(c).not.toContain("pkill")
  })

  it("refuses pids that are not real process ids, and sockets that are not ours", () => {
    expect(buildOrphanReaderKillCmd([])).toBeNull()
    expect(buildOrphanReaderKillCmd([{ pid: 1, jobId: JOB_OLD, family: "vddk", sock: S1 }])).toBeNull()
    expect(buildOrphanReaderKillCmd([{ pid: NaN, jobId: JOB_OLD, family: "vddk", sock: S1 }])).toBeNull()
    expect(buildOrphanReaderKillCmd([{ pid: 4242, jobId: JOB_OLD, family: "vddk", sock: "/tmp/x'; reboot; '" }])).toBeNull()
    expect(buildOrphanReaderKillCmd([{ pid: 4242, jobId: JOB_OLD, family: "vddk", sock: `${S1}*` }])).toBeNull()
  })
})

describe("sweepOrphanReaders", () => {
  const log = vi.fn(async () => {})
  const findMany = vi.fn()
  const prisma = { migrationJob: { findMany } }
  beforeEach(() => { mockSSH.mockReset(); log.mockClear(); findMany.mockReset() })

  it("kills the readers of finished jobs, keeps live and unknown ones, and logs each decision", async () => {
    mockSSH
      .mockResolvedValueOnce({ success: true, output: LISTING })
      .mockResolvedValueOnce({ success: true, output: "" })
    findMany.mockResolvedValue([{ id: JOB_OLD, status: "failed" }, { id: JOB_LIVE, status: "full_copy" }, { id: JOB_ME, status: "planning" }])
    const r = await sweepOrphanReaders({ connectionId: "c1", nodeIp: "10.42.0.101", nodeName: "pve1", currentJobId: JOB_ME, log, prisma })
    expect(r.killed.map(p => p.pid)).toEqual([4242, 4243])
    expect(r.kept.map(p => p.pid).sort()).toEqual([5100, 6100, 7000])
    expect(findMany).toHaveBeenCalledWith({ where: { id: { in: [JOB_OLD, JOB_LIVE, JOB_GONE, JOB_ME] } }, select: { id: true, status: true } })
    expect(mockSSH).toHaveBeenCalledTimes(2)
    const killCmd = mockSSH.mock.calls[1][2] as string
    expect(killCmd).toContain("&& kill 4242 ")
    expect(killCmd).toContain("&& kill 4243 ")
    expect(killCmd).not.toContain("5100")
    expect(killCmd).not.toContain("7000")
    const msgs = log.mock.calls.map(c => c[0] as string)
    expect(msgs).toContain("Stopped 2 leftover nbdkit reader(s) of finished migrations on pve1: pid 4242, 4243, socket and password files removed")
    expect(msgs).toContain("1 nbdkit reader(s) of other running migrations on pve1 (pid 5100); left running")
    expect(msgs).toContain("1 nbdkit reader(s) on pve1 belong to no migration this server knows (pid 6100); left running")
    // The job log is read by this migration's tenant: no other migration is
    // ever named there, neither by id, nor by status, nor by socket path.
    for (const leaked of [JOB_OLD, JOB_LIVE, JOB_GONE, JOB_ME, "failed", "full_copy", "/tmp/proxcenter-"]) {
      expect(msgs.some(m => m.includes(leaked))).toBe(false)
    }
  })

  it("does nothing, silently, when the node runs no reader", async () => {
    mockSSH.mockResolvedValueOnce({ success: true, output: "" })
    const r = await sweepOrphanReaders({ connectionId: "c1", nodeIp: "n", nodeName: "pve1", currentJobId: JOB_ME, log, prisma })
    expect(r).toEqual({ killed: [], kept: [] })
    expect(findMany).not.toHaveBeenCalled()
    expect(log).not.toHaveBeenCalled()
  })

  it("logs and continues when the listing or the kill fails", async () => {
    mockSSH.mockResolvedValueOnce({ success: false, error: "ssh down" })
    let r = await sweepOrphanReaders({ connectionId: "c1", nodeIp: "n", nodeName: "pve1", currentJobId: JOB_ME, log, prisma })
    expect(r.killed).toEqual([])
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Could not list leftover nbdkit readers on pve1 (ssh down)"), "warn")

    log.mockClear()
    mockSSH.mockResolvedValueOnce({ success: true, output: LISTING.split("\n")[0] }).mockResolvedValueOnce({ success: false, error: "Exit code 1" })
    findMany.mockResolvedValue([{ id: JOB_OLD, status: "completed" }])
    r = await sweepOrphanReaders({ connectionId: "c1", nodeIp: "n", nodeName: "pve1", currentJobId: JOB_ME, log, prisma })
    expect(r.killed).toEqual([])
    expect(r.kept.map(p => p.pid)).toEqual([4242])
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Could not stop the leftover nbdkit readers on pve1 (Exit code 1)"), "warn")
  })
})
