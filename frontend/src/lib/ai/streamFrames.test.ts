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

describe('the actions frame (roadmap#188)', () => {
  const card = (over: Record<string, unknown> = {}) => ({
    actionId: 'a1',
    kind: 'reboot',
    tier: 'safe',
    target: { connId: 'c1', cluster: 'PVE-PROD', node: 'pve1', vmid: 101, guestKind: 'qemu', name: 'db-01' },
    params: { snapshotName: 'x', n: 2, force: true, bad: { nested: 1 } },
    preflight: { ok: true, checks: [{ level: 'warn', text: 'busy' }, { level: 'nope', text: 'x' }] },
    expiresAt: 5,
    token: 'tok',
    extra: 'dropped',
    ...over,
  })

  it('round-trips, keeping only the typed fields and deriving the tier', () => {
    const { frames } = decodeAll([encodeFrame({ type: 'actions', cards: [card() as any], plans: [] })])
    const out = frames[0] as Extract<StreamFrame, { type: 'actions' }>

    expect(out.cards).toHaveLength(1)
    expect(out.cards[0]).toEqual({
      actionId: 'a1',
      kind: 'reboot',
      tier: 'disruptive',
      target: { connId: 'c1', cluster: 'PVE-PROD', node: 'pve1', vmid: 101, guestKind: 'qemu', name: 'db-01' },
      params: { snapshotName: 'x', n: 2, force: true },
      preflight: { ok: true, checks: [{ level: 'warn', text: 'busy' }] },
      expiresAt: 5,
      token: 'tok',
    })
  })

  it('is split-safe like the other frames', () => {
    const stream = `hi${encodeFrame({ type: 'actions', cards: [card() as any], plans: [] })}`
    const whole = decodeAll([stream])
    const cut = decodeAll([stream.slice(0, 30), stream.slice(30)])

    expect(cut).toEqual(whole)
  })

  it.each([
    ['no token', { token: undefined }],
    ['a kind outside the whitelist', { kind: 'delete_vm' }],
    ['an incomplete target', { target: { connId: 'c1', cluster: 'x' } }],
    ['no actionId', { actionId: 3 }],
  ])('drops a card with %s', (_l, over) => {
    const { frames } = decodeAll([encodeFrame({ type: 'actions', cards: [card(over) as any, card() as any], plans: [] })])

    expect((frames[0] as any).cards).toHaveLength(1)
  })

  it('drops the card of a plan step but keeps the step', () => {
    const plan = {
      planId: 'p1',
      finding: 'host_memory',
      title: 'Free memory',
      steps: [
        { step: 1, card: card({ token: 1 }) },
        { step: 2, manual: { text: 'Check', href: '/x' } },
        { step: 3, card: card() },
      ],
    }
    const { frames } = decodeAll([encodeFrame({ type: 'actions', cards: [], plans: [plan as any, { planId: 'bad' } as any] })])
    const out = frames[0] as Extract<StreamFrame, { type: 'actions' }>

    expect(out.plans).toHaveLength(1)
    expect(out.plans[0].steps.map(s => [s.step, Boolean(s.card), Boolean(s.manual)])).toEqual([[1, false, false], [2, false, true], [3, true, false]])
  })
})

describe('manual plan step links (roadmap#188)', () => {
  const hrefOf = (href: unknown) => {
    const plan = { planId: 'p', finding: 'host_memory', title: 't', steps: [{ step: 1, manual: { text: 'Check', href } }] }
    const { frames } = decodeAll([encodeFrame({ type: 'actions', cards: [], plans: [plan as any] })])

    return (frames[0] as any).plans[0].steps[0].manual
  }

  it.each(['javascript:alert(1)', '//evil.example', 'https://x', '/a\\b', 'infra', 42])('drops the href %j, keeps the text', href => {
    expect(hrefOf(href)).toEqual({ text: 'Check', href: '' })
  })

  it('keeps a relative app path', () => {
    const href = '/infrastructure/inventory?selectType=cluster&selectId=abc'

    expect(hrefOf(href)).toEqual({ text: 'Check', href })
  })
})
