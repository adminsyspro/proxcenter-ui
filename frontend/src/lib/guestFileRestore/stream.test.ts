import { PassThrough, Readable } from 'node:stream'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SourceStallError, stallWatchdog } from './stream'

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
