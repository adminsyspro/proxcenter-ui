import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/proxmox/client", () => ({ pveFetch: vi.fn() }))

import { pveFetch } from "@/lib/proxmox/client"
import { waitForPveTask, getNodeIpForMigration } from "./pve-tasks"

const mockFetch = vi.mocked(pveFetch)
const conn = { baseUrl: "https://pve.example:8006", apiToken: "t", insecureDev: false, id: "c1" }

beforeEach(() => mockFetch.mockReset())

describe("waitForPveTask", () => {
  it("resolves when the task stops with exitstatus OK", async () => {
    mockFetch.mockResolvedValue({ status: "stopped", exitstatus: "OK" } as any)
    await expect(waitForPveTask(conn, "node1", "UPID:x", 10000)).resolves.toBeUndefined()
  })
  it("throws when the task fails", async () => {
    mockFetch.mockResolvedValue({ status: "stopped", exitstatus: "boom" } as any)
    await expect(waitForPveTask(conn, "node1", "UPID:x", 10000)).rejects.toThrow(/boom/)
  })
})

describe("getNodeIpForMigration", () => {
  it("prefers managedHost.sshAddress", async () => {
    const db = { managedHost: { findFirst: vi.fn().mockResolvedValue({ ip: "10.0.0.5", sshAddress: "10.0.0.9" }) } }
    await expect(getNodeIpForMigration(db, "c1", "node1", "https://h/")).resolves.toBe("10.0.0.9")
  })
  it("falls back to the baseUrl hostname", async () => {
    const db = { managedHost: { findFirst: vi.fn().mockResolvedValue(null) } }
    await expect(getNodeIpForMigration(db, "c1", "node1", "https://1.2.3.4:8006/")).resolves.toBe("1.2.3.4")
  })
})
