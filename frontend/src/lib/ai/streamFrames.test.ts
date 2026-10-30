/**
 * The frame codec shared by the streaming route and the chat drawer (#459).
 *
 * The one property that matters: whatever way the network cuts the byte
 * stream, the decoder yields the same prose and the same frames. Everything
 * else is bookkeeping around that.
 */

import { describe, it, expect } from 'vitest'

import { createFrameDecoder, encodeFrame, FRAME_MARK, type StreamFrame } from './streamFrames'

const TOOL_FRAME: StreamFrame = { type: 'tool', names: ['rank_guest_hardware', 'list_ceph_osds'] }
const TRACE_FRAME: StreamFrame = {
  type: 'trace',
  calls: [{ name: 'rank_guest_hardware', ok: true }, { name: 'list_ceph_osds', ok: false }],
}

/** Feed the pieces in order, then flush, and gather everything that came out. */
function decodeAll(pieces: string[]) {
  const decoder = createFrameDecoder()
  let text = ''
  const frames: StreamFrame[] = []

  for (const piece of pieces) {
    const out = decoder.push(piece)

    text += out.text
    frames.push(...out.frames)
  }

  const tail = decoder.flush()

  text += tail.text
  frames.push(...tail.frames)

  return { text, frames }
}

describe('encodeFrame', () => {
  it('opens with the record separator and closes with a newline', () => {
    const encoded = encodeFrame(TOOL_FRAME)

    expect(encoded.startsWith(FRAME_MARK)).toBe(true)
    expect(encoded.endsWith('\n')).toBe(true)
    expect(JSON.parse(encoded.slice(FRAME_MARK.length, -1))).toEqual(TOOL_FRAME)
  })

  it('uses a marker no model writes in prose', () => {
    expect(FRAME_MARK).toBe('')
  })
})

describe('createFrameDecoder', () => {
  it('passes prose through untouched when there is no frame', () => {
    const { text, frames } = decodeAll(['pve1 ', 'is busiest\nand pve2 is idle'])

    expect(text).toBe('pve1 is busiest\nand pve2 is idle')
    expect(frames).toEqual([])
  })

  it('yields a frame followed by prose, in that order, out of one chunk', () => {
    const decoder = createFrameDecoder()
    const out = decoder.push(`${encodeFrame(TOOL_FRAME)}db-01 has 16 vCPUs`)

    expect(out.frames).toEqual([TOOL_FRAME])
    expect(out.text).toBe('db-01 has 16 vCPUs')
  })

  it('decodes two frames back to back', () => {
    const { text, frames } = decodeAll([`${encodeFrame(TOOL_FRAME)}${encodeFrame(TRACE_FRAME)}`])

    expect(frames).toEqual([TOOL_FRAME, TRACE_FRAME])
    expect(text).toBe('')
  })

  it('keeps prose that surrounds frames and never leaks the marker or the JSON', () => {
    const stream = `${encodeFrame(TOOL_FRAME)}db-01 has 16 vCPUs.${encodeFrame(TRACE_FRAME)}`
    const { text, frames } = decodeAll([stream])

    expect(text).toBe('db-01 has 16 vCPUs.')
    expect(text).not.toContain(FRAME_MARK)
    expect(text).not.toContain('"type"')
    expect(frames).toEqual([TOOL_FRAME, TRACE_FRAME])
  })

  it('buffers a frame split across two pushes until its newline arrives', () => {
    const decoder = createFrameDecoder()
    const encoded = encodeFrame(TOOL_FRAME)
    const cut = Math.floor(encoded.length / 2)

    const first = decoder.push(encoded.slice(0, cut))

    expect(first.text).toBe('')
    expect(first.frames).toEqual([])

    const second = decoder.push(`${encoded.slice(cut)}db-01`)

    expect(second.frames).toEqual([TOOL_FRAME])
    expect(second.text).toBe('db-01')
  })

  it('yields the same prose and frames whatever the split point', () => {
    const stream = `${encodeFrame(TOOL_FRAME)}db-01 has 16 vCPUs.\nSecond line.${encodeFrame(TRACE_FRAME)}`
    const expected = decodeAll([stream])

    expect(expected.text).toBe('db-01 has 16 vCPUs.\nSecond line.')
    expect(expected.frames).toEqual([TOOL_FRAME, TRACE_FRAME])

    for (let cut = 0; cut <= stream.length; cut++) {
      const result = decodeAll([stream.slice(0, cut), stream.slice(cut)])

      expect(result, `split at ${cut}`).toEqual(expected)
    }
  })

  it('survives a stream delivered one character at a time', () => {
    const stream = `Intro ${encodeFrame(TOOL_FRAME)}${encodeFrame(TRACE_FRAME)}answer`
    const result = decodeAll([...stream])

    expect(result.text).toBe('Intro answer')
    expect(result.frames).toEqual([TOOL_FRAME, TRACE_FRAME])
  })

  it('drops a malformed frame instead of showing it as text', () => {
    const { text, frames } = decodeAll([`${FRAME_MARK}{"type": "tool", "names": [\nafter`])

    expect(frames).toEqual([])
    expect(text).toBe('after')
  })

  it('drops a well-formed JSON frame of an unknown type', () => {
    const { text, frames } = decodeAll([`${FRAME_MARK}{"type": "surprise"}\nafter`])

    expect(frames).toEqual([])
    expect(text).toBe('after')
  })

  it('returns prose as it arrives, so flush() has nothing left to hand back', () => {
    const decoder = createFrameDecoder()

    expect(decoder.push('pve1 is busiest').text).toBe('pve1 is busiest')
    expect(decoder.flush()).toEqual({ text: '', frames: [] })
  })

  it('discards a frame the stream cut off on flush()', () => {
    const decoder = createFrameDecoder()

    expect(decoder.push(`answer${FRAME_MARK}{"type": "trace"`)).toEqual({ text: 'answer', frames: [] })
    expect(decoder.flush()).toEqual({ text: '', frames: [] })
    // The decoder is back to reading prose afterwards.
    expect(decoder.push('more').text).toBe('more')
  })

  it('carries the charts after the trace and drops one that is not a chart', () => {
    const chart = {
      kind: 'storage-usage',
      unit: '%',
      series: ['used'],
      rows: [
        { label: 'ZFS-Pool (pve1)', detail: 'PVE-PROD', values: [93.1] },
        { label: 'CephStoragePool', values: [86.8] },
      ],
    } as const
    const stream = `ZFS-Pool is the fullest.${encodeFrame(TRACE_FRAME)}${FRAME_MARK}${JSON.stringify({
      type: 'charts',
      charts: [chart, { kind: 'pie', rows: [] }],
    })}\n`

    const { text, frames } = decodeAll([stream.slice(0, 40), stream.slice(40)])

    expect(text).toBe('ZFS-Pool is the fullest.')
    expect(frames).toEqual([TRACE_FRAME, { type: 'charts', charts: [chart] }])
  })
})
