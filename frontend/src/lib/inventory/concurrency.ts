// Bounded parallel map. Ceiling of 16 measured on real clusters (spec D9):
// pveproxy has a limited worker pool, going from 1 to 16 only yields 3.5x
// (per-call latency climbs from 36ms to 108ms) and going further starves the
// customer's own Proxmox UI.
export const PVEPROXY_CONCURRENCY = 16

export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await worker(items[index], index)
    }
  })
  await Promise.all(workers)
  return results
}
