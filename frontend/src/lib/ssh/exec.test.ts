import { describe, it, expect, vi, afterEach } from "vitest"

// Mock the ssh2 Client so executeSSHDirect can be driven end-to-end without a
// real network/host. A tiny event-emitter stands in for both the connection and
// its exec stream; tests emit data/close/error to exercise every settle path.
const h = vi.hoisted(() => {
  type Handler = (...a: any[]) => void
  class Emitter {
    private m = new Map<string, Handler[]>()
    on(e: string, fn: Handler) { const l = this.m.get(e) ?? []; l.push(fn); this.m.set(e, l); return this }
    emit(e: string, ...a: any[]) { for (const fn of this.m.get(e) ?? []) fn(...a) }
  }
  class FakeStream extends Emitter { stderr = new Emitter() }
  const clients: any[] = []
  const state = { failExec: false }
  class Client extends Emitter {
    _stream: FakeStream | null = null
    _cfg: any = null
    exec(_cmd: string, cb: (e: Error | null, s?: FakeStream) => void) {
      if (state.failExec) { queueMicrotask(() => cb(new Error("exec denied"))); return }
      this._stream = new FakeStream()
      queueMicrotask(() => cb(null, this._stream!))
    }
    connect(cfg: any) { this._cfg = cfg; clients.push(this); queueMicrotask(() => this.emit("ready")) }
    end() {}
  }
  return { clients, state, Client, FakeStream }
})
vi.mock("ssh2", () => ({ Client: h.Client }))

import { buildConnectConfig, isOrchestratorTimeoutError, createInactivityTimer, executeSSHDirect } from "./exec"

const flush = () => new Promise<void>((r) => setTimeout(r, 0))

describe("buildConnectConfig", () => {
  it("always enables SSH keepalive so a long idle copy's channel is kept alive and a dead link is detected (#445)", () => {
    const cfg = buildConnectConfig({ host: "10.0.0.1", port: 22, user: "root" })
    expect(typeof cfg.keepaliveInterval).toBe("number")
    expect(cfg.keepaliveInterval as number).toBeGreaterThan(0)
    expect(cfg.keepaliveCountMax as number).toBeGreaterThan(0)
    expect(cfg.host).toBe("10.0.0.1")
    expect(cfg.port).toBe(22)
    expect(cfg.username).toBe("root")
    expect(typeof cfg.hostVerifier).toBe("function")
  })

  it("uses the private key (and passphrase) when a key is provided", () => {
    const cfg = buildConnectConfig({ host: "h", port: 22, user: "root", key: "KEY", passphrase: "PP" })
    expect(cfg.privateKey).toBe("KEY")
    expect(cfg.passphrase).toBe("PP")
    expect(cfg.password).toBeUndefined()
  })

  it("uses the password (and enables keyboard-interactive) when only a password is provided", () => {
    const cfg = buildConnectConfig({ host: "h", port: 22, user: "root", password: "PW" })
    expect(cfg.password).toBe("PW")
    expect(cfg.tryKeyboard).toBe(true)
    expect(cfg.privateKey).toBeUndefined()
  })
})

describe("isOrchestratorTimeoutError", () => {
  it("treats AbortSignal.timeout aborts (TimeoutError/AbortError) as a timeout, so we never silently re-run the command over ssh2 (#445)", () => {
    expect(isOrchestratorTimeoutError({ name: "TimeoutError" })).toBe(true)
    expect(isOrchestratorTimeoutError({ name: "AbortError" })).toBe(true)
  })

  it("treats a genuine connection failure as NOT a timeout (so we DO fall back to ssh2)", () => {
    expect(isOrchestratorTimeoutError({ name: "TypeError", message: "fetch failed" })).toBe(false)
    expect(isOrchestratorTimeoutError(new Error("ECONNREFUSED"))).toBe(false)
    expect(isOrchestratorTimeoutError(null)).toBe(false)
    expect(isOrchestratorTimeoutError(undefined)).toBe(false)
  })
})

describe("createInactivityTimer", () => {
  afterEach(() => vi.useRealTimers())

  it("fires once after the interval elapses with no activity", () => {
    vi.useFakeTimers()
    const onFire = vi.fn()
    createInactivityTimer(1000, onFire)
    vi.advanceTimersByTime(999)
    expect(onFire).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onFire).toHaveBeenCalledTimes(1)
  })

  it("bump() resets the countdown so a steadily-progressing copy never fires", () => {
    vi.useFakeTimers()
    const onFire = vi.fn()
    const t = createInactivityTimer(1000, onFire)
    vi.advanceTimersByTime(900); t.bump()
    vi.advanceTimersByTime(900); t.bump()
    vi.advanceTimersByTime(900)
    expect(onFire).not.toHaveBeenCalled()
    vi.advanceTimersByTime(100)
    expect(onFire).toHaveBeenCalledTimes(1)
  })

  it("clear() cancels the timer", () => {
    vi.useFakeTimers()
    const onFire = vi.fn()
    const t = createInactivityTimer(1000, onFire)
    vi.advanceTimersByTime(500); t.clear()
    vi.advanceTimersByTime(5000)
    expect(onFire).not.toHaveBeenCalled()
  })
})

describe("executeSSHDirect (ssh2 wiring)", () => {
  afterEach(() => { h.clients.length = 0; h.state.failExec = false })

  it("applies keepalive to the connect config and resolves success with trimmed output, streaming chunks to onData", async () => {
    const chunks: string[] = []
    const p = executeSSHDirect({ host: "10.0.0.9", port: 22, user: "root", password: "pw", command: "dd …", onData: (c) => chunks.push(c) })
    await flush()
    const c = h.clients.at(-1)!
    expect((c._cfg.keepaliveInterval as number)).toBeGreaterThan(0)
    expect((c._cfg.keepaliveCountMax as number)).toBeGreaterThan(0)
    c._stream!.emit("data", Buffer.from("1073741824 bytes copied, 10 s, 107 MB/s\n"))
    c._stream!.stderr.emit("data", Buffer.from("  "))
    c._stream!.emit("close", 0)
    const r = await p
    expect(r.success).toBe(true)
    expect(r.output).toContain("1073741824 bytes")
    expect(chunks.join("")).toContain("1073741824 bytes")
  })

  it("reports a non-zero exit as failure while preserving stdout (2>&1 diagnostics)", async () => {
    const p = executeSSHDirect({ host: "h", port: 22, user: "root", password: "pw", command: "x" })
    await flush()
    const c = h.clients.at(-1)!
    c._stream!.emit("data", Buffer.from("No space left on device"))
    c._stream!.emit("close", 1)
    const r = await p
    expect(r.success).toBe(false)
    expect(r.error).toContain("Exit code 1")
    expect(r.output).toContain("No space left on device")
  })

  it("fails fast with an inactivity error when output stops, instead of hanging to the absolute cap (#445)", async () => {
    const p = executeSSHDirect({ host: "h", port: 22, user: "root", password: "pw", command: "x", timeoutMs: 60_000, inactivityMs: 120 })
    await flush()
    const r = await p
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/inactivity/i)
  })

  it("resolves with the error when ssh2 emits a connection error", async () => {
    const p = executeSSHDirect({ host: "h", port: 22, user: "root", key: "K", command: "x" })
    await flush()
    h.clients.at(-1)!.emit("error", new Error("ECONNRESET"))
    const r = await p
    expect(r.success).toBe(false)
    expect(r.error).toContain("ECONNRESET")
  })

  it("falls back to the absolute cap when neither close nor inactivity fires", async () => {
    const p = executeSSHDirect({ host: "h", port: 22, user: "root", password: "pw", command: "x", timeoutMs: 100 })
    await flush()
    // never emit data or close → only the absolute cap can settle it
    const r = await p
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/SSH connection timeout/i)
  })

  it("resolves with the exec error when the channel cannot be opened", async () => {
    h.state.failExec = true
    const p = executeSSHDirect({ host: "h", port: 22, user: "root", password: "pw", command: "x" })
    await flush()
    const r = await p
    expect(r.success).toBe(false)
    expect(r.error).toContain("exec denied")
  })

  it("answers keyboard-interactive auth with the password (ESXi-style hosts)", async () => {
    const p = executeSSHDirect({ host: "h", port: 22, user: "root", password: "sekret", command: "x" })
    await flush()
    const c = h.clients.at(-1)!
    const answer = vi.fn()
    c.emit("keyboard-interactive", "n", "i", "l", [{ prompt: "Password:" }], answer)
    expect(answer).toHaveBeenCalledWith(["sekret"])
    c._stream!.emit("close", 0)
    await p
  })

  it("answers keyboard-interactive with no responses when there is no password", async () => {
    const p = executeSSHDirect({ host: "h", port: 22, user: "root", key: "KEY", command: "x" })
    await flush()
    const c = h.clients.at(-1)!
    const answer = vi.fn()
    c.emit("keyboard-interactive", "n", "i", "l", [{ prompt: "Password:" }], answer)
    expect(answer).toHaveBeenCalledWith([])
    c._stream!.emit("close", 0)
    await p
  })
})
