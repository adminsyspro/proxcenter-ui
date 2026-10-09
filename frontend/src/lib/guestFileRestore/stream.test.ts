import { PassThrough, Readable } from 'node:stream'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { abortPromise, chunkStream, drain, readAll, SourceStallError, sleep, stallWatchdog } from './stream'

const settle = () => new Promise<void>(resolve => setImmediate(resolve))

describe('stallWatchdog', () => {
  beforeEach(() => {
    // Streams schedule on nextTick/setImmediate: only the watchdog's timer is faked.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('fails the stream when the consumer waits and the source sends nothing', async () => {
    const source = new PassThrough()
    const watchdog = stallWatchdog(5_000)
    source.pipe(watchdog)
    const received: Buffer[] = []
    const failure = new Promise<Error>(resolve => watchdog.on('error', resolve))
    watchdog.on('data', (c: Buffer) => received.push(c))

    source.write(Buffer.from('hello'))
    await settle()
    expect(Buffer.concat(received).toString()).toBe('hello')

    // The consumer is flowing, so the watchdog is waiting on the source.
    await vi.advanceTimersByTimeAsync(4_999)
    expect(watchdog.destroyed).toBe(false)
    await vi.advanceTimersByTimeAsync(2)

    const err = await failure
    expect(err).toBeInstanceOf(SourceStallError)
    expect(err.message).toContain('no data received for 5 s')
  })

  it('does not fire while the consumer applies backpressure', async () => {
    const source = new PassThrough({ highWaterMark: 1024 })
    const watchdog = stallWatchdog(1_000, undefined, 4096)
    source.pipe(watchdog)
    const errors: Error[] = []
    watchdog.on('error', e => errors.push(e))

    // Fill the watchdog's buffers without reading from it: a slow guest.
    for (let i = 0; i < 64; i++) source.write(Buffer.alloc(1024, 1))
    await settle()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(errors).toHaveLength(0)
    expect(watchdog.destroyed).toBe(false)

    // Draining it afterwards hands every byte over.
    let total = 0
    watchdog.on('data', (c: Buffer) => { total += c.length })
    source.end()
    await vi.advanceTimersByTimeAsync(10)
    await settle()
    expect(total).toBe(64 * 1024)
  })

  it('lets a stream that ends normally through untouched', async () => {
    const source = Readable.from([Buffer.from('a'), Buffer.from('b')])
    const watchdog = stallWatchdog(1_000)
    const chunks: Buffer[] = []
    const errors: Error[] = []
    watchdog.on('error', e => errors.push(e))
    const done = new Promise<void>(resolve => watchdog.on('end', resolve))
    watchdog.on('data', (c: Buffer) => chunks.push(c))
    source.pipe(watchdog)
    await vi.advanceTimersByTimeAsync(10)
    await done
    expect(Buffer.concat(chunks).toString()).toBe('ab')
    await vi.advanceTimersByTimeAsync(5_000)
    expect(errors).toHaveLength(0)
  })
})

describe('chunkStream', () => {
  it('re-slices pieces into fixed-size buffers with a shorter tail', async () => {
    const out: string[] = []
    for await (const c of chunkStream(Readable.from([Buffer.from('abcde'), 'fg', Buffer.from('hijkl')]), 4)) out.push(c.toString())
    expect(out).toEqual(['abcd', 'efgh', 'ijkl'])
  })

  it('yields the remainder when the total is not a multiple of the size', async () => {
    const out: string[] = []
    for await (const c of chunkStream(Readable.from([Buffer.from('abcdef')]), 4)) out.push(c.toString())
    expect(out).toEqual(['abcd', 'ef'])
  })

  it('yields nothing for an empty stream', async () => {
    const out: Buffer[] = []
    for await (const c of chunkStream(Readable.from([]), 4)) out.push(c)
    expect(out).toEqual([])
  })
})

describe('readAll', () => {
  it('concatenates buffer and string chunks', async () => {
    expect((await readAll(Readable.from([Buffer.from('ab'), 'cd']))).toString()).toBe('abcd')
  })
})

describe('drain', () => {
  it('consumes a stream to its end', async () => {
    const s = Readable.from([Buffer.from('a'), Buffer.from('b')])
    await drain(s)
    expect(s.readableEnded).toBe(true)
  })

  it('resolves at once for a stream already ended or destroyed', async () => {
    const ended = Readable.from([])
    await readAll(ended)
    await drain(ended)
    const destroyed = new PassThrough()
    destroyed.destroy()
    await drain(destroyed)
    // readable-stream based streams lack `readableEnded`: only the internal state says so.
    const legacy = new PassThrough() as any
    Object.defineProperty(legacy, 'readableEnded', { value: undefined })
    legacy._readableState.endEmitted = true
    await drain(legacy)
  })

  it('resolves when the stream errors', async () => {
    const s = new PassThrough()
    const p = drain(s)
    s.destroy(new Error('boom'))
    await p
    expect(s.listenerCount('end')).toBe(0)
  })
})

describe('abortPromise', () => {
  it('rejects with the abort reason when it is an Error', async () => {
    const ac = new AbortController()
    const { promise } = abortPromise(ac.signal)
    ac.abort(new Error('stop'))
    await expect(promise).rejects.toThrow('stop')
  })

  it('rejects with Cancelled for a non-Error reason or an already aborted signal', async () => {
    const ac = new AbortController()
    ac.abort('why')
    await expect(abortPromise(ac.signal).promise).rejects.toThrow('Cancelled')
  })

  it('dispose detaches the listener so a later abort is ignored', () => {
    const ac = new AbortController()
    const { dispose } = abortPromise(ac.signal)
    dispose()
    ac.abort()
  })
})

describe('sleep', () => {
  it('resolves after the delay', async () => {
    await sleep(1)
  })

  it('resolves without a signal-bound listener left behind', async () => {
    const ac = new AbortController()
    await sleep(1, ac.signal)
    ac.abort()
  })

  it('rejects at once for an aborted signal and on a later abort', async () => {
    const ac = new AbortController()
    ac.abort()
    await expect(sleep(1000, ac.signal)).rejects.toThrow('Cancelled')
    const ac2 = new AbortController()
    const p = sleep(60_000, ac2.signal)
    ac2.abort()
    await expect(p).rejects.toThrow('Cancelled')
  })
})

describe('stallWatchdog callbacks', () => {
  it('reports each chunk size and does not arm once destroyed', async () => {
    const sizes: number[] = []
    const watchdog = stallWatchdog(60_000, n => sizes.push(n))
    watchdog.write(Buffer.from('abc'))
    watchdog.read()
    watchdog.destroy()
    watchdog._read(1)
    expect(sizes).toEqual([3])
  })
})
