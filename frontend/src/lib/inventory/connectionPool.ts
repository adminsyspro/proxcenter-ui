// src/lib/inventory/connectionPool.ts
//
// The one bound on the per-guest Proxmox reads ProxCenter makes in the background of a page (UA44, UA52): the
// firewall coverage (options, config), the guest list of GET /api/v1/vms (config) and its live address index (guest
// agent). Per Next process and per connection, at most POOL_GLOBAL_CONCURRENCY such calls are in flight, at most
// POOL_NODE_CONCURRENCY on one node, whoever asks: two readers of the same connection share the slots instead of
// adding up. A waiting call starts as soon as a slot of its node is free; FIFO otherwise.
//
// A read also carries a gate (createCallGate): no call starts after its deadline, and none once one of its calls
// timed out or took longer than POOL_SLOW_CALL_MS (the 1.4.12 lesson: a slow Proxmox fed with more calls only gets
// slower, and a call the client gave up on still holds its worker).

export const POOL_GLOBAL_CONCURRENCY = 4
export const POOL_NODE_CONCURRENCY = 2
/** A call slower than this, or one that timed out, trips its read: no further call of that read starts. */
export const POOL_SLOW_CALL_MS = 5_000

type Waiter = { node: string; grant: () => void }
type Pool = { active: number; perNode: Map<string, number>; waiting: Waiter[] }

const POOLS_KEY = '__proxcenter_connection_pools__' as const

function pools(): Map<string, Pool> {
  const g = globalThis as any
  if (!g[POOLS_KEY]) g[POOLS_KEY] = new Map<string, Pool>()

  return g[POOLS_KEY]
}

function poolOf(connId: string): Pool {
  let pool = pools().get(connId)
  if (!pool) {
    pool = { active: 0, perNode: new Map(), waiting: [] }
    pools().set(connId, pool)
  }

  return pool
}

const canRun = (pool: Pool, node: string) =>
  pool.active < POOL_GLOBAL_CONCURRENCY && (pool.perNode.get(node) ?? 0) < POOL_NODE_CONCURRENCY

function take(pool: Pool, node: string): void {
  pool.active++
  pool.perNode.set(node, (pool.perNode.get(node) ?? 0) + 1)
}

function release(connId: string, pool: Pool, node: string): void {
  pool.active--
  const left = (pool.perNode.get(node) ?? 1) - 1
  if (left > 0) pool.perNode.set(node, left)
  else pool.perNode.delete(node)
  // Hand the freed slots to the oldest waiters that may run now (a waiter of a busy node lets the next one pass).
  for (let i = 0; i < pool.waiting.length && pool.active < POOL_GLOBAL_CONCURRENCY;) {
    const waiter = pool.waiting[i]
    if (canRun(pool, waiter.node)) {
      pool.waiting.splice(i, 1)
      take(pool, waiter.node)
      waiter.grant()
    } else {
      i++
    }
  }
  if (pool.active === 0 && pool.waiting.length === 0 && pools().get(connId) === pool) pools().delete(connId)
}

/** Runs `call` in one slot of the connection's pool, once one is free on `node`. */
export async function withConnectionSlot<T>(connId: string, node: string, call: () => Promise<T>): Promise<T> {
  const pool = poolOf(connId)
  // A waiter only ever waits on a full node or a full pool, so a call that fits now passes no one that could run.
  if (canRun(pool, node)) {
    take(pool, node)
  } else {
    await new Promise<void>(resolve => pool.waiting.push({ node, grant: resolve }))
  }
  try {
    return await call()
  } finally {
    release(connId, pool, node)
  }
}

/** A runner of node-bound calls: the shared pool of a connection, or a private one (tests, a read of its own). */
export type SlotRunner = <T>(node: string, call: () => Promise<T>) => Promise<T>

export const connectionSlots = (connId: string): SlotRunner => (node, call) => withConnectionSlot(connId, node, call)

/** Calls in flight on a connection, for the tests and the load figures. */
export function connectionPoolActivity(connId: string): { active: number; waiting: number } {
  const pool = pools().get(connId)

  return { active: pool?.active ?? 0, waiting: pool?.waiting.length ?? 0 }
}

/** Test seam. */
export function resetConnectionPools(): void {
  pools().clear()
}

/** A timeout of the call itself (pveFetch, undici, the orchestrator client), not a refusal. */
export function isTimeoutError(err: unknown): boolean {
  const e = err as { name?: string; code?: string; message?: string; cause?: { name?: string } } | null
  if (!e) return false
  if (e.name === 'TimeoutError' || e.cause?.name === 'TimeoutError') return true
  if (e.code === 'ETIMEDOUT' || e.code === 'ECONNABORTED' || e.code === 'UND_ERR_HEADERS_TIMEOUT') return true

  return /time(d)? ?out/i.test(String(e.message ?? ''))
}

export type CallGate = {
  /** One Proxmox call, or null when none may start (deadline, tripped) or it failed; trips on a timeout or a slow answer. */
  run: <T>(call: () => Promise<T | null | undefined>) => Promise<T | null>
  /** A call timed out or was slow: no further call starts. */
  readonly tripped: boolean
}

export function createCallGate(opts: { deadline: number; slowCallMs?: number; now?: () => number }): CallGate {
  const now = opts.now ?? Date.now
  const slow = opts.slowCallMs ?? POOL_SLOW_CALL_MS
  let tripped = false

  return {
    get tripped() { return tripped },
    async run<T>(call: () => Promise<T | null | undefined>): Promise<T | null> {
      if (tripped || now() > opts.deadline) return null
      const started = now()
      try {
        const answer = (await call()) ?? null
        if (now() - started > slow) tripped = true
        return answer
      } catch (err) {
        if (isTimeoutError(err) || now() - started > slow) tripped = true
        return null
      }
    },
  }
}
