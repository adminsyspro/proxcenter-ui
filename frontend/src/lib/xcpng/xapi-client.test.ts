import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { fetchWithInsecureTLS } from "@/lib/http/insecure-fetch"
import {
  XapiError,
  type XapiSession,
  xapiCall,
  xapiCallAsync,
  xapiDestroySnapshot,
  xapiGetVmConfig,
  xapiListChangedBlocks,
  xapiLogin,
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
