/** ui#1330: the duplicate check of the custom MACs, one grep on the target node. */
import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({ exec: vi.fn(), endpoint: vi.fn() }))
vi.mock("@/lib/ssh/exec", () => ({ executeSSH: (...a: any[]) => h.exec(...a) }))
vi.mock("@/lib/migration/pve-tasks", () => ({ getNodeSshEndpointForMigration: (...a: any[]) => h.endpoint(...a) }))

import { findTargetMacConflicts } from "./mac-conflicts"
import { GUEST_MACS_COMMAND } from "@/lib/sflow/guestMacs"

const target = { connectionId: "tgt", node: "pve1", baseUrl: "https://pve:8006" }

beforeEach(() => {
  h.exec.mockReset()
  h.endpoint.mockReset().mockResolvedValue({ host: "10.0.0.1", port: 22 })
})

describe("findTargetMacConflicts", () => {
  it("runs nothing when no custom MAC is set", async () => {
    expect(await findTargetMacConflicts({}, target, [])).toEqual({ ok: true, conflicts: [] })
    expect(h.exec).not.toHaveBeenCalled()
  })

  it("reports the MACs a VM or a container of the cluster already holds, whatever their case", async () => {
    h.exec.mockResolvedValue({ success: true, output: [
      "/etc/pve/nodes/pve2/qemu-server/104.conf:net0: virtio=BC:24:11:00:00:01,bridge=vmbr0",
      "/etc/pve/nodes/pve3/lxc/210.conf:net0: name=eth0,bridge=vmbr0,hwaddr=bc:24:11:00:00:02",
    ].join("\n") })
    const r = await findTargetMacConflicts({}, target, ["BC:24:11:00:00:01", "BC:24:11:00:00:02", "BC:24:11:00:00:03"])
    expect(r).toEqual({ ok: true, conflicts: [{ mac: "BC:24:11:00:00:01", vmid: 104 }, { mac: "BC:24:11:00:00:02", vmid: 210 }] })
    expect(h.exec).toHaveBeenCalledWith("tgt", { host: "10.0.0.1", port: 22 }, GUEST_MACS_COMMAND, 30_000, { readOnly: true })
  })

  it("fails when the node cannot be read", async () => {
    h.exec.mockResolvedValue({ success: false, error: "connection refused" })
    expect(await findTargetMacConflicts({}, target, ["BC:24:11:00:00:01"])).toEqual({ ok: false, error: "connection refused" })
    h.endpoint.mockRejectedValue(new Error("Cannot determine IP for node pve1"))
    expect(await findTargetMacConflicts({}, target, ["BC:24:11:00:00:01"])).toEqual({ ok: false, error: "Cannot determine IP for node pve1" })
  })
})
