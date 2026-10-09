// src/lib/guestFileRestore/stream.ts
//
// Small stream helpers shared by the entry reader and the guest writers.

import { Transform } from 'node:stream'
import type { Readable } from 'node:stream'

/** Re-slice a byte stream into buffers of exactly `size` bytes (the last one may be shorter). */
export async function* chunkStream(body: Readable, size: number): AsyncGenerator<Buffer> {
  let pending: Buffer[] = []
  let pendingLen = 0
  for await (const piece of body) {
    let buf: Buffer = Buffer.isBuffer(piece) ? piece : Buffer.from(piece)
    while (buf.length > 0) {
      const take = Math.min(size - pendingLen, buf.length)
      pending.push(buf.subarray(0, take))
      pendingLen += take
      buf = buf.subarray(take)
      if (pendingLen === size) {
        yield Buffer.concat(pending, size)
        pending = []
        pendingLen = 0
      }
    }
  }
  if (pendingLen > 0) yield Buffer.concat(pending, pendingLen)
}

/** Read a stream to its end into one buffer. */
export async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  return Buffer.concat(chunks)
}

/** Resolve once the stream has been read to its end (consuming what is left). */
export function drain(stream: Readable): Promise<void> {
  return new Promise(resolve => {
    // A stream already consumed by the caller must not wait for an `end`
    // that fired earlier: look at the internal state as well, for streams
    // (readable-stream based ones) that lack `readableEnded`.
    const s = stream as Readable & { readableEnded?: boolean; destroyed?: boolean; _readableState?: { endEmitted?: boolean } }
    if (s.readableEnded || s.destroyed || s._readableState?.endEmitted) return resolve()
    const done = () => {
      stream.removeListener('end', done)
      stream.removeListener('close', done)
      stream.removeListener('error', done)
      resolve()
    }
    stream.on('end', done)
    stream.on('close', done)
    stream.on('error', done)
    stream.resume()
  })
}

/** A promise that rejects when the signal aborts, usable in a Promise.race. */
export function abortPromise(signal: AbortSignal): { promise: Promise<never>; dispose: () => void } {
  let handler: (() => void) | null = null
  const promise = new Promise<never>((_, reject) => {
    handler = () => reject(signal.reason instanceof Error ? signal.reason : new Error('Cancelled'))
    if (signal.aborted) handler()
    else signal.addEventListener('abort', handler, { once: true })
  })
  // A race loser must not surface as an unhandled rejection.
  promise.catch(() => {})
  return { promise, dispose: () => { if (handler) signal.removeEventListener('abort', handler) } }
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Cancelled'))
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(t)
      reject(new Error('Cancelled'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export class SourceStallError extends Error {
  constructor(seconds: number) {
    super(`Backup read stalled: no data received for ${seconds} s`)
    this.name = 'SourceStallError'
  }
}

/**
 * Buffer kept between the download socket and its consumer. With Node's
 * default 16 KiB, every pause of the consumer closes the TCP window and the
 * next chunk waits one round trip: 16 KiB per RTT, under 1 MiB/s at 25 ms
 * (lab, 2026-10-09). A few MiB lets the socket run while the decoder and
 * the guest take their time.
 */
export const SOURCE_BUFFER_BYTES = 4 * 1024 * 1024

/**
 * Pass-through that fails the stream when the consumer is waiting for data
 * and the source delivers nothing for `timeoutMs`. The timer only runs while
 * the readable side asks for more (`_read`): a consumer applying backpressure
 * (a slow guest) never trips it, a dead download does.
 */
export function stallWatchdog(timeoutMs: number, onChunk?: (bytes: number) => void, highWaterMark = SOURCE_BUFFER_BYTES): Transform {
  let timer: NodeJS.Timeout | null = null
  const stop = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }
  const watchdog = new Transform({
    highWaterMark,
    transform(chunk, _enc, cb) {
      stop()
      onChunk?.(chunk.length)
      cb(null, chunk)
    },
    flush(cb) {
      stop()
      cb()
    },
    destroy(err, cb) {
      stop()
      cb(err)
    },
  })
  const read = watchdog._read.bind(watchdog)
  watchdog._read = size => {
    if (!timer && !watchdog.writableEnded && !watchdog.destroyed) {
      timer = setTimeout(() => {
        timer = null
        watchdog.destroy(new SourceStallError(Math.round(timeoutMs / 1000)))
      }, timeoutMs)
      timer.unref()
    }
    read(size)
  }
  return watchdog
}
