/**
 * In-band activity frames for the streamed AI chat (#459).
 *
 * The streaming route relays the answer as plain text, token by token. While
 * the model runs tool rounds nothing reaches the browser, so the drawer shows
 * a generic spinner for 10 to 20 seconds and, once the answer lands, nothing
 * tells the user which data was consulted. Rather than switch the whole stream
 * to SSE, tool activity travels as small JSON records interleaved with the
 * prose, each opened by a marker byte no language model produces when writing
 * text and closed by a newline.
 *
 * Pure module, shared by the route (encoder) and the drawer (decoder): no Next
 * or React import belongs here.
 */

import { sanitizeActionCard, sanitizeActionPlan } from './actions/cards'
import type { ActionCard, ActionPlan } from './actions/types'
import { sanitizeChart, type AiChart } from './charts'

/** ASCII record separator: never produced by a language model writing prose. */
export const FRAME_MARK = ''

export type StreamFrame =
  /** A round of tool calls is starting. */
  | { type: 'tool'; names: string[] }
  /** What was consulted over the whole conversation, sent once at the end. */
  | { type: 'trace'; calls: Array<{ name: string; ok: boolean }> }
  /** What the widget plots under the answer, sent after the trace. */
  | { type: 'charts'; charts: AiChart[] }
  /** The signed action cards the assistant proposed, sent after the charts. */
  | { type: 'actions'; cards: ActionCard[]; plans: ActionPlan[] }

export type DecodedChunk = { text: string; frames: StreamFrame[] }

export function encodeFrame(frame: StreamFrame): string {
  return `${FRAME_MARK}${JSON.stringify(frame)}\n`
}

function parseFrame(raw: string): StreamFrame | null {
  try {
    const parsed = JSON.parse(raw)

    if (parsed?.type === 'tool' && Array.isArray(parsed.names)) {
      return { type: 'tool', names: parsed.names.map(String) }
    }

    if (parsed?.type === 'trace' && Array.isArray(parsed.calls)) {
      return {
        type: 'trace',
        calls: parsed.calls
          .filter((c: unknown) => c && typeof c === 'object')
          .map((c: any) => ({ name: String(c.name), ok: Boolean(c.ok) })),
      }
    }

    if (parsed?.type === 'charts' && Array.isArray(parsed.charts)) {
      return {
        type: 'charts',
        charts: parsed.charts.map(sanitizeChart).filter((c: AiChart | null): c is AiChart => c !== null),
      }
    }

    if (parsed?.type === 'actions' && (Array.isArray(parsed.cards) || Array.isArray(parsed.plans))) {
      return {
        type: 'actions',
        cards: (Array.isArray(parsed.cards) ? parsed.cards : [])
          .map(sanitizeActionCard)
          .filter((c: ActionCard | null): c is ActionCard => c !== null),
        plans: (Array.isArray(parsed.plans) ? parsed.plans : [])
          .map(sanitizeActionPlan)
          .filter((p: ActionPlan | null): p is ActionPlan => p !== null),
      }
    }
  } catch {
    // Malformed frame: dropped below, never surfaced as prose.
  }

  return null
}

/**
 * Incremental decoder for a stream mixing prose and frames.
 *
 * Network chunks split anywhere, including inside a frame, so an unfinished
 * frame is buffered until its newline arrives and only the prose seen so far
 * is returned. A frame whose payload is not valid JSON is dropped: showing it
 * as text would print the machinery in the chat window.
 */
export function createFrameDecoder(): { push(chunk: string): DecodedChunk; flush(): DecodedChunk } {
  // The frame being assembled, or null while reading prose.
  let pending: string | null = null

  const push = (chunk: string): DecodedChunk => {
    let text = ''
    const frames: StreamFrame[] = []
    let rest = chunk

    while (rest.length > 0) {
      if (pending !== null) {
        const end = rest.indexOf('\n')

        if (end === -1) {
          pending += rest
          rest = ''
          break
        }

        const frame = parseFrame(pending + rest.slice(0, end))

        if (frame) frames.push(frame)
        pending = null
        rest = rest.slice(end + 1)
        continue
      }

      const start = rest.indexOf(FRAME_MARK)

      if (start === -1) {
        text += rest
        rest = ''
        break
      }

      text += rest.slice(0, start)
      pending = ''
      rest = rest.slice(start + FRAME_MARK.length)
    }

    return { text, frames }
  }

  const flush = (): DecodedChunk => {
    // A frame cut off by the end of the stream is incomplete by definition:
    // there is nothing safe to show, so it is discarded.
    pending = null

    return { text: '', frames: [] }
  }

  return { push, flush }
}
