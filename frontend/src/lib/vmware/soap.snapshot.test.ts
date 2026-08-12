import { describe, it, expect, vi, beforeEach } from "vitest"

// The snapshot helpers call soapRequest, which lives in the module under test,
// so the transport is mocked one level lower: undici's request(). Same spirit as
// cbt.soap.test.ts (mock the SOAP transport, keep the real parsing/looping).
const undiciRequest = vi.fn()
vi.mock("undici", () => ({
  request: (...args: any[]) => undiciRequest(...args),
  Agent: class { constructor(_opts?: any) { /* no-op */ } },
}))

import {
  soapCreateSnapshot, soapRemoveSnapshot, soapRemoveAllSnapshots,
  soapWaitForConsolidation, soapFindSnapshotsByNamePrefix, parseSnapshotList,
  formatSoapBudget,
} from "./soap"

const session = {
  baseUrl: "https://vcenter", cookie: "vmware_soap_session=abc", insecureTLS: true,
  propertyCollector: "propertyCollector", sessionManager: "SessionManager",
  rootFolder: "group-d1", isVcenter: true,
} as any

/** One undici response carrying `text` as the SOAP body. */
function reply(text: string) {
  return { statusCode: 200, headers: {}, body: { text: async () => text } }
}
const TASK = '<returnval type="Task">task-42</returnval>'
const RUNNING = '<propSet><name>info.state</name><val xsi:type="TaskInfoState">running</val></propSet>'
const DONE = '<propSet><name>info.state</name><val xsi:type="TaskInfoState">success</val></propSet>'
const TASK_ERROR = '<propSet><name>info.state</name><val xsi:type="TaskInfoState">error</val></propSet>' +
  "<localizedMessage>Another task is already in progress</localizedMessage>"
const CREATE_DONE = DONE +
  '<propSet><name>info.result</name><val xsi:type="ManagedObjectReference" type="VirtualMachineSnapshot">snapshot-12</val></propSet>'

// Tiny intervals so no test ever sleeps. backoffAfterMs sits between the two so
// a short poll loop exercises BOTH the fast and the backed-off interval.
const fast = { pollMs: 1, slowPollMs: 1, backoffAfterMs: 10 }
// Single-poll cases override only the interval, so the backoff defaults apply.
const onePoll = { pollMs: 1 }

/** Body of the nth SOAP request the code under test issued. */
const bodyOf = (n: number) => String(undiciRequest.mock.calls[n][1].body)

beforeEach(() => { undiciRequest.mockReset() })

describe("soapCreateSnapshot", () => {
  it("submits CreateSnapshot_Task and returns the snapshot MOR once the task succeeds", async () => {
    undiciRequest.mockResolvedValueOnce(reply(TASK)).mockResolvedValueOnce(reply(CREATE_DONE))
    await expect(soapCreateSnapshot(session, "vm-9", "proxcenter-warm-full", "warm migration", false, onePoll))
      .resolves.toBe("snapshot-12")
    expect(bodyOf(0)).toContain("<urn:CreateSnapshot_Task>")
    expect(bodyOf(0)).toContain("<urn:quiesce>false</urn:quiesce>")
    // the poll asks for the three task properties the old inline loop asked for
    expect(bodyOf(1)).toContain("<urn:pathSet>info.result</urn:pathSet>")
  })

  it("throws when vCenter faults the create call", async () => {
    undiciRequest.mockResolvedValueOnce(reply("<faultstring>InvalidState</faultstring>"))
    await expect(soapCreateSnapshot(session, "vm-9", "snap", "", false, fast))
      .rejects.toThrow(/Failed to create snapshot: InvalidState/)
  })

  it("throws when no task reference comes back", async () => {
    undiciRequest.mockResolvedValueOnce(reply("<returnval/>"))
    await expect(soapCreateSnapshot(session, "vm-9", "snap", "", false, fast))
      .rejects.toThrow(/No task returned from CreateSnapshot_Task/)
  })

  it("throws with the localized message when the task reports error", async () => {
    undiciRequest.mockResolvedValueOnce(reply(TASK)).mockResolvedValueOnce(reply(TASK_ERROR))
    await expect(soapCreateSnapshot(session, "vm-9", "snap", "", false, fast))
      .rejects.toThrow(/Snapshot creation failed: Another task is already in progress/)
  })

  it("falls back to a generic message when the failed task carries no localized message", async () => {
    undiciRequest.mockResolvedValueOnce(reply(TASK))
      .mockResolvedValueOnce(reply('<val xsi:type="TaskInfoState">error</val>'))
    await expect(soapCreateSnapshot(session, "vm-9", "snap", "", false, onePoll))
      .rejects.toThrow(/Snapshot creation failed: Unknown error/)
  })

  it("returns an empty MOR when the successful task exposes no snapshot reference", async () => {
    // Caller-visible contract the warm pipeline depends on: "" means "no handle
    // on the snapshot", and it resolves it by name instead.
    undiciRequest.mockResolvedValueOnce(reply(TASK)).mockResolvedValueOnce(reply(DONE))
    await expect(soapCreateSnapshot(session, "vm-9", "snap", "", false, onePoll)).resolves.toBe("")
  })

  it("honours the injected budget and names it, the VM and the task (no more hardcoded 120s)", async () => {
    undiciRequest.mockResolvedValueOnce(reply(TASK)).mockResolvedValue(reply(RUNNING))
    const err = await soapCreateSnapshot(session, "vm-9", "proxcenter-warm-delta-1", "", false, { ...fast, timeoutMs: 30 })
      .catch((e: Error) => e)
    expect(String(err)).toMatch(/proxcenter-warm-delta-1/)
    expect(String(err)).toMatch(/vm-9/)
    expect(String(err)).toMatch(/task-42/)
    expect(String(err)).toMatch(/within 30ms/)
    expect(String(err)).not.toMatch(/120s/)
  })
})

describe("soapRemoveSnapshot", () => {
  it("submits RemoveSnapshot_Task and resolves once the task succeeds", async () => {
    undiciRequest.mockResolvedValueOnce(reply(TASK)).mockResolvedValueOnce(reply(DONE))
    await expect(soapRemoveSnapshot(session, "snapshot-7", false, onePoll)).resolves.toBeUndefined()
    expect(bodyOf(0)).toContain("<urn:RemoveSnapshot_Task>")
    expect(bodyOf(0)).toContain("<urn:removeChildren>false</urn:removeChildren>")
    expect(bodyOf(0)).toContain("<urn:consolidate>true</urn:consolidate>")
  })

  it("returns (unchanged loose semantics) when the task itself reports error", async () => {
    undiciRequest.mockResolvedValueOnce(reply(TASK)).mockResolvedValueOnce(reply(TASK_ERROR))
    await expect(soapRemoveSnapshot(session, "snapshot-7", false, fast)).resolves.toBeUndefined()
  })

  it("throws when vCenter faults the remove call", async () => {
    undiciRequest.mockResolvedValueOnce(reply("<faultstring>not found</faultstring>"))
    await expect(soapRemoveSnapshot(session, "snapshot-7", false, fast))
      .rejects.toThrow(/Failed to remove snapshot snapshot-7: not found/)
  })

  it("returns without polling when no task reference comes back", async () => {
    undiciRequest.mockResolvedValueOnce(reply("<returnval/>"))
    await expect(soapRemoveSnapshot(session, "snapshot-7", false, fast)).resolves.toBeUndefined()
    expect(undiciRequest).toHaveBeenCalledTimes(1)
  })

  it("THROWS on timeout instead of returning silently while vCenter still consolidates", async () => {
    undiciRequest.mockResolvedValueOnce(reply(TASK)).mockResolvedValue(reply(RUNNING))
    const err = await soapRemoveSnapshot(session, "snapshot-7", false, { ...fast, timeoutMs: 30 })
      .catch((e: Error) => e)
    expect(err).toBeInstanceOf(Error)
    expect(String(err)).toMatch(/Removal of snapshot snapshot-7 did not complete within 30ms/)
  })
})

describe("soapRemoveAllSnapshots", () => {
  it("submits RemoveAllSnapshots_Task and resolves once the task succeeds", async () => {
    undiciRequest.mockResolvedValueOnce(reply(TASK)).mockResolvedValueOnce(reply(DONE))
    await expect(soapRemoveAllSnapshots(session, "vm-9", onePoll)).resolves.toBeUndefined()
    expect(bodyOf(0)).toContain("<urn:RemoveAllSnapshots_Task>")
  })

  it("throws when vCenter faults the call", async () => {
    undiciRequest.mockResolvedValueOnce(reply("<faultstring>busy</faultstring>"))
    await expect(soapRemoveAllSnapshots(session, "vm-9", fast)).rejects.toThrow(/Failed to remove snapshots: busy/)
  })

  it("returns without polling when no task reference comes back", async () => {
    undiciRequest.mockResolvedValueOnce(reply("<returnval/>"))
    await expect(soapRemoveAllSnapshots(session, "vm-9", fast)).resolves.toBeUndefined()
    expect(undiciRequest).toHaveBeenCalledTimes(1)
  })

  it("THROWS on timeout instead of returning silently", async () => {
    undiciRequest.mockResolvedValueOnce(reply(TASK)).mockResolvedValue(reply(RUNNING))
    await expect(soapRemoveAllSnapshots(session, "vm-9", { ...fast, timeoutMs: 30 }))
      .rejects.toThrow(/Removal of all snapshots on VM vm-9 did not complete within 30ms/)
  })
})

describe("formatSoapBudget", () => {
  it("renders sub-second, second, minute and hour budgets", () => {
    expect(formatSoapBudget(30)).toBe("30ms")
    expect(formatSoapBudget(45_000)).toBe("45s")
    expect(formatSoapBudget(30 * 60 * 1000)).toBe("30min")
    expect(formatSoapBudget(4 * 60 * 60 * 1000)).toBe("4h")
    expect(formatSoapBudget(90 * 60 * 1000)).toBe("1.5h")
  })
})

const consolidation = (v: string) =>
  `<propSet><name>runtime.consolidationNeeded</name><val xsi:type="xsd:boolean">${v}</val></propSet>`

describe("soapWaitForConsolidation", () => {
  it("returns true immediately when the VM has no pending consolidation", async () => {
    undiciRequest.mockResolvedValueOnce(reply(consolidation("false")))
    await expect(soapWaitForConsolidation(session, "vm-9", 5000, 1)).resolves.toBe(true)
    expect(undiciRequest).toHaveBeenCalledTimes(1)
    expect(bodyOf(0)).toContain("<urn:pathSet>runtime.consolidationNeeded</urn:pathSet>")
  })

  it("returns true when the flag clears, announcing the wait exactly once", async () => {
    undiciRequest
      .mockResolvedValueOnce(reply(consolidation("true")))
      .mockResolvedValueOnce(reply(consolidation("true")))
      .mockResolvedValueOnce(reply(consolidation("false")))
    const onWaitStart = vi.fn()
    await expect(soapWaitForConsolidation(session, "vm-9", 5000, 1, onWaitStart)).resolves.toBe(true)
    expect(onWaitStart).toHaveBeenCalledTimes(1)
  })

  it("returns false (never throws) when the budget elapses with consolidation still pending", async () => {
    undiciRequest.mockResolvedValue(reply(consolidation("true")))
    await expect(soapWaitForConsolidation(session, "vm-9", 20, 1)).resolves.toBe(false)
  })

  it("fails open (true) when the property is absent, so an older host never blocks a migration", async () => {
    undiciRequest.mockResolvedValueOnce(reply("<objects><obj>vm-9</obj></objects>"))
    await expect(soapWaitForConsolidation(session, "vm-9", 20, 1)).resolves.toBe(true)
  })

  it("fails open (true) when the query itself fails", async () => {
    undiciRequest.mockRejectedValue(new Error("socket hang up"))
    await expect(soapWaitForConsolidation(session, "vm-9", 20, 1)).resolves.toBe(true)
  })
})

// Realistic VirtualMachineSnapshotInfo payload: a root snapshot with two nested
// children (the second nested inside the first), plus the currentSnapshot ref
// that must NOT be mistaken for a tree node.
const SNAPSHOT_TREE = `<currentSnapshot type="VirtualMachineSnapshot">snapshot-3</currentSnapshot>
<rootSnapshotList>
  <snapshot type="VirtualMachineSnapshot">snapshot-1</snapshot>
  <vm type="VirtualMachine">vm-9</vm>
  <name>daily-backup</name>
  <description>user snapshot</description>
  <id>1</id>
  <createTime>2026-08-11T01:00:00Z</createTime>
  <state>poweredOn</state>
  <quiesced>false</quiesced>
  <replaySupported>false</replaySupported>
  <childSnapshotList>
    <snapshot type="VirtualMachineSnapshot">snapshot-2</snapshot>
    <vm type="VirtualMachine">vm-9</vm>
    <name>proxcenter-warm-full</name>
    <description>warm migration</description>
    <id>2</id>
    <state>poweredOn</state>
    <childSnapshotList>
      <snapshot type="VirtualMachineSnapshot">snapshot-3</snapshot>
      <vm type="VirtualMachine">vm-9</vm>
      <name>proxcenter-warm-delta-1</name>
      <description>warm migration</description>
      <id>3</id>
      <state>poweredOn</state>
    </childSnapshotList>
  </childSnapshotList>
</rootSnapshotList>`

describe("parseSnapshotList", () => {
  it("walks the nested rootSnapshotList and pairs every snapshot with its name", () => {
    expect(parseSnapshotList(SNAPSHOT_TREE)).toEqual([
      { name: "daily-backup", mor: "snapshot-1" },
      { name: "proxcenter-warm-full", mor: "snapshot-2" },
      { name: "proxcenter-warm-delta-1", mor: "snapshot-3" },
    ])
  })

  it("tolerates an extra xsi:type attribute on the snapshot reference", () => {
    expect(parseSnapshotList(
      '<rootSnapshotList><snapshot xsi:type="ManagedObjectReference" type="VirtualMachineSnapshot">snapshot-8</snapshot>' +
      "<name>proxcenter-warm-cutover</name></rootSnapshotList>",
    )).toEqual([{ name: "proxcenter-warm-cutover", mor: "snapshot-8" }])
  })

  it("returns an empty list for a VM with no snapshots", () => {
    expect(parseSnapshotList("")).toEqual([])
    expect(parseSnapshotList("<rootSnapshotList></rootSnapshotList>")).toEqual([])
    // a <name> with no snapshot reference before it belongs to something else
    expect(parseSnapshotList("<name>not a snapshot</name>")).toEqual([])
  })
})

describe("soapFindSnapshotsByNamePrefix", () => {
  it("reads the VM's snapshot property and keeps only the matching names", async () => {
    undiciRequest.mockResolvedValueOnce(reply(
      `<objects><propSet><name>snapshot</name><val xsi:type="VirtualMachineSnapshotInfo">${SNAPSHOT_TREE}</val></propSet></objects>`,
    ))
    await expect(soapFindSnapshotsByNamePrefix(session, "vm-9", "proxcenter-warm-")).resolves.toEqual([
      { name: "proxcenter-warm-full", mor: "snapshot-2" },
      { name: "proxcenter-warm-delta-1", mor: "snapshot-3" },
    ])
    expect(bodyOf(0)).toContain("<urn:pathSet>snapshot</urn:pathSet>")
    expect(bodyOf(0)).toContain('<urn:obj type="VirtualMachine">vm-9</urn:obj>')
  })

  it("returns an empty list when the VM carries no snapshot property", async () => {
    undiciRequest.mockResolvedValueOnce(reply("<objects><obj>vm-9</obj></objects>"))
    await expect(soapFindSnapshotsByNamePrefix(session, "vm-9", "proxcenter-warm-")).resolves.toEqual([])
  })
})
