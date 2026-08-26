import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { fetchWithInsecureTLS } from "@/lib/http/insecure-fetch"
import {
  CLEAN_SHUTDOWN_WATCH_MS,
  XapiError,
  type XapiSession,
  xapiCall,
  xapiCallAsync,
  xapiCleanShutdown,
  xapiDestroySnapshot,
  xapiFindSnapshotsByPrefix,
  xapiGetVmConfig,
  xapiListChangedBlocks,
  xapiLogin,
  xapiVdiExportUrl,
} from "./xapi-client"

vi.mock("@/lib/http/insecure-fetch", () => ({
  fetchWithInsecureTLS: vi.fn(),
}))

const fetchMock = vi.mocked(fetchWithInsecureTLS)
const session: XapiSession = {
  baseUrl: "https://xcp.test",
  insecureTLS: true,
  ref: "OpaqueRef:session",
}

function success(result: unknown): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { status: 200 })
}

function failure(message: string, data: unknown[] = []): Response {
  return new Response(JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    error: { code: 1, message, data },
  }), { status: 200 })
}

function requestAt(index: number): { method: string; params: unknown[] } {
  return JSON.parse(String((fetchMock.mock.calls[index][1] as RequestInit).body))
}

describe("xcpng/xapi-client", () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("logs in and normalizes the base URL to https", async () => {
    fetchMock.mockResolvedValueOnce(success("OpaqueRef:login"))

    await expect(xapiLogin("http://xcp.test/", "root", "secret", true)).resolves.toEqual({
      baseUrl: "https://xcp.test",
      insecureTLS: true,
      ref: "OpaqueRef:login",
    })
    expect(fetchMock).toHaveBeenCalledWith("https://xcp.test/jsonrpc", expect.any(Object))
  })

  it("retries login once against the pool master on HOST_IS_SLAVE", async () => {
    fetchMock
      .mockResolvedValueOnce(failure("HOST_IS_SLAVE", ["10.0.0.9"]))
      .mockResolvedValueOnce(success("OpaqueRef:master-session"))

    await expect(xapiLogin("10.0.0.8", "root", "secret", false)).resolves.toEqual({
      baseUrl: "https://10.0.0.9",
      insecureTLS: false,
      ref: "OpaqueRef:master-session",
    })
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "https://10.0.0.8/jsonrpc",
      "https://10.0.0.9/jsonrpc",
    ])
  })

  it("turns JSON-RPC errors into XapiError instances", async () => {
    fetchMock.mockResolvedValueOnce(failure("HANDLE_INVALID", ["VM", "OpaqueRef:bad"]))

    const error = await xapiLogin("xcp.test", "root", "secret", false).catch(value => value)

    expect(error).toBeInstanceOf(XapiError)
    expect(error).toMatchObject({ code: "HANDLE_INVALID", params: ["VM", "OpaqueRef:bad"] })
  })

  it("turns non-2xx JSON-RPC errors into XapiError instances", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      jsonrpc: "2.0",
      error: { code: 1, message: "SESSION_INVALID", data: ["OpaqueRef:x"] },
      id: 1,
    }), { status: 401 }))

    const error = await xapiCall(session, "VM.get_record", "OpaqueRef:vm").catch(value => value)

    expect(error).toBeInstanceOf(XapiError)
    expect(error).toMatchObject({ code: "SESSION_INVALID", params: ["OpaqueRef:x"] })
  })

  it("reports the HTTP status for a non-2xx non-JSON response", async () => {
    fetchMock.mockResolvedValueOnce(new Response("<html>bad gateway</html>", {
      status: 502,
      statusText: "Bad Gateway",
      headers: { "Content-Type": "text/html" },
    }))

    await expect(xapiCall(session, "VM.get_record", "OpaqueRef:vm")).rejects.toThrow("XAPI HTTP 502")
  })

  it("prepends the session ref to xapiCall params", async () => {
    fetchMock.mockResolvedValueOnce(success("OpaqueRef:vm"))

    await xapiCall(session, "VM.get_by_uuid", "vm-uuid")

    expect(requestAt(0)).toMatchObject({
      method: "VM.get_by_uuid",
      params: ["OpaqueRef:session", "vm-uuid"],
    })
  })

  it("polls an async task until success, strips value tags, and destroys it", async () => {
    vi.useFakeTimers()
    fetchMock
      .mockResolvedValueOnce(success("OpaqueRef:task"))
      .mockResolvedValueOnce(success({ status: "pending" }))
      .mockResolvedValueOnce(success({ status: "success", result: "<value>OpaqueRef:snapshot</value>" }))
      .mockResolvedValueOnce(success(null))

    const pending = xapiCallAsync(session, "VM.snapshot", ["OpaqueRef:vm", "snapshot"], { pollMs: 50 })
    await vi.advanceTimersByTimeAsync(50)

    await expect(pending).resolves.toBe("OpaqueRef:snapshot")
    expect(fetchMock.mock.calls.map((_, index) => requestAt(index).method)).toEqual([
      "Async.VM.snapshot",
      "task.get_record",
      "task.get_record",
      "task.destroy",
    ])
  })

  it("unwraps a nested XML-RPC string from an async task result", async () => {
    fetchMock
      .mockResolvedValueOnce(success("OpaqueRef:task"))
      .mockResolvedValueOnce(success({
        status: "success",
        result: "<value><string>OpaqueRef:0ca52163-07e8-8ce0-117b-75d58b9af95e</string></value>",
      }))
      .mockResolvedValueOnce(success(null))

    await expect(xapiCallAsync(session, "VM.snapshot", [])).resolves.toBe(
      "OpaqueRef:0ca52163-07e8-8ce0-117b-75d58b9af95e",
    )
  })

  it("cancels and destroys an async task when it times out", async () => {
    vi.useFakeTimers()
    fetchMock
      .mockResolvedValueOnce(success("OpaqueRef:task"))
      .mockResolvedValueOnce(success({ status: "pending" }))
      .mockResolvedValueOnce(success(null))
      .mockResolvedValueOnce(success(null))

    const pending = xapiCallAsync(session, "VM.snapshot", [], { timeoutMs: 5000, pollMs: 5000 })
    const rejection = expect(pending).rejects.toThrow("timed out")
    await vi.advanceTimersByTimeAsync(5000)

    await rejection
    expect(fetchMock.mock.calls.map((_, index) => requestAt(index).method)).toEqual([
      "Async.VM.snapshot",
      "task.get_record",
      "task.cancel",
      "task.destroy",
    ])
  })

  it("throws task error_info as XapiError and destroys the task", async () => {
    fetchMock
      .mockResolvedValueOnce(success("OpaqueRef:task"))
      .mockResolvedValueOnce(success({ status: "failure", error_info: ["SR_BACKEND_FAILURE", "disk full"] }))
      .mockResolvedValueOnce(success(null))

    const error = await xapiCallAsync(session, "VM.snapshot", []).catch(value => value)

    expect(error).toBeInstanceOf(XapiError)
    expect(error).toMatchObject({ code: "SR_BACKEND_FAILURE", params: ["disk full"] })
    expect(requestAt(2)).toMatchObject({ method: "task.destroy", params: [session.ref, "OpaqueRef:task"] })
  })

  it("clean shutdown: returns without cancelling or destroying a task still pending after the watch window", async () => {
    vi.useFakeTimers()
    fetchMock.mockResolvedValueOnce(success("OpaqueRef:task"))
    fetchMock.mockImplementation(async () => success({ status: "pending" }))

    const pending = xapiCleanShutdown(session, "OpaqueRef:vm")
    await vi.advanceTimersByTimeAsync(CLEAN_SHUTDOWN_WATCH_MS + 2000)

    await expect(pending).resolves.toBeUndefined()
    const methods = fetchMock.mock.calls.map((_, index) => requestAt(index).method)
    expect(methods[0]).toBe("Async.VM.clean_shutdown")
    expect(methods.slice(1).every(m => m === "task.get_record")).toBe(true)
    expect(methods.length).toBeGreaterThan(2)
    expect(methods).not.toContain("task.cancel")
    expect(methods).not.toContain("task.destroy")
  })

  it("clean shutdown: throws the task error_info as XapiError when the guest refuses", async () => {
    fetchMock
      .mockResolvedValueOnce(success("OpaqueRef:task"))
      .mockResolvedValueOnce(success({ status: "failure", error_info: ["VM_LACKS_FEATURE_SHUTDOWN", "OpaqueRef:vm"] }))
      .mockResolvedValueOnce(success(null))

    const error = await xapiCleanShutdown(session, "OpaqueRef:vm").catch(value => value)

    expect(error).toBeInstanceOf(XapiError)
    expect(error).toMatchObject({ code: "VM_LACKS_FEATURE_SHUTDOWN", params: ["OpaqueRef:vm"] })
  })

  it("clean shutdown: destroys the task once it succeeds and stops early when asked to abort", async () => {
    fetchMock
      .mockResolvedValueOnce(success("OpaqueRef:task"))
      .mockResolvedValueOnce(success({ status: "success", result: "<value></value>" }))
      .mockResolvedValueOnce(success(null))
    await expect(xapiCleanShutdown(session, "OpaqueRef:vm")).resolves.toBeUndefined()
    expect(fetchMock.mock.calls.map((_, index) => requestAt(index).method)).toEqual([
      "Async.VM.clean_shutdown",
      "task.get_record",
      "task.destroy",
    ])

    fetchMock.mockReset()
    fetchMock.mockResolvedValueOnce(success("OpaqueRef:task"))
    await expect(xapiCleanShutdown(session, "OpaqueRef:vm", { shouldAbort: () => true })).resolves.toBeUndefined()
    expect(fetchMock.mock.calls.map((_, index) => requestAt(index).method)).toEqual(["Async.VM.clean_shutdown"])
  })

  it("builds the VDI export URL with raw OpaqueRefs", () => {
    expect(xapiVdiExportUrl(session, "OpaqueRef:0ca52163-07e8-8ce0-117b-75d58b9af95e", "raw")).toBe(
      "https://xcp.test/export_raw_vdi?session_id=OpaqueRef:session&vdi=OpaqueRef:0ca52163-07e8-8ce0-117b-75d58b9af95e&format=raw",
    )
  })

  it("decodes the bitmap returned by VDI.list_changed_blocks", async () => {
    fetchMock.mockResolvedValueOnce(success(Buffer.from([0xc0]).toString("base64")))

    await expect(xapiListChangedBlocks(session, "OpaqueRef:base", "OpaqueRef:next", 10 * 65536)).resolves.toEqual([
      { offset: 0, length: 2 * 65536 },
    ])
    expect(requestAt(0)).toMatchObject({
      method: "VDI.list_changed_blocks",
      params: [session.ref, "OpaqueRef:base", "OpaqueRef:next"],
    })
  })

  it("detaches a control domain VBD and retries VDI.destroy after VDI_IN_USE", async () => {
    vi.useFakeTimers()
    fetchMock
      .mockResolvedValueOnce(success({ uuid: "snap-uuid", name_label: "snapshot", VBDs: ["OpaqueRef:snap-vbd"] }))
      .mockResolvedValueOnce(success({ type: "Disk", empty: false, VDI: "OpaqueRef:snap-vdi", userdevice: "0" }))
      .mockResolvedValueOnce(success({ uuid: "vdi-uuid", snapshot_of: "OpaqueRef:source", virtual_size: 1024 }))
      .mockResolvedValueOnce(failure("VDI_IN_USE", ["OpaqueRef:snap-vdi"]))
      .mockResolvedValueOnce(success(["OpaqueRef:dom0-vbd"]))
      .mockResolvedValueOnce(success("OpaqueRef:dom0"))
      .mockResolvedValueOnce(success(true))
      .mockResolvedValueOnce(success(null))
      .mockResolvedValueOnce(success(null))
      .mockResolvedValueOnce(success(null))
      .mockResolvedValueOnce(success(null))

    const pending = xapiDestroySnapshot(session, "OpaqueRef:snapshot")
    await vi.advanceTimersByTimeAsync(2000)
    await pending

    const methods = fetchMock.mock.calls.map((_, index) => requestAt(index).method)
    expect(methods.filter(method => method === "VDI.destroy")).toHaveLength(2)
    expect(methods).toContain("VBD.unplug")
    expect(methods).toContain("VBD.destroy")
    expect(methods.at(-1)).toBe("VM.destroy")
  })

  it("rethrows non-HANDLE_INVALID errors while describing a snapshot", async () => {
    fetchMock.mockResolvedValueOnce(failure("SESSION_INVALID", [session.ref]))

    const error = await xapiDestroySnapshot(session, "OpaqueRef:snapshot").catch(value => value)

    expect(error).toBeInstanceOf(XapiError)
    expect(error).toMatchObject({ code: "SESSION_INVALID", params: [session.ref] })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("returns silently when the snapshot VM record is already gone", async () => {
    fetchMock.mockResolvedValueOnce(failure("HANDLE_INVALID", ["VM", "OpaqueRef:snapshot"]))

    await expect(xapiDestroySnapshot(session, "OpaqueRef:snapshot")).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("continues destroying a snapshot after one VDI exhausts its retries", async () => {
    vi.useFakeTimers()
    fetchMock
      .mockResolvedValueOnce(success({
        uuid: "snap-uuid",
        name_label: "snapshot",
        VBDs: ["OpaqueRef:vbd-1", "OpaqueRef:vbd-2"],
      }))
      .mockResolvedValueOnce(success({ type: "Disk", empty: false, VDI: "OpaqueRef:vdi-1", userdevice: "0" }))
      .mockResolvedValueOnce(success({ uuid: "vdi-uuid-1", snapshot_of: "OpaqueRef:source-1", virtual_size: 1024 }))
      .mockResolvedValueOnce(success({ type: "Disk", empty: false, VDI: "OpaqueRef:vdi-2", userdevice: "1" }))
      .mockResolvedValueOnce(success({ uuid: "vdi-uuid-2", snapshot_of: "OpaqueRef:source-2", virtual_size: 2048 }))
      .mockResolvedValueOnce(failure("VDI_IN_USE", ["OpaqueRef:vdi-1"]))
      .mockResolvedValueOnce(success([]))
      .mockResolvedValueOnce(failure("VDI_IN_USE", ["OpaqueRef:vdi-1"]))
      .mockResolvedValueOnce(success([]))
      .mockResolvedValueOnce(failure("VDI_IN_USE", ["OpaqueRef:vdi-1"]))
      .mockResolvedValueOnce(success([]))
      .mockResolvedValueOnce(failure("VDI_IN_USE", ["OpaqueRef:vdi-1"]))
      .mockResolvedValueOnce(success([]))
      .mockResolvedValueOnce(failure("VDI_IN_USE", ["OpaqueRef:vdi-1"]))
      .mockResolvedValueOnce(success(null))
      .mockResolvedValueOnce(success(null))

    const pending = xapiDestroySnapshot(session, "OpaqueRef:snapshot")
    const rejection = expect(pending).rejects.toThrow("partially destroyed")
    for (let retry = 0; retry < 4; retry++) await vi.advanceTimersByTimeAsync(2000)

    await rejection
    const calls = fetchMock.mock.calls.map((_, index) => requestAt(index))
    expect(calls.filter(call => call.method === "VDI.destroy" && call.params.at(-1) === "OpaqueRef:vdi-1")).toHaveLength(5)
    expect(calls).toContainEqual(expect.objectContaining({
      method: "VDI.destroy",
      params: [session.ref, "OpaqueRef:vdi-2"],
    }))
    expect(calls).toContainEqual(expect.objectContaining({
      method: "VM.destroy",
      params: [session.ref, "OpaqueRef:snapshot"],
    }))
  })

  it("rejects when a snapshot name label cannot be read", async () => {
    fetchMock
      .mockResolvedValueOnce(success(["OpaqueRef:snapshot"]))
      .mockResolvedValueOnce(failure("SESSION_INVALID", [session.ref]))

    await expect(xapiFindSnapshotsByPrefix(session, "OpaqueRef:vm", "backup-")).rejects.toMatchObject({
      code: "SESSION_INVALID",
    })
  })

  it("maps a VM record and skips CD VBDs", async () => {
    fetchMock
      .mockResolvedValueOnce(success("OpaqueRef:vm"))
      .mockResolvedValueOnce(success({
        uuid: "vm-uuid",
        name_label: "Test VM",
        power_state: "Halted",
        VCPUs_at_startup: "2",
        VCPUs_max: "4",
        memory_static_max: 4294967296,
        HVM_boot_params: { firmware: "uefi" },
        HVM_boot_policy: "BIOS order",
        guest_metrics: "OpaqueRef:NULL",
        tags: ["production"],
        snapshots: [],
        VBDs: ["OpaqueRef:disk-vbd", "OpaqueRef:cd-vbd"],
        VIFs: [],
      }))
      .mockResolvedValueOnce(success({
        type: "Disk",
        empty: false,
        VDI: "OpaqueRef:vdi",
        userdevice: "0",
      }))
      .mockResolvedValueOnce(success({
        uuid: "vdi-uuid",
        name_label: "Root disk",
        virtual_size: 4294967296,
        SR: "OpaqueRef:sr",
      }))
      .mockResolvedValueOnce(success({ uuid: "sr-uuid", type: "nfs" }))
      .mockResolvedValueOnce(success({ type: "CD", empty: false, VDI: "OpaqueRef:iso", userdevice: "3" }))

    await expect(xapiGetVmConfig(session, "vm-uuid")).resolves.toMatchObject({
      uuid: "vm-uuid",
      name: "Test VM",
      memoryMB: 4096,
      firmware: "uefi",
      disks: [{
        position: 0,
        vdiRef: "OpaqueRef:vdi",
        vdiUuid: "vdi-uuid",
        srType: "nfs",
        srUuid: "sr-uuid",
      }],
    })
    const methods = fetchMock.mock.calls.map((_, index) => requestAt(index).method)
    expect(methods.filter(method => method === "VDI.get_record")).toHaveLength(1)
  })
})
