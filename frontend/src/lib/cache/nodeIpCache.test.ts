import { describe, it, expect, beforeEach } from "vitest"

import { getFailoverLock, setFailoverLock } from "./nodeIpCache"

beforeEach(() => {
  delete (globalThis as any).__proxcenter_failover_lock__
})

describe("setFailoverLock", () => {
  it("exposes the lock until its promise resolves, then clears it", async () => {
    let resolve!: (v: string | null) => void
    const p = new Promise<string | null>(r => { resolve = r })
    setFailoverLock("conn-1", p)
    expect(getFailoverLock("conn-1")).toBe(p)
    resolve("https://10.42.0.102:8006")
    await expect(p).resolves.toBe("https://10.42.0.102:8006")
    await Promise.resolve()
    expect(getFailoverLock("conn-1")).toBeNull()
  })

  it("does not remove a newer lock set while the old one was pending", async () => {
    let resolveOld!: (v: string | null) => void
    const oldP = new Promise<string | null>(r => { resolveOld = r })
    const newP = new Promise<string | null>(() => {})
    setFailoverLock("conn-3", oldP)
    setFailoverLock("conn-3", newP)
    resolveOld(null)
    await oldP
    await Promise.resolve()
    expect(getFailoverLock("conn-3")).toBe(newP)
  })
})
