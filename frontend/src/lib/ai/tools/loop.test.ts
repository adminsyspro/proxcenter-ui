/**
 * Guards the agentic loop's failure behaviour, which is where it earns its keep.
 *
 * The happy path is one round and an answer. Everything else is a hazard the
 * loop exists to absorb: a hallucinated tool name, a scope refusal, a tool that
 * throws, a result too large for a 7B context window, a model that never stops
 * asking for data, and a provider that rejects the tools payload outright. None
 * of those may reach the user as an error, and none may cost an unbounded number
 * of generations. These tests pin each one, plus the two invariants that are easy
 * to break silently: a stack trace must never travel to the model, and the final
 * turn must be sent with the tools withheld.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import {
  executeToolCalls,
  runToolRounds,
  MAX_TOOL_RESULT_CHARS,
  MAX_TOOL_ROUNDS,
} from './loop'
import type { ToolCallRequest } from './adapters'
import { ToolScopeError, type AiTool, type AiToolContext } from './types'

/* ------------------------------------------------------------------ */
/* Fixtures                                                           */
/* ------------------------------------------------------------------ */

function makeCtx(): AiToolContext {
  return {
    snapshot: {
      clusters: [],
      nodes: [],
      guests: [],
      summary: {
        totalGuests: 0,
        runningGuests: 0,
        stoppedGuests: 0,
        totalNodes: 0,
        onlineNodes: 0,
      },
      cached: false,
    },
    tenantId: 't',
    locale: 'en',
  }
}

function makeTool(
  name: string,
  execute: AiTool['execute'] = async () => ({ ok: true })
): AiTool {
  return {
    name,
    description: `Answers questions with ${name}.`,
    parameters: { type: 'object', properties: {} },
    execute,
  }
}

function call(name: string, args: Record<string, unknown> = {}, id?: string): ToolCallRequest {
  return { id, name, args }
}

/** An Ollama-shaped body asking for one tool. */
function toolTurn(name: string, args: Record<string, unknown> = {}) {
  return {
    message: {
      role: 'assistant',
      content: '',
      tool_calls: [{ function: { name, arguments: args } }],
    },
  }
}

/** An Ollama-shaped body carrying a plain answer. */
function answerTurn(text: string) {
  return { message: { role: 'assistant', content: text } }
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  // Each round logs a one-line tool summary for operators; keep it out of the
  // test output.
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

/* ------------------------------------------------------------------ */
/* executeToolCalls                                                   */
/* ------------------------------------------------------------------ */

describe('running the tool calls of one round', () => {
  it('serialises the tool value into the content and records a success', async () => {
    const tools = [makeTool('list_nodes', async () => ({ nodes: ['pve1', 'pve2'] }))]

    const { results, trace } = await executeToolCalls([call('list_nodes')], tools, makeCtx())

    expect(results).toHaveLength(1)
    expect(JSON.parse(results[0].content)).toEqual({ nodes: ['pve1', 'pve2'] })
    expect(trace).toHaveLength(1)
    expect(trace[0]).toMatchObject({ name: 'list_nodes', ok: true, truncated: false })
    expect(trace[0].error).toBeUndefined()
  })

  it('passes the call arguments and the context to the tool', async () => {
    const execute = vi.fn(async () => ({ ok: true }))
    const ctx = makeCtx()

    await executeToolCalls([call('list_nodes', { cluster: 'lab' })], [makeTool('list_nodes', execute)], ctx)

    expect(execute).toHaveBeenCalledWith({ cluster: 'lab' }, ctx)
  })

  it('answers a hallucinated tool name with the list of real tools instead of throwing', async () => {
    const tools = [makeTool('list_nodes'), makeTool('list_guests')]

    const { results, trace } = await executeToolCalls([call('restart_vm')], tools, makeCtx())

    const payload = JSON.parse(results[0].content)

    // Naming the real tools back is what gets the next round right rather than
    // the model repeating its invention.
    expect(payload.error).toContain('restart_vm')
    expect(payload.error).toContain('list_nodes')
    expect(payload.error).toContain('list_guests')
    expect(trace[0]).toMatchObject({ name: 'restart_vm', ok: false, error: 'unknown-tool' })
  })

  it('hands a scope refusal to the model in the tool refusal words', async () => {
    const tools = [makeTool('list_nodes', async () => {
      throw new ToolScopeError('Unknown cluster "prod". Visible clusters: lab.')
    })]

    const { results, trace } = await executeToolCalls([call('list_nodes')], tools, makeCtx())

    expect(JSON.parse(results[0].content).error).toBe('Unknown cluster "prod". Visible clusters: lab.')
    expect(trace[0]).toMatchObject({ ok: false, error: 'out-of-scope' })
  })

  it('reports a genuine tool failure without leaking a stack trace', async () => {
    const boom = new Error('ECONNREFUSED 10.0.0.5:8006')

    const tools = [makeTool('list_nodes', async () => { throw boom })]

    const { results, trace } = await executeToolCalls([call('list_nodes')], tools, makeCtx())

    const message = JSON.parse(results[0].content).error

    expect(message).toContain('list_nodes')
    expect(message).toContain('ECONNREFUSED')
    // The model is user-facing by proxy: no file paths, no frames.
    expect(message).not.toMatch(/\n\s+at\s/)
    expect(message).not.toContain('loop.test.ts')
    expect(message).not.toContain(String(boom.stack))
    expect(trace[0]).toMatchObject({ ok: false, error: 'failed' })
  })

  it('keeps a very long failure message bounded', async () => {
    const tools = [makeTool('list_nodes', async () => { throw new Error('x'.repeat(5000)) })]

    const { results } = await executeToolCalls([call('list_nodes')], tools, makeCtx())

    expect(JSON.parse(results[0].content).error.length).toBeLessThan(400)
  })

  it('truncates an oversized result and says so, to the model and to the trace', async () => {
    const blob = { rows: 'y'.repeat(MAX_TOOL_RESULT_CHARS + 2000) }
    const tools = [makeTool('list_guests', async () => blob)]

    const { results, trace } = await executeToolCalls([call('list_guests')], tools, makeCtx())

    const content = results[0].content

    expect(content.length).toBeLessThan(JSON.stringify(blob).length)
    expect(content.startsWith(`{"rows":"${'y'.repeat(20)}`)).toBe(true)
    // The marker is the signal to retry with a smaller limit.
    expect(content).toMatch(/truncated/)
    expect(content.trimEnd().endsWith(']')).toBe(true)
    expect(trace[0]).toMatchObject({ name: 'list_guests', ok: true, truncated: true })
  })

  it('leaves a result at the size ceiling untouched', async () => {
    const tools = [makeTool('list_guests', async () => 'z'.repeat(MAX_TOOL_RESULT_CHARS - 2))]

    const { results, trace } = await executeToolCalls([call('list_guests')], tools, makeCtx())

    expect(results[0].content).toHaveLength(MAX_TOOL_RESULT_CHARS)
    expect(results[0].content).not.toMatch(/truncated/)
    expect(trace[0].truncated).toBe(false)
  })

  it('serialises a tool that returned nothing as null', async () => {
    const tools = [makeTool('list_nodes', async () => undefined)]

    const { results, trace } = await executeToolCalls([call('list_nodes')], tools, makeCtx())

    expect(results[0].content).toBe('null')
    expect(trace[0].ok).toBe(true)
  })

  it('runs every call of a round larger than one batch', async () => {
    const execute = vi.fn(async () => ({ ok: true }))
    const tools = [makeTool('list_nodes', execute)]
    const calls = Array.from({ length: 7 }, (_, i) => call('list_nodes', { i }))

    const { results, trace } = await executeToolCalls(calls, tools, makeCtx())

    // Batching by concurrency must not drop the tail of the round.
    expect(execute).toHaveBeenCalledTimes(7)
    expect(results).toHaveLength(7)
    expect(trace).toHaveLength(7)
    expect(trace.map(t => t.args)).toEqual(calls.map(c => c.args))
  })

  it('keeps the results paired with the calls that produced them', async () => {
    const tools = [
      makeTool('list_nodes', async () => ({ from: 'nodes' })),
      makeTool('list_guests', async () => ({ from: 'guests' })),
    ]

    const { results } = await executeToolCalls(
      [call('list_guests', {}, 'call_1'), call('list_nodes', {}, 'call_2')],
      tools,
      makeCtx()
    )

    expect(results.map(r => r.call.id)).toEqual(['call_1', 'call_2'])
    expect(JSON.parse(results[0].content)).toEqual({ from: 'guests' })
    expect(JSON.parse(results[1].content)).toEqual({ from: 'nodes' })
  })

  it('does nothing with no call at all', async () => {
    const { results, trace } = await executeToolCalls([], [makeTool('list_nodes')], makeCtx())

    expect(results).toEqual([])
    expect(trace).toEqual([])
  })
})

/* ------------------------------------------------------------------ */
/* runToolRounds                                                      */
/* ------------------------------------------------------------------ */

/**
 * Snapshots the thread each turn saw.
 *
 * `runToolRounds` hands `send` a fresh copy per turn, so `send.mock.calls[n][0]`
 * is already safe to inspect; keeping the snapshot makes the intent of the
 * per-turn assertions below explicit and survives a change of that detail.
 */
function makeSend(bodies: any[]) {
  const seen: any[][] = []
  let turn = 0

  const send = vi.fn(async (messages: any[], _mode: 'auto' | 'none' | 'off') => {
    seen.push([...messages])

    return bodies[Math.min(turn++, bodies.length - 1)]
  })

  return { send, seen }
}

describe('driving the model until it answers', () => {
  it('returns the answer of a first turn that asked for no tool', async () => {
    const { send } = makeSend([answerTurn('You run 12 guests.')])

    const result = await runToolRounds({
      provider: 'ollama',
      tools: [makeTool('list_nodes')],
      ctx: makeCtx(),
      messages: [{ role: 'user', content: 'how many guests?' }],
      send,
    })

    expect(result.text).toBe('You run 12 guests.')
    expect(result.rounds).toBe(0)
    expect(result.trace).toEqual([])
    expect(result.toolsDisabled).toBe(false)
    expect(result.budgetExhausted).toBe(false)
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][1]).toBe('auto')
  })

  it('offers no tools when the registry is empty', async () => {
    const { send } = makeSend([answerTurn('hello')])

    const result = await runToolRounds({
      provider: 'ollama',
      tools: [],
      ctx: makeCtx(),
      messages: [{ role: 'user', content: 'hi' }],
      send,
    })

    expect(send.mock.calls[0][1]).toBe('off')
    expect(result.text).toBe('hello')
  })

  it('feeds the tool result back and answers on the second turn', async () => {
    const bodies = [toolTurn('list_nodes', { cluster: 'lab' }), answerTurn('pve1 is the busiest.')]
    const { send, seen } = makeSend(bodies)

    const result = await runToolRounds({
      provider: 'ollama',
      tools: [makeTool('list_nodes', async () => ({ nodes: ['pve1'] }))],
      ctx: makeCtx(),
      messages: [{ role: 'user', content: 'which host is busiest?' }],
      send,
    })

    expect(send).toHaveBeenCalledTimes(2)
    expect(seen[0]).toEqual([{ role: 'user', content: 'which host is busiest?' }])

    // The second turn must see the assistant turn that asked for the tool and
    // the tool result that answered it, in that order.
    expect(seen[1]).toHaveLength(3)
    expect(seen[1][1]).toBe(bodies[0].message)
    expect(seen[1][2]).toEqual({ role: 'tool', tool_name: 'list_nodes', content: '{"nodes":["pve1"]}' })

    expect(result.text).toBe('pve1 is the busiest.')
    expect(result.rounds).toBe(1)
    expect(result.trace).toHaveLength(1)
    expect(result.trace[0]).toMatchObject({ name: 'list_nodes', ok: true })
    expect(result.messages).toHaveLength(3)
    expect(result.budgetExhausted).toBe(false)
  })

  it('announces the calls of a round before running them', async () => {
    const order: string[] = []
    const { send } = makeSend([toolTurn('list_nodes', { cluster: 'lab' }), answerTurn('done')])

    const onToolCalls = vi.fn((calls: ToolCallRequest[]) => {
      order.push(`announced:${calls.map(c => c.name).join(',')}`)
    })

    await runToolRounds({
      provider: 'ollama',
      tools: [makeTool('list_nodes', async () => { order.push('executed'); return { ok: true } })],
      ctx: makeCtx(),
      messages: [{ role: 'user', content: 'hosts?' }],
      send,
      onToolCalls,
    })

    // The UI shows "checking the hosts..." from this callback, so it has to fire
    // before the work, not after it.
    expect(order).toEqual(['announced:list_nodes', 'executed'])
    expect(onToolCalls).toHaveBeenCalledTimes(1)
    expect(onToolCalls.mock.calls[0][0]).toEqual([{ name: 'list_nodes', args: { cluster: 'lab' } }])
  })

  it('stops a model that never stops asking, and forces a toolless conclusion', async () => {
    const { send } = makeSend([toolTurn('list_nodes')])

    const result = await runToolRounds({
      provider: 'ollama',
      tools: [makeTool('list_nodes')],
      ctx: makeCtx(),
      messages: [{ role: 'user', content: 'why?' }],
      send,
    })

    // One turn per round, plus the turn that spends the budget, plus the final
    // toolless ask for a conclusion.
    expect(send.mock.calls.length).toBeLessThanOrEqual(MAX_TOOL_ROUNDS + 2)
    expect(send.mock.calls.at(-1)?.[1]).toBe('none')
    expect(result.budgetExhausted).toBe(true)
    expect(result.rounds).toBe(MAX_TOOL_ROUNDS)
    expect(result.trace).toHaveLength(MAX_TOOL_ROUNDS)
  })

  it('honours a tighter round budget than the default', async () => {
    const { send } = makeSend([toolTurn('list_nodes')])

    const result = await runToolRounds({
      provider: 'ollama',
      tools: [makeTool('list_nodes')],
      ctx: makeCtx(),
      messages: [{ role: 'user', content: 'why?' }],
      send,
      maxRounds: 1,
    })

    expect(send).toHaveBeenCalledTimes(3)
    expect(result.rounds).toBe(1)
    expect(result.budgetExhausted).toBe(true)
  })

  it('retries once without tools when the provider rejects the tools payload', async () => {
    const send = vi.fn()
      .mockRejectedValueOnce(new Error('llama2 does not support tools'))
      .mockResolvedValueOnce(answerTurn('You run 12 guests.'))

    const result = await runToolRounds({
      provider: 'ollama',
      tools: [makeTool('list_nodes')],
      ctx: makeCtx(),
      messages: [{ role: 'user', content: 'how many guests?' }],
      send,
    })

    expect(send).toHaveBeenCalledTimes(2)
    expect(send.mock.calls[0][1]).toBe('auto')
    expect(send.mock.calls[1][1]).toBe('off')
    expect(result.toolsDisabled).toBe(true)
    expect(result.text).toBe('You run 12 guests.')
    expect(result.trace).toEqual([])
    expect(result.rounds).toBe(0)
  })

  it('propagates a real transport failure instead of answering without tools', async () => {
    const send = vi.fn(async () => { throw new Error('connect ECONNREFUSED 127.0.0.1:11434') })

    await expect(runToolRounds({
      provider: 'ollama',
      tools: [makeTool('list_nodes')],
      ctx: makeCtx(),
      messages: [{ role: 'user', content: 'hi' }],
      send,
    })).rejects.toThrow(/ECONNREFUSED/)

    // No silent second attempt: an outage must not look like an answer.
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('gives up when the toolless retry fails too', async () => {
    const send = vi.fn()
      .mockRejectedValueOnce(new Error('model does not support tools'))
      .mockRejectedValueOnce(new Error('model does not support tools'))

    await expect(runToolRounds({
      provider: 'ollama',
      tools: [makeTool('list_nodes')],
      ctx: makeCtx(),
      messages: [{ role: 'user', content: 'hi' }],
      send,
    })).rejects.toThrow(/does not support tools/)

    expect(send).toHaveBeenCalledTimes(2)
  })

  it('leaves the message array it was given untouched', async () => {
    const messages = [{ role: 'user', content: 'hosts?' }]
    const { send } = makeSend([toolTurn('list_nodes'), answerTurn('done')])

    await runToolRounds({
      provider: 'ollama',
      tools: [makeTool('list_nodes')],
      ctx: makeCtx(),
      messages,
      send,
    })

    expect(messages).toHaveLength(1)
  })
})
