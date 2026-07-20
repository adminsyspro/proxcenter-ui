import { afterEach, describe, expect, it, vi } from "vitest"

import { deleteSnapshotsSequential } from "./deleteSnapshotsSequential"

afterEach(() => vi.restoreAllMocks())

function okResponse() {
  return { ok: true, json: async () => ({ data: { success: true } }) } as unknown as Response
}
function errResponse(msg: string) {
  return { ok: false, json: async () => ({ error: msg }) } as unknown as Response
}

describe("deleteSnapshotsSequential", () => {
  it("deletes all snapshots in order, reporting running then done for each", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(okResponse())
    const events: string[] = []
    const res = await deleteSnapshotsSequential("c:qemu:pve1:100", ["a", "b"], (n, s) => events.push(`${n}:${s}`))
    expect(res.ok).toBe(true)
    expect(events).toEqual(["a:running", "a:done", "b:running", "b:done"])
    // wait=1 flag is passed
    expect(String(fetchSpy.mock.calls[0][0])).toContain("wait=1")
    expect(String(fetchSpy.mock.calls[0][0])).toContain("name=a")
  })

  it("stops at the first failure and reports it", async () => {
    const fetchSpy = vi.spyOn(global, "fetch")
      .mockResolvedValueOnce(okResponse())
      .mockResolvedValueOnce(errResponse("merge failed"))
    const events: string[] = []
    const res = await deleteSnapshotsSequential("c:qemu:pve1:100", ["a", "b", "c"], (n, s, e) =>
      events.push(`${n}:${s}${e ? `(${e})` : ""}`))
    expect(res.ok).toBe(false)
    expect(res.failed).toBe("b")
    expect(res.error).toMatch(/merge failed/)
    // "c" is never attempted
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(events).toContain("b:failed(merge failed)")
    expect(events.some(e => e.startsWith("c:"))).toBe(false)
  })
})
