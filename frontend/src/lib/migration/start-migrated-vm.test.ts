import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/proxmox/client", () => ({ pveFetch: vi.fn() }))

import { pveFetch } from "@/lib/proxmox/client"
import { startMigratedVm } from "./start-migrated-vm"

const conn = { baseUrl: "https://fr6-pve-lb.example.com:8006", apiToken: "t" }
const log = vi.fn(async () => {})

beforeEach(() => {
  vi.mocked(pveFetch).mockReset()
  log.mockClear()
})

describe("startMigratedVm (discussion #1363)", () => {
  it("starts the VM and logs the caller's success line", async () => {
    vi.mocked(pveFetch).mockResolvedValue("UPID:start" as any)

    await expect(startMigratedVm({ conn, node: "pve 2", vmid: 147, log, startedMessage: "Target VM started" })).resolves.toBe(true)

    expect(pveFetch).toHaveBeenCalledWith(conn, "/nodes/pve%202/qemu/147/status/start", { method: "POST" })
    expect(log.mock.calls).toEqual([["Target VM started", "success"]])
  })

  it("keeps a finished migration completed when the start fails, and says how to start the VM", async () => {
    vi.mocked(pveFetch).mockRejectedValue(new Error("getaddrinfo EAI_AGAIN fr6-pve-lb.example.com"))

    await expect(startMigratedVm({ conn, node: "pve2", vmid: 147, log, startedMessage: "VM started" })).resolves.toBe(false)

    expect(log).toHaveBeenCalledTimes(1)
    const [msg, level] = log.mock.calls[0] as unknown as [string, string]
    expect(level).toBe("warn")
    expect(msg).toContain("getaddrinfo EAI_AGAIN fr6-pve-lb.example.com")
    expect(msg).toContain("VM 147")
    expect(msg).toContain("pve2")
  })

  it("still resolves when the warning itself cannot be written", async () => {
    vi.mocked(pveFetch).mockRejectedValue("boom")
    log.mockRejectedValueOnce(new Error("db down"))

    await expect(startMigratedVm({ conn, node: "pve2", vmid: 1, log, startedMessage: "VM started" })).resolves.toBe(false)
  })
})
