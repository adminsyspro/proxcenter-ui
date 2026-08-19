import { describe, it, expect, vi, beforeEach } from "vitest"

import {
  requestV2vRootChoice,
  V2V_AWAITING_ROOT_CHOICE_STEP,
  __getRequestedRootForTest,
  __awaitOperatorRootChoiceForTest as awaitRootChoice,
  __setJobPrismaForTest,
  __setCancelledForTest,
} from "./v2v-pipeline"

/**
 * The multi-boot gate (#738): a cold virt-v2v job parks itself when guest
 * inspection leaves several plausible systems, keeping the already-downloaded
 * disks, and resumes as soon as an operator picks one.
 */

const JOB = "job-gate-1"

const CANDIDATES = [
  { index: 1, device: "/dev/sda1", description: "Debian GNU/Linux 12 (bookworm)" },
  { index: 5, device: "/dev/sdb", description: "13.3" },
]

/** Minimal prisma double holding the row fields the gate reads and writes. */
function fakePrisma(config: Record<string, any> = {}) {
  const row: Record<string, any> = { config, logs: [] as any[], progress: 0 }
  const update = vi.fn(async ({ data }: any) => {
    Object.assign(row, data)
    return row
  })
  return {
    row,
    update,
    migrationJob: {
      findUnique: vi.fn(async () => ({ ...row })),
      update,
    },
  }
}

/** Every log message the gate wrote, newest last. */
function messages(prisma: ReturnType<typeof fakePrisma>): string[] {
  return ((prisma.row.logs as any[]) || []).map(l => l.msg)
}

beforeEach(() => {
  __setCancelledForTest(JOB, false)
  __setJobPrismaForTest(JOB, null)
})

describe("requestV2vRootChoice", () => {
  it("accepts a device name and trims it", () => {
    expect(requestV2vRootChoice(JOB, "  /dev/sda1  ")).toBe(true)
    expect(__getRequestedRootForTest(JOB)).toBe("/dev/sda1")
  })

  it.each([
    "/dev/sda1; reboot",
    "$(id)",
    "",
    "  ",
  ])("refuses %j instead of parking the job on a value it would never use", value => {
    // the route answers 400 on false; the value must never reach a command line
    expect(requestV2vRootChoice(JOB, value)).toBe(false)
  })
})

describe("awaitOperatorRootChoice", () => {
  it("parks the job on currentStep and publishes the pickable candidates", async () => {
    const prisma = fakePrisma({ targetVmid: 120 })
    __setJobPrismaForTest(JOB, prisma)
    // expire immediately: we only care about what parking wrote
    const picked = await awaitRootChoice(JOB, CANDIDATES, { pollMs: 1, timeoutMs: 0 })

    expect(picked).toBeNull()
    expect(prisma.row.currentStep).toBe(V2V_AWAITING_ROOT_CHOICE_STEP)
    // config is merged, not replaced: the job's own settings must survive
    expect(prisma.row.config).toEqual({
      targetVmid: 120,
      v2vRootCandidates: [
        { device: "/dev/sda1", description: "Debian GNU/Linux 12 (bookworm)" },
        { device: "/dev/sdb", description: "13.3" },
      ],
    })
    expect(messages(prisma).some(m => /disks are kept/.test(m))).toBe(true)
  })

  it("returns the operator's pick and takes the job out of the waiting step", async () => {
    const prisma = fakePrisma()
    __setJobPrismaForTest(JOB, prisma)
    // armed after the gate opened: the gate purges the registry on entry so a
    // pick left over from an earlier parking cannot decide this one
    setTimeout(() => requestV2vRootChoice(JOB, "/dev/sdb"), 5)

    const picked = await awaitRootChoice(JOB, CANDIDATES, { pollMs: 1, timeoutMs: 5000 })

    expect(picked).toBe("/dev/sdb")
    expect(prisma.row.currentStep).toBe("converting_disks")
    expect(prisma.row.status).toBe("converting_disks")
    expect(messages(prisma).some(m => /Operator chose \/dev\/sdb/.test(m))).toBe(true)
    // the pick is consumed, so a later gate on the same job starts clean
    expect(__getRequestedRootForTest(JOB)).toBeUndefined()
  })

  it("ignores a pick that is not one of the offered candidates", async () => {
    const prisma = fakePrisma()
    __setJobPrismaForTest(JOB, prisma)
    // the route validates against the same list, so this means the two disagree
    setTimeout(() => requestV2vRootChoice(JOB, "/dev/sdz9"), 5)

    const picked = await awaitRootChoice(JOB, CANDIDATES, { pollMs: 1, timeoutMs: 60 })

    expect(picked).toBeNull()
    expect(messages(prisma).some(m => /Ignoring root filesystem "\/dev\/sdz9"/.test(m))).toBe(true)
  })

  it("gives up on expiry so the downloaded disks stop occupying the node", async () => {
    const prisma = fakePrisma()
    __setJobPrismaForTest(JOB, prisma)

    const picked = await awaitRootChoice(JOB, CANDIDATES, { pollMs: 1, timeoutMs: 5 })

    expect(picked).toBeNull()
    expect(messages(prisma).some(m => /No choice received after/.test(m))).toBe(true)
  })

  it("aborts when the job is cancelled while parked", async () => {
    const prisma = fakePrisma()
    __setJobPrismaForTest(JOB, prisma)
    __setCancelledForTest(JOB, true)

    await expect(awaitRootChoice(JOB, CANDIDATES, { pollMs: 1, timeoutMs: 5000 }))
      .rejects.toThrow(/cancelled/i)
  })

  it("drops a stale pick from an earlier gate before waiting", async () => {
    const prisma = fakePrisma()
    __setJobPrismaForTest(JOB, prisma)
    // armed before the gate opens: a leftover from a previous parking must not
    // silently decide this one
    requestV2vRootChoice(JOB, "/dev/sda1")

    const picked = await awaitRootChoice(JOB, CANDIDATES, { pollMs: 1, timeoutMs: 5 })

    expect(picked).toBeNull()
  })
})

describe("awaitOperatorRootChoice defaults", () => {
  it("falls back to the built-in poll interval and gate timeout", async () => {
    // called with no options at all, as the pipeline does: the default poll is a
    // few seconds, so the pick lands on the second pass rather than the first
    const prisma = fakePrisma()
    __setJobPrismaForTest(JOB, prisma)
    setTimeout(() => requestV2vRootChoice(JOB, "/dev/sda1"), 10)

    const picked = await awaitRootChoice(JOB, CANDIDATES)

    expect(picked).toBe("/dev/sda1")
  }, 15000)

  it("parks a job whose config is empty without dropping the candidate list", async () => {
    const prisma = fakePrisma()
    // a job row can carry a null config; the merge must still produce the list
    prisma.row.config = null
    __setJobPrismaForTest(JOB, prisma)

    await awaitRootChoice(JOB, CANDIDATES, { pollMs: 1, timeoutMs: 0 })

    expect(prisma.row.config).toEqual({
      v2vRootCandidates: [
        { device: "/dev/sda1", description: "Debian GNU/Linux 12 (bookworm)" },
        { device: "/dev/sdb", description: "13.3" },
      ],
    })
  })
})
