// In-memory lock per vDC (#672): the quota check and the PVE write of a GPU
// attach must not interleave with another one on the same vDC. FIFO, and the
// entry is dropped once the last waiter is done.
// Kept on globalThis: in Next dev two route files can load separate copies of
// this module, which would otherwise hold two independent locks.
const g = globalThis as { __pcVdcGpuLocks?: Map<string, Promise<unknown>> }
const tails = (g.__pcVdcGpuLocks ??= new Map<string, Promise<unknown>>())

export function withVdcLock<T>(vdcId: string, fn: () => Promise<T>): Promise<T> {
  const prev = tails.get(vdcId) ?? Promise.resolve()
  const run = prev.then(fn, fn)
  const tail = run.catch(() => undefined)
  tails.set(vdcId, tail)
  void tail.then(() => {
    if (tails.get(vdcId) === tail) tails.delete(vdcId)
  })
  return run
}

/**
 * Takes the lock of a vDC and holds it until the returned function is called,
 * for a check and a PVE request that live in different parts of a route.
 */
export async function holdVdcLock(vdcId: string): Promise<() => void> {
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  await new Promise<void>((entered) => {
    void withVdcLock(vdcId, () => {
      entered()
      return held
    })
  })
  return release
}

/**
 * The cards of a connection are contested by every vDC on it and by the
 * provider: one attach at a time per connection, from the snapshot read to
 * the write. Taken inside a vDC lock, never around one, so the order is
 * always vDC then connection.
 */
export function withConnGpuLock<T>(connId: string, fn: () => Promise<T>): Promise<T> {
  return withVdcLock(`gpu-conn:${connId}`, fn)
}
