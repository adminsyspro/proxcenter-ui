import { describe, it, expect, vi, beforeEach } from "vitest"

import { cleanShutdownAndConfirm, isVmwareToolsUnavailable, isXapiGuestAgentMissing, type PowerOffOps } from "./power-off"

/**
 * The case these cover: a guest without guest tools (a closed appliance, a VM
 * whose Tools were never installed). Its hypervisor refuses the shutdown
 * request on the spot, so waiting for a clean shutdown, and asking the operator
 * to click "Force power off" on every such VM of a bulk run, buys nothing. The
 * source is powered off hard right away and the operator step never appears.
 * A guest that refused for any other reason keeps the operator wait exactly as
 * before (#614).
 */

const updateJob = vi.fn(async () => {})
const appendLog = vi.fn(async () => {})
const isCancelled = vi.fn(() => false)
const isForcePowerOffRequested = vi.fn(() => false)

vi.mock("./job-control", () => ({
  updateJob: (...a: any[]) => updateJob(...(a as [])),
  appendLog: (...a: any[]) => appendLog(...(a as [])),
  isCancelled: (...a: any[]) => isCancelled(...(a as [])),
  isForcePowerOffRequested: (...a: any[]) => isForcePowerOffRequested(...(a as [])),
}))

const JOB = "job-1"

function ops(over: Partial<PowerOffOps> & { poweredOff?: () => boolean } = {}): PowerOffOps & { hardPowerOff: ReturnType<typeof vi.fn> } {
  const state = { off: false }
  const o: any = {
    requestShutdown: vi.fn(async () => { state.off = true }),
    // Like the real adapters: poll, then sleep the slice, so a confirmation window
    // measured in milliseconds sees a handful of polls rather than a busy loop.
    waitPoweredOff: vi.fn(async (sliceMs: number) => {
      await new Promise(r => setTimeout(r, sliceMs))
      return over.poweredOff ? over.poweredOff() : state.off
    }),
    hardPowerOff: vi.fn(async () => { state.off = true }),
    ...over,
  }
  return o
}

const stepsSet = () => updateJob.mock.calls.map((c: any[]) => c[2]?.currentStep).filter(Boolean)
const logs = () => appendLog.mock.calls.map((c: any[]) => String(c[1]))

beforeEach(() => {
  updateJob.mockClear()
  appendLog.mockClear()
  isCancelled.mockReturnValue(false)
  isForcePowerOffRequested.mockReturnValue(false)
})

describe("cleanShutdownAndConfirm without guest tools", () => {
  it("powers the source off hard at once and never shows the operator step", async () => {
    const o = ops({
      requestShutdown: vi.fn(async () => { throw new Error("ShutdownGuest failed: SOAP error 500: Cannot complete operation because VMware Tools is not running in this virtual machine. | fault type: ToolsUnavailableFault") }),
      isGuestUnreachable: () => true,
    })
    await cleanShutdownAndConfirm(JOB, o, "Cutover: requesting clean guest shutdown…", "cutover", { waitMs: 500, sliceMs: 5 })

    expect(o.hardPowerOff).toHaveBeenCalledTimes(1)
    expect(stepsSet()).not.toContain("awaiting_power_off")
    expect(logs().some(l => /powering it off hard now/i.test(l))).toBe(true)
    expect(logs().some(l => /Waiting up to/i.test(l))).toBe(false)
  })

  it("does not fire the hard power off on its own when the guest refused for another reason", async () => {
    const o = ops({
      requestShutdown: vi.fn(async () => { throw new Error("ShutdownGuest failed: A general system error occurred: Undeclared fault") }),
      isGuestUnreachable: () => false,
    })
    // The operator decides, as before.
    isForcePowerOffRequested.mockReturnValueOnce(false).mockReturnValue(true)
    await cleanShutdownAndConfirm(JOB, o, "Cutover…", "cutover", { waitMs: 500, sliceMs: 5 })

    expect(stepsSet()).toContain("awaiting_power_off")
    expect(o.hardPowerOff).toHaveBeenCalledTimes(1)
    expect(logs().some(l => /The guest refused the shutdown request\. Waiting up to/i.test(l))).toBe(true)
    expect(logs().some(l => /Operator requested a hard power off/i.test(l))).toBe(true)
  })

  it("falls back to the operator wait when the host refuses the automatic hard power off", async () => {
    const o = ops({
      requestShutdown: vi.fn(async () => { throw new Error("ToolsUnavailableFault") }),
      hardPowerOff: vi.fn(async () => { throw new Error("Current license or ESXi version prohibits execution of the requested operation.") }),
      isGuestUnreachable: () => true,
      poweredOff: () => false,
    })
    await expect(cleanShutdownAndConfirm(JOB, o, "Cutover…", "cutover", { waitMs: 60, sliceMs: 5 }))
      .rejects.toThrow(/did not reach a confirmed powered-off state/)

    expect(stepsSet()).toContain("awaiting_power_off")
    expect(logs().some(l => /Hard power off was refused by the source host/i.test(l))).toBe(true)
    expect(logs().some(l => /Waiting up to/i.test(l))).toBe(true)
  })

  it("hands over to the operator when the accepted hard power off is never confirmed", async () => {
    let calls = 0
    const o = ops({
      requestShutdown: vi.fn(async () => { throw new Error("ToolsUnavailableFault") }),
      hardPowerOff: vi.fn(async () => {}),
      isGuestUnreachable: () => true,
      // Four polls fit in the 20 ms confirmation window; the source only reports
      // off once the operator wait is polling.
      poweredOff: () => ++calls > 8,
    })
    await cleanShutdownAndConfirm(JOB, o, "Cutover…", "cutover", { waitMs: 2000, sliceMs: 5, confirmMs: 20 })

    expect(stepsSet()).toContain("awaiting_power_off")
    expect(logs().some(l => /still reports a powered-on state/i.test(l))).toBe(true)
  })

  it("keeps the clean shutdown path untouched when the guest honours the request", async () => {
    const o = ops({ isGuestUnreachable: () => true })
    await cleanShutdownAndConfirm(JOB, o, "Cutover…", "cutover", { waitMs: 500, sliceMs: 5 })

    expect(o.hardPowerOff).not.toHaveBeenCalled()
    expect(stepsSet()).toContain("awaiting_power_off")
  })

  it("stops on a cancel during the automatic confirmation", async () => {
    const o = ops({
      requestShutdown: vi.fn(async () => { throw new Error("ToolsUnavailableFault") }),
      hardPowerOff: vi.fn(async () => {}),
      isGuestUnreachable: () => true,
      poweredOff: () => false,
    })
    isCancelled.mockReturnValue(true)
    await expect(cleanShutdownAndConfirm(JOB, o, "Cutover…", "cutover", { waitMs: 500, sliceMs: 5 })).rejects.toThrow(/cancelled/)
  })
})

describe("guest tools predicates", () => {
  it("recognises the vSphere fault raised when Tools are absent", () => {
    expect(isVmwareToolsUnavailable(new Error("ShutdownGuest failed: SOAP error 500: Cannot complete operation because VMware Tools is not running in this virtual machine. | fault type: ToolsUnavailableFault"))).toBe(true)
    expect(isVmwareToolsUnavailable(new Error("ShutdownGuest failed: A general system error occurred: Undeclared fault"))).toBe(false)
    expect(isVmwareToolsUnavailable(new Error("ShutdownGuest failed: The operation is not allowed in the current state. | fault type: InvalidPowerStateFault"))).toBe(false)
  })

  it("recognises the XAPI error raised when the guest agent is absent", () => {
    expect(isXapiGuestAgentMissing(new Error("VM_LACKS_FEATURE_SHUTDOWN"))).toBe(true)
    expect(isXapiGuestAgentMissing(new Error("VM_LACKS_FEATURE"))).toBe(true)
    expect(isXapiGuestAgentMissing(new Error("OTHER_OPERATION_IN_PROGRESS"))).toBe(false)
    expect(isXapiGuestAgentMissing(new Error("TASK_CANCELLED"))).toBe(false)
  })
})
