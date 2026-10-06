import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/proxmox/client", () => ({ pveFetch: vi.fn() }))

import { pveFetch } from "@/lib/proxmox/client"
import { waitForPveTask, getNodeSshEndpointForMigration } from "./pve-tasks"

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

describe("getNodeSshEndpointForMigration", () => {
  const db = (host: any, sshPort: number | null) => ({
    managedHost: { findFirst: vi.fn().mockResolvedValue(host) },
    connection: { findUnique: vi.fn().mockResolvedValue({ sshPort }) },
  })

  it("takes the node override address and port", async () => {
    await expect(getNodeSshEndpointForMigration(db({ ip: "10.0.0.5", sshAddress: "203.0.113.10", sshPort: 2201 }, 22), "c1", "pve1", "https://h/"))
      .resolves.toEqual({ host: "203.0.113.10", port: 2201, source: "override" })
  })

  it("falls back to the stored IP and the connection port", async () => {
    await expect(getNodeSshEndpointForMigration(db({ ip: "10.0.0.5", sshAddress: null, sshPort: null }, 2222), "c1", "pve1", "https://h/"))
      .resolves.toEqual({ host: "10.0.0.5", port: 2222, source: "proxmox" })
  })

  it("falls back to the baseUrl hostname and port 22", async () => {
    await expect(getNodeSshEndpointForMigration(db(null, null), "c1", "pve1", "https://1.2.3.4:8006/"))
      .resolves.toEqual({ host: "1.2.3.4", port: 22, source: "proxmox" })
  })
})
