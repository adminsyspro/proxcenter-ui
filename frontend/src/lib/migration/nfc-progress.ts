/**
 * Progress accounting and bounded fan-out for the NFC disk downloads of the
 * cold vCenter path (#807).
 *
 * The stream vCenter serves for a disk is compressed on the fly, so the bytes
 * landing on the node say nothing about how far into the disk the export is.
 * The tracker therefore works in logical bytes: the position inside the disk
 * (read from the stream by ./nfc-stream-probe) over the disk capacity. Wire
 * bytes are kept alongside for the rate the operator sees in the log.
 */

export const NFC_CONCURRENCY_DEFAULT = 2
export const NFC_CONCURRENCY_MAX = 8

export const NFC_CONCURRENCY_MIN = 1

/**
 * Strict reading of the dialog's "Parallel disk downloads" value as it arrives
 * in the API body: an integer from 1 to 8, as a number or a numeric string.
 * Null for anything else, so the route can answer 400.
 */
export function parseNfcConcurrency(raw: unknown): number | null {
  let n: number
  if (typeof raw === "number") n = raw
  else if (typeof raw === "string" && /^\d+$/.test(raw.trim())) n = Number.parseInt(raw.trim(), 10)
  else return null
  if (!Number.isInteger(n) || n < NFC_CONCURRENCY_MIN || n > NFC_CONCURRENCY_MAX) return null
  return n
}

/** Concurrency the pipeline runs with: the job's value when it is usable, else the default, never above the ceiling. */
export function resolveNfcConcurrency(raw: unknown): number {
  let n: number
  if (typeof raw === "number") n = raw
  else if (typeof raw === "string" && /^\d+$/.test(raw.trim())) n = Number.parseInt(raw.trim(), 10)
  else return NFC_CONCURRENCY_DEFAULT
  if (!Number.isInteger(n) || n < NFC_CONCURRENCY_MIN) return NFC_CONCURRENCY_DEFAULT
  return Math.min(n, NFC_CONCURRENCY_MAX)
}

export interface NfcDiskSample {
  /** Bytes of the disk already streamed, from the stream probe. Null when the probe is unavailable. */
  positionBytes: number | null
  /** Bytes of compressed stream on the node's filesystem. */
  wireBytes: number
  /** Capacity read from the stream header, when the caller did not know it upfront. */
  capacityBytes?: number
  done?: boolean
}

interface DiskState {
  capacity: number
  position: number | null
  wire: number
  done: boolean
}

interface RateSample { at: number; logical: number; wire: number }

const MB = 1048576
const RATE_WINDOW_MS = 60_000
const RATE_MIN_SPAN_MS = 10_000

export class NfcProgressTracker {
  private readonly disks: DiskState[]
  private readonly history: RateSample[] = []

  constructor(capacities: number[], private readonly band: { offset: number; scale: number }) {
    this.disks = capacities.map(c => ({ capacity: c > 0 ? c : 0, position: null, wire: 0, done: false }))
  }

  update(diskIndex: number, sample: NfcDiskSample, now: number = Date.now()): void {
    const d = this.disks[diskIndex]
    if (!d) return
    if (sample.capacityBytes && sample.capacityBytes > 0) d.capacity = sample.capacityBytes
    d.position = sample.positionBytes
    d.wire = sample.wireBytes
    if (sample.done) d.done = true
    this.history.push({ at: now, logical: this.logicalBytes(), wire: this.wireBytes() })
    // Keep one sample at or before the window start so the rate always spans the full window.
    while (this.history.length > 2 && this.history[1].at <= now - RATE_WINDOW_MS) this.history.shift()
  }

  /** Percent of one disk, 100 only once done, null when nothing is known about its size. */
  diskPercent(diskIndex: number): number | null {
    const d = this.disks[diskIndex]
    if (!d) return null
    if (d.done) return 100
    if (d.capacity <= 0) return null
    const basis = d.position ?? d.wire
    return Math.min(99, Math.floor((basis / d.capacity) * 100))
  }

  /** Job progress inside the caller's band, weighted by disk capacity. */
  globalPercent(): number {
    const known = this.disks.filter(d => d.capacity > 0)
    const avgCapacity = known.length > 0 ? known.reduce((s, d) => s + d.capacity, 0) / known.length : 1
    let weightSum = 0
    let acc = 0
    for (const [i, d] of this.disks.entries()) {
      const w = d.capacity > 0 ? d.capacity : avgCapacity
      weightSum += w
      acc += w * (d.done ? 1 : (this.diskPercent(i) ?? 0) / 100)
    }
    const fraction = weightSum > 0 ? acc / weightSum : 0
    const { offset, scale } = this.band
    return Math.min(offset + scale, Math.floor(offset + scale * fraction))
  }

  /**
   * Job-level counters in the units the task bar expects: logical bytes and a
   * speed string whose first figure is the logical rate, so the ETA derived
   * from it matches the byte counters. The wire rate follows in the same
   * string, so the operator sees both where the speed is displayed raw.
   */
  summary(): { bytesTransferred: number; totalBytes: number; transferSpeed: string | null; wireMBps: number | null } {
    const logicalRate = this.rate("logical")
    const wireRate = this.rate("wire")
    let transferSpeed: string | null = null
    if (logicalRate != null) {
      transferSpeed = `${logicalRate.toFixed(1)} MB/s`
      if (wireRate != null) transferSpeed += ` (${wireRate.toFixed(1)} MB/s on the wire)`
    }
    return {
      bytesTransferred: this.logicalBytes(),
      totalBytes: this.disks.reduce((s, d) => s + d.capacity, 0),
      transferSpeed,
      wireMBps: wireRate,
    }
  }

  private logicalBytes(): number {
    return this.disks.reduce((s, d) => s + (d.done ? d.capacity : (d.position ?? 0)), 0)
  }

  private wireBytes(): number {
    return this.disks.reduce((s, d) => s + d.wire, 0)
  }

  private rate(kind: "logical" | "wire"): number | null {
    if (this.history.length < 2) return null
    const first = this.history[0]
    const last = this.history[this.history.length - 1]
    const spanMs = last.at - first.at
    if (spanMs < RATE_MIN_SPAN_MS) return null
    return ((last[kind] - first[kind]) / MB) / (spanMs / 1000)
  }
}

/**
 * Run `worker` for indexes 0..count-1 with at most `limit` in flight. The first
 * rejection raises `abort.aborted`, so long-running siblings can stop at their
 * next poll, nothing new starts, and once every started worker has settled the
 * pool rejects with that first error. Results come back in index order.
 */
export async function runWithConcurrency<T>(
  count: number,
  limit: number,
  worker: (index: number, abort: { aborted: boolean }) => Promise<T>,
): Promise<T[]> {
  const results: T[] = Array.from({ length: count })
  const abort = { aborted: false }
  let firstError: unknown
  let next = 0
  const runner = async () => {
    while (!abort.aborted) {
      const i = next++
      if (i >= count) return
      try {
        results[i] = await worker(i, abort)
      } catch (err) {
        if (!abort.aborted) {
          abort.aborted = true
          firstError = err
        }
        return
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, count)) }, runner))
  if (abort.aborted) throw firstError
  return results
}

/**
 * Serialise calls sharing a key. The job log is a JSON column rewritten on
 * every line (read, push, write): two disks logging at the same instant would
 * drop one another's line, so every append for a job waits for the previous
 * one. Different keys never wait for each other, and a rejected call does not
 * block the ones behind it.
 */
export function serializeByKey<A extends unknown[]>(
  fn: (key: string, ...args: A) => Promise<void>,
): (key: string, ...args: A) => Promise<void> {
  const tails = new Map<string, Promise<void>>()
  return (key, ...args) => {
    const prev = tails.get(key) ?? Promise.resolve()
    const run = prev.then(() => fn(key, ...args))
    const tail: Promise<void> = run.catch(() => {}).then(() => {
      if (tails.get(key) === tail) tails.delete(key)
    })
    tails.set(key, tail)
    return run
  }
}
