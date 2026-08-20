/**
 * First unit coverage for the PVE client (issue #742).
 *
 * Four things are locked here:
 *
 *  1. `classifyPveError`, which decides whether a failed request counts
 *     towards the failover circuit breaker. The class boundary that matters
 *     is REACHABILITY: a refused connection or a connect-phase timeout proves
 *     the host is unreachable, while a slow answer, a caller cancellation or
 *     an HTTP error all prove the opposite (the handshake completed). The
 *     predicate order is part of the contract, so the priority cases below
 *     are as important as the per-class ones: an abort raised by the caller
 *     must never be counted as a dead node.
 *
 *  2. `PveApplicationError`, the answer we received and rejected. It is
 *     matched BEFORE the substring predicates, which is what stops a PVE body
 *     quoting a backend errno (a dead PBS or NFS target, the setting of #742)
 *     from being read as an unreachable host.
 *
 *  3. `isFailoverWorthy`, the pure rule the circuit breaker applies to a
 *     class. This is where the #742 fix lives: a response timeout counts only
 *     when the caller did NOT ask for a longer budget.
 *
 *  4. The two exported timeout budgets, which are read from the environment
 *     ONCE at module load. Every budget test therefore re-imports the module
 *     after mutating `process.env`.
 *
 * The last block drives `pveFetch` against a real local server that never
 * answers, which is the only way to observe the strict `hasLongBudget`
 * comparison without mocking the transport.
 *
 * The shapes asserted here are not invented: the "real platform error" cases
 * use the objects Node 26 / undici 7 actually produce (verified against a
 * hanging local server), so a transport upgrade that changes them fails here.
 */

import type { Server } from "node:http"
import type { AddressInfo } from "node:net"

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { errors as undiciErrors } from "undici"

import { classifyPveError, isFailoverWorthy, PveApplicationError, type PveErrorClass } from "./client"
import { isVmConfigNotFoundError } from "./locateVm"

// client.ts pulls `invalidateConnectionCache` from the connections module,
// which drags Prisma and next-auth in behind it. These tests are pure logic,
// so the import is stubbed to keep the suite DB-free and fast.
vi.mock("../connections/getConnection", () => ({
  invalidateConnectionCache: vi.fn(),
}))

/** Builds an Error carrying arbitrary transport-style properties. */
function errorWith(props: Record<string, unknown>, message = "request failed"): Error {
  return Object.assign(new Error(message), props)
}

const HARD_CODES = ["ECONNREFUSED", "EHOSTUNREACH", "ECONNRESET", "ENETUNREACH", "ENOTFOUND"] as const

describe("classifyPveError", () => {
  describe("hard network failures", () => {
    // The predicate reads three channels: the message, `err.code` and
    // `err.cause.code`. Node surfaces the same condition on any of them
    // depending on whether the error came from the socket, from undici or
    // from a wrapper, so all three are covered for every code.
    it.each(HARD_CODES)("classifies %s carried by the message", code => {
      expect(classifyPveError(new Error(`connect ${code} 10.0.0.9:8006`))).toBe("hard-network")
    })

    it.each(HARD_CODES)("classifies %s carried by err.code", code => {
      expect(classifyPveError(errorWith({ code }))).toBe("hard-network")
    })

    it.each(HARD_CODES)("classifies %s carried by err.cause.code", code => {
      expect(classifyPveError(errorWith({ cause: { code } }, "fetch failed"))).toBe("hard-network")
    })

    it("falls back to the cause message when the cause carries no code", () => {
      const err = errorWith({ cause: new Error("getaddrinfo ENOTFOUND pve1.lab") }, "fetch failed")
      expect(classifyPveError(err)).toBe("hard-network")
    })

    it("does not classify an unrelated errno as a hard network failure", () => {
      expect(classifyPveError(errorWith({ code: "EACCES" }))).toBe("application")
    })
  })

  describe("connect-phase timeouts", () => {
    it("classifies an error named ConnectTimeoutError", () => {
      expect(classifyPveError(errorWith({ name: "ConnectTimeoutError" }))).toBe("connect-timeout")
    })

    it("classifies the real undici ConnectTimeoutError instance", () => {
      // The error undici raises on its own connect timeout, which is the one
      // that fires when a node is powered off and the handshake never lands.
      const err = new undiciErrors.ConnectTimeoutError()
      expect(err.name).toBe("ConnectTimeoutError")
      expect(err.code).toBe("UND_ERR_CONNECT_TIMEOUT")
      expect(classifyPveError(err)).toBe("connect-timeout")
    })

    it("classifies ETIMEDOUT carried by the message", () => {
      expect(classifyPveError(new Error("connect ETIMEDOUT 10.0.0.9:8006"))).toBe("connect-timeout")
    })

    it("classifies ETIMEDOUT carried by err.code", () => {
      expect(classifyPveError(errorWith({ code: "ETIMEDOUT" }))).toBe("connect-timeout")
    })

    it("classifies ETIMEDOUT carried by err.cause.code", () => {
      expect(classifyPveError(errorWith({ cause: { code: "ETIMEDOUT" } }, "fetch failed"))).toBe("connect-timeout")
    })

    it("classifies UND_ERR_CONNECT_TIMEOUT carried by err.code", () => {
      expect(classifyPveError(errorWith({ code: "UND_ERR_CONNECT_TIMEOUT" }))).toBe("connect-timeout")
    })

    it("classifies UND_ERR_CONNECT_TIMEOUT carried by err.cause.code", () => {
      const err = errorWith({ cause: { code: "UND_ERR_CONNECT_TIMEOUT" } }, "fetch failed")
      expect(classifyPveError(err)).toBe("connect-timeout")
    })
  })

  describe("response timeouts", () => {
    it("classifies an error named TimeoutError", () => {
      expect(classifyPveError(errorWith({ name: "TimeoutError" }))).toBe("response-timeout")
    })

    it("classifies a wrapper whose cause is named TimeoutError", () => {
      const err = errorWith({ cause: new DOMException("aborted", "TimeoutError") }, "fetch failed")
      expect(classifyPveError(err)).toBe("response-timeout")
    })

    it("classifies the real error produced by AbortSignal.timeout", async () => {
      // This is the exact object the platform hands us when the per-request
      // budget expires: undici rethrows the signal reason as-is, so a slow
      // /nodes/{node}/storage read lands here and NOT in "hard-network".
      const signal = AbortSignal.timeout(0)
      await new Promise(resolve => setTimeout(resolve, 5))

      expect(signal.aborted).toBe(true)
      const reason = signal.reason as Error
      expect(reason).toBeInstanceOf(Error)
      expect(reason.name).toBe("TimeoutError")
      expect(classifyPveError(reason)).toBe("response-timeout")
    })
  })

  describe("caller aborts", () => {
    it("classifies an error named AbortError", () => {
      expect(classifyPveError(errorWith({ name: "AbortError" }))).toBe("caller-abort")
    })

    it("classifies a wrapper whose cause is named AbortError", () => {
      const err = errorWith({ cause: new DOMException("aborted", "AbortError") }, "fetch failed")
      expect(classifyPveError(err)).toBe("caller-abort")
    })

    it("classifies the real error produced by an aborted AbortController", () => {
      // What a closed browser tab or a cancelled Next.js request produces.
      const controller = new AbortController()
      controller.abort()

      const reason = controller.signal.reason as Error
      expect(reason).toBeInstanceOf(Error)
      expect(reason.name).toBe("AbortError")
      expect(classifyPveError(reason)).toBe("caller-abort")
    })

    it("classifies the Node wrapper that reports a timed-out signal as an abort", async () => {
      // Node core helpers (node:timers/promises and friends) do not rethrow
      // the signal reason, they wrap it: name "AbortError" with the
      // TimeoutError as cause. Because caller-abort is tested first, such a
      // wrapper reads as a cancellation. Harmless with undici 7, which
      // rethrows the raw reason, but this is the shape to watch if the
      // transport ever starts wrapping.
      const { setTimeout: delay } = await import("node:timers/promises")
      const err = await delay(1_000, undefined, { signal: AbortSignal.timeout(1) }).catch(e => e as Error)

      expect(err.name).toBe("AbortError")
      expect((err as Error & { cause?: Error }).cause?.name).toBe("TimeoutError")
      expect(classifyPveError(err)).toBe("caller-abort")
    })
  })

  describe("application errors", () => {
    it("classifies a PVE HTTP failure", () => {
      const err = new Error('PVE 500 /nodes/pve1/storage: {"data":null}')
      expect(classifyPveError(err)).toBe("application")
    })

    it("classifies a PVE payload that failed to parse", () => {
      expect(classifyPveError(new Error("PVE invalid JSON (200): <html>"))).toBe("application")
    })

    it("classifies a plain Error with nothing recognisable", () => {
      expect(classifyPveError(new Error("pveFetch: missing apiToken"))).toBe("application")
    })

    it.each([
      ["undefined", undefined],
      ["null", null],
      ["a string", "ECONNREFUSED"],
      ["a number", 500],
      ["a bare object", { code: "ECONNREFUSED", name: "AbortError" }],
      ["an array", []],
    ])("classifies %s as application without throwing", (_label, value) => {
      // Every predicate gates on `instanceof Error`, so non-Error throws must
      // land in the safe class rather than blow up inside the classifier.
      expect(() => classifyPveError(value)).not.toThrow()
      expect(classifyPveError(value)).toBe("application")
    })

    it("ignores an errno-looking string carried by a non-Error object", () => {
      expect(classifyPveError({ message: "connect ECONNREFUSED 10.0.0.9:8006" })).toBe("application")
    })
  })

  describe("classification priority", () => {
    it("a caller abort carrying ECONNREFUSED stays a caller abort", () => {
      // THE case that protects the failover breaker: when the consumer goes
      // away mid-request, the socket teardown can surface a hard errno on the
      // same error. Counting it would drift a healthy connection towards a
      // failover it never needed.
      const err = errorWith({ name: "AbortError", code: "ECONNREFUSED" }, "This operation was aborted")
      expect(classifyPveError(err)).toBe("caller-abort")
    })

    it("a caller abort wins over a TimeoutError cause", () => {
      const err = errorWith({ name: "AbortError", cause: { name: "TimeoutError" } })
      expect(classifyPveError(err)).toBe("caller-abort")
    })

    it("an ETIMEDOUT named TimeoutError is a connect timeout, not a response timeout", () => {
      // The connect phase must win: the handshake never completed, so the
      // host is unreachable and the attempt IS failover-worthy.
      const err = errorWith({ name: "TimeoutError", code: "ETIMEDOUT" })
      expect(classifyPveError(err)).toBe("connect-timeout")
    })

    it("a connect timeout wins over a hard errno on the same error", () => {
      const err = errorWith({ name: "ConnectTimeoutError", code: "ECONNRESET" })
      expect(classifyPveError(err)).toBe("connect-timeout")
    })

    it("a hard errno wins over a TimeoutError name", () => {
      const err = errorWith({ name: "TimeoutError", code: "EHOSTUNREACH" })
      expect(classifyPveError(err)).toBe("hard-network")
    })

    it("a BARE Error quoting an errno still reads as a hard network failure, the real path does not", () => {
      // The substring match on the message is still in force for a plain
      // Error, and that is deliberate: a lot of the suite fakes pveFetch by
      // throwing `new Error("PVE 500 ...")`, so this stays the behaviour for
      // anything that is not a PveApplicationError.
      const bare = new Error('PVE 500 /nodes/pve1/storage: connect ECONNREFUSED 10.0.0.50:8007')
      expect(classifyPveError(bare)).toBe("hard-network")

      // The production path is immune: doRequest now throws
      // PveApplicationError for a non-2xx answer, and that class is matched
      // before any substring predicate.
      const real = new PveApplicationError(
        'PVE 500 /nodes/pve1/storage: connect ECONNREFUSED 10.0.0.50:8007',
        500,
      )
      expect(classifyPveError(real)).toBe("application")
    })
  })
})

describe("PveApplicationError", () => {
  // Errnos an unhealthy storage backend can leak into a PVE response body.
  const BODY_ERRNOS = ["ECONNREFUSED", "ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "EHOSTUNREACH", "ENOTFOUND"] as const

  it("is a real Error carrying the HTTP status", () => {
    const err = new PveApplicationError('PVE 500 /nodes/pve1/storage: {"data":null}', 500)
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(PveApplicationError)
    expect(err.name).toBe("PveApplicationError")
    expect(err.statusCode).toBe(500)
  })

  it("carries the status of an unparsable answer too", () => {
    const err = new PveApplicationError("PVE invalid JSON (200): <html>maintenance</html>", 200)
    expect(err.statusCode).toBe(200)
  })

  it.each(BODY_ERRNOS)("stays an application error when the PVE body quotes %s", code => {
    // The exact setting of issue #742: PVE answers 500 because a PBS or NFS
    // target is down and quotes the backend errno in the body. The node
    // itself answered, so this must never count towards a failover.
    const err = new PveApplicationError(
      `PVE 500 /nodes/pve1/storage: unable to activate storage 'pbs01': connect ${code} 10.0.0.50:8007`,
      500,
    )
    expect(classifyPveError(err)).toBe("application")
    expect(isFailoverWorthy(classifyPveError(err), false)).toBe(false)
  })

  it("stays an application error when the body mimics an abort or a timeout name", () => {
    // Ordering check: the class test runs before every predicate, so nothing
    // a remote body says can promote the error out of "application".
    const err = new PveApplicationError(
      "PVE 500 /nodes/pve1/storage: TimeoutError AbortError ConnectTimeoutError ETIMEDOUT",
      500,
    )
    expect(classifyPveError(err)).toBe("application")
  })

  it("keeps the historical message format of a non-2xx answer", () => {
    // doRequest builds `PVE ${statusCode} ${path}: ${body}`, and callers parse
    // that text (routes matching "PVE 404", "PVE 403"), so the wording is
    // part of the contract, not an implementation detail.
    const err = new PveApplicationError('PVE 403 /nodes/pve1/apt/update: {"data":null}', 403)
    expect(err.message).toBe('PVE 403 /nodes/pve1/apt/update: {"data":null}')
  })

  it("keeps the historical message format of an unparsable body", () => {
    const err = new PveApplicationError("PVE invalid JSON (200): <html>maintenance</html>", 200)
    expect(err.message).toBe("PVE invalid JSON (200): <html>maintenance</html>")
  })

  it("is still recognised by the locateVm config-file probe", () => {
    // isVmConfigNotFoundError (locateVm.ts) reads err.message only, so moving
    // from Error to a subclass must not change what it sees.
    const err = new PveApplicationError(
      "PVE 500 /nodes/pve1/qemu/100/config: Configuration file 'nodes/pve1/qemu-server/100.conf' does not exist",
      500,
    )
    expect(isVmConfigNotFoundError(err)).toBe(true)
  })
})

describe("isFailoverWorthy", () => {
  it.each([true, false])("counts a hard network failure, hasLongBudget=%s", hasLongBudget => {
    // Nothing about the budget can excuse a refused or reset connection.
    expect(isFailoverWorthy("hard-network", hasLongBudget)).toBe(true)
  })

  it.each([true, false])("counts a connect timeout, hasLongBudget=%s", hasLongBudget => {
    // The handshake never completed, so the host is as unreachable as it
    // would be on ECONNREFUSED, whatever budget the caller asked for.
    expect(isFailoverWorthy("connect-timeout", hasLongBudget)).toBe(true)
  })

  it.each([true, false])("never counts a caller abort, hasLongBudget=%s", hasLongBudget => {
    expect(isFailoverWorthy("caller-abort", hasLongBudget)).toBe(false)
  })

  it.each([true, false])("never counts an application error, hasLongBudget=%s", hasLongBudget => {
    expect(isFailoverWorthy("application", hasLongBudget)).toBe(false)
  })

  it("does NOT count a response timeout when the caller asked for a long budget (#742)", () => {
    // THE fix. /nodes/{node}/storage opts into the 30s budget, and PVE
    // spending it while walking a slow PBS target is a slow answer, not an
    // outage. Counting it drifted healthy connections into a failover.
    expect(isFailoverWorthy("response-timeout", true)).toBe(false)
  })

  it("still counts a response timeout on the default budget, so a wedged node fails over (#742)", () => {
    // The other half of the fix: the short polling budget must keep arming
    // the breaker, otherwise a genuinely hung node would never fail over.
    expect(isFailoverWorthy("response-timeout", false)).toBe(true)
  })

  it("decides the whole class times budget matrix", () => {
    // Exhaustive table: adding a class without deciding its failover meaning
    // shows up right here.
    const matrix: Array<[PveErrorClass, boolean, boolean]> = [
      ["hard-network", false, true],
      ["hard-network", true, true],
      ["connect-timeout", false, true],
      ["connect-timeout", true, true],
      ["response-timeout", false, true],
      ["response-timeout", true, false],
      ["caller-abort", false, false],
      ["caller-abort", true, false],
      ["application", false, false],
      ["application", true, false],
    ]

    for (const [cls, hasLongBudget, expected] of matrix) {
      expect(isFailoverWorthy(cls, hasLongBudget), `${cls} with hasLongBudget=${hasLongBudget}`).toBe(expected)
    }
  })
})

describe("timeout budgets read from the environment", () => {
  const BUDGET_KEYS = ["PVE_TIMEOUT_MS", "PVE_SLOW_READ_TIMEOUT_MS"] as const
  const originalEnv = new Map(BUDGET_KEYS.map(key => [key, process.env[key]]))

  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    for (const key of BUDGET_KEYS) delete process.env[key]
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.resetModules()
  })

  afterEach(() => {
    warnSpy.mockRestore()
    for (const [key, value] of originalEnv) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  /**
   * Both budgets are module-level constants, so the values can only be
   * observed by re-importing the module after setting the environment.
   */
  async function loadBudgets(env: Partial<Record<(typeof BUDGET_KEYS)[number], string>> = {}) {
    for (const [key, value] of Object.entries(env)) process.env[key] = value
    vi.resetModules()
    const mod = await import("./client")
    return { fast: mod.PVE_DEFAULT_TIMEOUT_MS, slow: mod.PVE_SLOW_READ_TIMEOUT_MS }
  }

  it("falls back to 8s and 30s when neither variable is set", async () => {
    const { fast, slow } = await loadBudgets()
    expect(fast).toBe(8_000)
    expect(slow).toBe(30_000)
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it("keeps the slow-read budget well above the polling budget by default", async () => {
    // The whole point of #742: the slow endpoints need a budget the fast
    // polling path must never inherit.
    const { fast, slow } = await loadBudgets()
    expect(slow).toBeGreaterThan(fast)
  })

  it("honours a valid PVE_TIMEOUT_MS", async () => {
    const { fast, slow } = await loadBudgets({ PVE_TIMEOUT_MS: "12000" })
    expect(fast).toBe(12_000)
    expect(slow).toBe(30_000)
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it("honours a valid PVE_SLOW_READ_TIMEOUT_MS", async () => {
    const { fast, slow } = await loadBudgets({ PVE_SLOW_READ_TIMEOUT_MS: "45000" })
    expect(fast).toBe(8_000)
    expect(slow).toBe(45_000)
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it("honours both variables at once", async () => {
    const { fast, slow } = await loadBudgets({ PVE_TIMEOUT_MS: "3000", PVE_SLOW_READ_TIMEOUT_MS: "60000" })
    expect(fast).toBe(3_000)
    expect(slow).toBe(60_000)
  })

  it("accepts a whitespace-padded number", async () => {
    const { fast } = await loadBudgets({ PVE_TIMEOUT_MS: "  15000  " })
    expect(fast).toBe(15_000)
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it("rejects a non-numeric value and warns", async () => {
    const { fast } = await loadBudgets({ PVE_TIMEOUT_MS: "abc" })
    expect(fast).toBe(8_000)
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy).toHaveBeenCalledWith(
      '[pve] Ignoring invalid PVE_TIMEOUT_MS="abc", using 8000ms instead',
    )
  })

  it("rejects a value written with digit separators and warns", async () => {
    // The source writes budgets as 8_000, so an operator copying that style
    // into the environment is a realistic mistake. Number() returns NaN here.
    const { fast } = await loadBudgets({ PVE_TIMEOUT_MS: "12_000" })
    expect(fast).toBe(8_000)
    expect(warnSpy).toHaveBeenCalledTimes(1)
  })

  it("rejects zero and warns", async () => {
    const { slow } = await loadBudgets({ PVE_SLOW_READ_TIMEOUT_MS: "0" })
    expect(slow).toBe(30_000)
    expect(warnSpy).toHaveBeenCalledWith(
      '[pve] Ignoring invalid PVE_SLOW_READ_TIMEOUT_MS="0", using 30000ms instead',
    )
  })

  it("rejects a negative value and warns", async () => {
    const { fast } = await loadBudgets({ PVE_TIMEOUT_MS: "-5000" })
    expect(fast).toBe(8_000)
    expect(warnSpy).toHaveBeenCalledWith(
      '[pve] Ignoring invalid PVE_TIMEOUT_MS="-5000", using 8000ms instead',
    )
  })

  it("rejects Infinity and warns", async () => {
    const { slow } = await loadBudgets({ PVE_SLOW_READ_TIMEOUT_MS: "Infinity" })
    expect(slow).toBe(30_000)
    expect(warnSpy).toHaveBeenCalledTimes(1)
  })

  it("treats an empty value as unset, silently", async () => {
    const { fast, slow } = await loadBudgets({ PVE_TIMEOUT_MS: "", PVE_SLOW_READ_TIMEOUT_MS: "" })
    expect(fast).toBe(8_000)
    expect(slow).toBe(30_000)
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it("keeps the two budgets independent when only one value is invalid", async () => {
    const { fast, slow } = await loadBudgets({ PVE_TIMEOUT_MS: "nope", PVE_SLOW_READ_TIMEOUT_MS: "20000" })
    expect(fast).toBe(8_000)
    expect(slow).toBe(20_000)
    expect(warnSpy).toHaveBeenCalledTimes(1)
  })

  it("warns once per invalid variable", async () => {
    await loadBudgets({ PVE_TIMEOUT_MS: "x", PVE_SLOW_READ_TIMEOUT_MS: "y" })
    expect(warnSpy).toHaveBeenCalledTimes(2)
  })
})

describe("the long-budget threshold inside pveFetch", () => {
  /**
   * `hasLongBudget` is computed inside pveFetch, so the only way to observe
   * the comparison without mocking the transport is to let a REAL request
   * time out: a local server that accepts the connection and then answers
   * nothing. The completed handshake is what makes the failure a response
   * timeout, which is precisely the class whose failover meaning depends on
   * the budget.
   *
   * PVE_TIMEOUT_MS is lowered to 50ms here so both sides of the strict
   * comparison are reachable in milliseconds. The observable effect is the
   * failure counter of the circuit breaker: incremented when the attempt
   * counts as evidence of an unreachable host, untouched otherwise.
   */
  const originalBudget = process.env.PVE_TIMEOUT_MS
  const TINY_BUDGET_MS = 50

  let server: Server
  let baseUrl = ""

  beforeAll(async () => {
    const { createServer } = await import("node:http")
    // Accept, then stay silent: the client can only give up on its own budget.
    server = createServer(() => {})
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", () => resolve()))
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    if (originalBudget === undefined) delete process.env.PVE_TIMEOUT_MS
    else process.env.PVE_TIMEOUT_MS = originalBudget
  })

  beforeEach(() => {
    // The failover path logs the failure count; keep the run readable.
    vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.spyOn(console, "log").mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  async function callAgainstSilentServer(connId: string, timeoutMs?: number) {
    process.env.PVE_TIMEOUT_MS = String(TINY_BUDGET_MS)
    vi.resetModules()
    const client = await import("./client")
    const cache = await import("../cache/nodeIpCache")
    expect(client.PVE_DEFAULT_TIMEOUT_MS).toBe(TINY_BUDGET_MS)

    // A second IP so the failover candidate pre-check passes and the attempt
    // actually reaches the failure counter, instead of failing fast the way a
    // standalone node does. 127.0.0.2 is never contacted: FAILURE_THRESHOLD is
    // 2, so the first failure only counts and rethrows.
    cache.setNodeIps(connId, ["127.0.0.1", "127.0.0.2"], 8006, "https")
    cache.resetFailures(connId)

    const err = await client
      .pveFetch(
        { baseUrl, apiToken: "root@pam!vitest=secret", id: connId },
        "/nodes/pve1/storage",
        {},
        timeoutMs === undefined ? {} : { timeoutMs },
      )
      .then(() => null)
      .catch((e: unknown) => e)

    await client.getDefaultAgent().destroy()

    return { errorClass: client.classifyPveError(err), failures: cache.getFailureCount(connId) }
  }

  it("counts a timeout on the default budget, so a wedged node still fails over", async () => {
    const { errorClass, failures } = await callAgainstSilentServer("conn-default-budget")
    expect(errorClass).toBe("response-timeout")
    expect(failures).toBe(1)
  })

  it("counts a timeout when the caller asks for EXACTLY the default budget", async () => {
    // The comparison is strict: equal to the default is NOT a long budget,
    // so this attempt still arms the breaker.
    const { errorClass, failures } = await callAgainstSilentServer("conn-equal-budget", TINY_BUDGET_MS)
    expect(errorClass).toBe("response-timeout")
    expect(failures).toBe(1)
  })

  it("does not count a timeout one millisecond above the default budget", async () => {
    // One millisecond over is enough to make it the caller's own budget, and
    // spending it is a slow answer rather than an outage (#742).
    const { errorClass, failures } = await callAgainstSilentServer("conn-long-budget", TINY_BUDGET_MS + 1)
    expect(errorClass).toBe("response-timeout")
    expect(failures).toBe(0)
  })
})
