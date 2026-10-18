import { describe, expect, it } from "vitest"

import { hostDrainGuestStatus, hostDrainJobRows, hostDrainParentId, hostDrainStatus, isHostDrainGuestRow } from "./hostDrainRows"

const resolve = (id?: string | null) => (id === "c1" ? "pve1.lab" : "unknown")

const drain = (over: Record<string, any> = {}) => ({
  id: "d-1",
  connection_id: "c1",
  node: "pve3",
  status: "partial",
  total_guests: 3,
  completed_guests: 1,
  failed_guests: 1,
  skipped_guests: 1,
  maintenance_enabled: true,
  created_at: "2026-10-14T08:00:00Z",
  started_at: "2026-10-14T08:00:01Z",
  completed_at: "2026-10-14T08:05:00Z",
  error: "2 guest(s) still on pve3: 100 (Debian13), 92483 (i248-ct)",
  guests: [
    { vmid: 92481, name: "i248-nonha", type: "qemu", status: "completed", mode: "live", target_node: "pve1", reason: "best_fit", started_at: "2026-10-14T08:00:02Z", completed_at: "2026-10-14T08:00:40Z" },
    { vmid: 100, name: "Debian13", type: "qemu", status: "skipped", mode: "", reason: "guest is locked (backup)" },
    { vmid: 92483, name: "i248-ct", type: "lxc", status: "failed", mode: "restart", target_node: "pve2", error: "task failed: boom", failure_reason: "boom" },
  ],
  ...over,
})

describe("hostDrainJobRows", () => {
  it("emits the drain row and one row per guest", () => {
    const rows = hostDrainJobRows([drain()], resolve)

    expect(rows).toHaveLength(4)
    const [parent, moved, locked, ct] = rows

    expect(parent).toMatchObject({ id: "d-1", type: "host_drain", status: "failed", progress: 100, target: "pve1.lab" })
    expect(parent.detail).toBe("pve3: 1/3 guest(s) moved, 2 still on pve3")
    expect(parent.metadata.remaining).toEqual([
      { vmid: 100, name: "Debian13", type: "qemu", reason: "guest is locked (backup)" },
      { vmid: 92483, name: "i248-ct", type: "lxc", reason: "task failed: boom" },
    ])
    expect(parent.metadata.maintenanceEnabled).toBe(true)

    expect(moved).toMatchObject({ id: "d-1#vm92481", status: "success", progress: 100, name: "Host drain - VM 92481 (i248-nonha)" })
    expect(moved.detail).toBe("pve3 → pve1 (live)")
    expect(moved.metadata).toMatchObject({ drainId: "d-1", vmid: 92481, targetNode: "pve1", connectionId: "c1" })

    expect(locked).toMatchObject({ status: "failed" })
    expect(locked.detail).toBe("pve3 → ? • guest is locked (backup)")

    expect(ct).toMatchObject({ status: "failed", name: "Host drain - CT 92483 (i248-ct)" })
    expect(ct.detail).toBe("pve3 → pve2 (restart) • boom")
  })

  it("reports progress from the settled guests while running", () => {
    const rows = hostDrainJobRows([drain({ status: "running", completed_guests: 1, failed_guests: 0, skipped_guests: 1, completed_at: undefined, error: undefined })], resolve)

    expect(rows[0]).toMatchObject({ status: "running", progress: 67, detail: "pve3: 1/3 guest(s) moved" })
  })

  it("does not count a guest kept on purpose as remaining", () => {
    const rows = hostDrainJobRows([drain({ status: "completed", completed_guests: 1, failed_guests: 0, skipped_guests: 1, error: undefined, guests: [
      { vmid: 1, name: "a", type: "qemu", status: "completed", mode: "live", target_node: "pve1" },
      { vmid: 2, name: "b", type: "qemu", status: "skipped", kept: true, reason: "stopped guest left in place" },
    ] })], resolve)

    expect(rows[0]).toMatchObject({ status: "success", progress: 100, detail: "pve3: 1/3 guest(s) moved" })
    expect(rows[0].metadata.remaining).toEqual([])
  })

  it("labels an HA guest waiting for ha-manager", () => {
    const rows = hostDrainJobRows([drain({ guests: [{ vmid: 92482, name: "i248-ha", type: "qemu", status: "migrating", mode: "ha" }] })], resolve)

    expect(rows[1]).toMatchObject({ status: "running", detail: "pve3 → HA (ha)" })
  })

  it("ignores rows without an id and non-arrays", () => {
    expect(hostDrainJobRows([{}, null], resolve)).toEqual([])
    expect(hostDrainJobRows(undefined as any, resolve)).toEqual([])
  })
})

describe("status mapping and ids", () => {
  it("maps the drain statuses onto the Task Center vocabulary", () => {
    expect(hostDrainStatus("completed")).toBe("success")
    expect(hostDrainStatus("partial")).toBe("failed")
    expect(hostDrainStatus("cancelled")).toBe("cancelled")
    expect(hostDrainStatus("pending")).toBe("pending")
    expect(hostDrainStatus("running")).toBe("running")
  })

  it("maps the guest statuses", () => {
    expect(hostDrainGuestStatus("completed")).toBe("success")
    expect(hostDrainGuestStatus("skipped")).toBe("failed")
    expect(hostDrainGuestStatus("migrating")).toBe("running")
    expect(hostDrainGuestStatus("pending")).toBe("pending")
  })

  it("tells a guest row from the drain row", () => {
    expect(isHostDrainGuestRow("d-1#vm100")).toBe(true)
    expect(isHostDrainGuestRow("d-1")).toBe(false)
    expect(hostDrainParentId("d-1#vm100")).toBe("d-1")
    expect(hostDrainParentId("d-1")).toBe("d-1")
  })
})
