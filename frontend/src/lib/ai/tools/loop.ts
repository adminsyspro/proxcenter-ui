/**
 * The agentic loop.
 *
 * The routes own the HTTP call (they hold the provider settings and the SSRF
 * guard); this module owns the orchestration: ask, run whatever tools the model
 * requested, feed the results back, repeat until it answers or the budget runs
 * out. Keeping the transport in a callback is what lets the streaming and
 * non-streaming routes share one loop.
 */

import {
  assistantTurnFor,
  extractTextToolCall,
  isToolsUnsupportedError,
  parseAssistantText,
  parseToolCalls,
  toolResultTurns,
  type AiProvider,
  type ToolCallRequest,
} from '@/lib/ai/tools/adapters'
import { ToolArgumentError, ToolScopeError, type AiTool, type AiToolContext } from '@/lib/ai/tools/types'

/**
 * How many times the model may come back for more data.
 *
 * Four is enough for the questions #459 lists (a ranking, then one detail
 * lookup, then a cross-check) while bounding the worst case on a slow local
 * model, where every round is a full generation.
 */
export const MAX_TOOL_ROUNDS = 4

/**
 * Ceiling on one serialised tool result.
 *
 * A 7B model served by Ollama runs a small context window, and an unbounded
 * OSD or guest list would push the question itself out of it. Tools take a
 * `limit`, so a truncated result is a signal to narrow the query, and the
 * marker says exactly that.
 */
export const MAX_TOOL_RESULT_CHARS = 8000

/** How many tool calls from one round run at the same time. */
const TOOL_CONCURRENCY = 4

export type ToolTraceEntry = {
  name: string
  args: Record<string, unknown>
  ok: boolean
  /** Set when the tool refused or failed. Surfaced to the model, not the user. */
  error?: string
  /** The refusal or failure text handed to the model, for the closing fallback. */
  detail?: string
  durationMs: number
  truncated: boolean
}

/**
 * How one turn treats the tool declaration.
 *
 * The distinction between `none` and `off` is load-bearing. Once a thread holds
 * `tool_use` / `tool_result` blocks, Anthropic rejects a request that omits the
 * `tools` field outright, so the closing turn must keep the declaration and
 * merely forbid new calls (`none`). `off` drops the field entirely and is only
 * valid before any tool turn exists, which is the degradation path for a model
 * that cannot take the field at all.
 */
export type ToolMode = 'auto' | 'none' | 'off'

export type SendTurn = (messages: any[], mode: ToolMode) => Promise<any>

export type ToolRoundsResult = {
  /** The full thread, tool turns included. */
  messages: any[]
  /** The model's final answer. */
  text: string
  trace: ToolTraceEntry[]
  rounds: number
  /** True when the provider rejected the tools payload and we degraded. */
  toolsDisabled: boolean
  /** True when the model was still asking for tools when the budget ran out. */
  budgetExhausted: boolean
}

function serialiseResult(value: unknown): { content: string; truncated: boolean } {
  let raw: string

  try {
    raw = JSON.stringify(value ?? null)
  } catch {
    raw = String(value)
  }

  if (raw.length <= MAX_TOOL_RESULT_CHARS) return { content: raw, truncated: false }

  const omitted = raw.length - MAX_TOOL_RESULT_CHARS

  return {
    content: `${raw.slice(0, MAX_TOOL_RESULT_CHARS)}\n... [truncated, ${omitted} characters omitted. Call the tool again with a smaller limit or a cluster filter to see the rest.]`,
    truncated: true,
  }
}

/**
 * An argument the schema does not declare is a mistake to report, not to skip.
 *
 * Skipping it is what turned a recoverable error into a dead end: asked to
 * pass "cluster", llama3.1:8b sent `clusterName`, the tool ignored the key,
 * answered with the very same refusal, and the model concluded the refusal
 * was about something else. Empty values are tolerated: small models pad
 * calls with `""` and `null` for the arguments they do not use.
 */
function rejectUnknownArguments(tool: AiTool, args: Record<string, unknown>) {
  const known = Object.keys(tool.parameters.properties)

  // A schema declaring nothing cannot say what it accepts; every registered
  // tool declares its arguments, so this only ever concerns bare fixtures.
  if (known.length === 0) return

  const unknown = Object.keys(args).filter(key => !known.includes(key) && args[key] !== '' && args[key] !== null && args[key] !== undefined)

  if (unknown.length === 0) return

  throw new ToolArgumentError(
    `Unknown argument${unknown.length > 1 ? 's' : ''} ${unknown.map(k => `"${k}"`).join(', ')} for ${tool.name}. Accepted arguments: ${known.join(', ')}.`
  )
}

/**
 * What the user reads when the round budget is spent and the closing turn is
 * still a tool call written as text. A raw JSON call is never an answer; the
 * last refusal or failure the tools gave is the honest one.
 */
export function budgetFallbackText(locale: string, trace: ToolTraceEntry[]): string {
  const lastFailure = [...trace].reverse().find(t => !t.ok)
  const fr = locale === 'fr'

  if (lastFailure?.detail) {
    return fr
      ? `Je n'ai pas pu obtenir cette donnée. Dernière erreur : ${lastFailure.detail}`
      : `I could not retrieve that data. Last error: ${lastFailure.detail}`
  }

  return fr
    ? 'Je n\'ai pas pu conclure dans le nombre de consultations autorisé. Reformule la question ou précise le cluster.'
    : 'I could not conclude within the allowed number of lookups. Rephrase the question or name the cluster.'
}

export async function executeToolCalls(
  calls: ToolCallRequest[],
  tools: AiTool[],
  ctx: AiToolContext
): Promise<{ results: Array<{ call: ToolCallRequest; content: string }>; trace: ToolTraceEntry[] }> {
  const results: Array<{ call: ToolCallRequest; content: string }> = []
  const trace: ToolTraceEntry[] = []

  for (let i = 0; i < calls.length; i += TOOL_CONCURRENCY) {
    const batch = calls.slice(i, i + TOOL_CONCURRENCY)

    const settled = await Promise.all(batch.map(async call => {
      const startedAt = Date.now()
      const tool = tools.find(t => t.name === call.name)

      if (!tool) {
        // A hallucinated tool name. Naming the real ones back is what gets the
        // next round right instead of the model repeating the invention.
        const content = JSON.stringify({
          error: `Unknown tool "${call.name}". Available tools: ${tools.map(t => t.name).join(', ')}.`,
        })

        return {
          entry: {
            name: call.name,
            args: call.args,
            ok: false,
            error: 'unknown-tool',
            durationMs: Date.now() - startedAt,
            truncated: false,
          },
          result: { call, content },
        }
      }

      try {
        rejectUnknownArguments(tool, call.args)

        const value = await tool.execute(call.args, ctx)
        const { content, truncated } = serialiseResult(value)

        return {
          entry: { name: call.name, args: call.args, ok: true, durationMs: Date.now() - startedAt, truncated },
          result: { call, content },
        }
      } catch (e: any) {
        // A scope refusal or a rejected argument is a legitimate answer: the
        // model asked for something outside the caller's perimeter, or with a
        // value the tool cannot take, and must be told so in words it can act
        // on. Anything else is a real failure and stays generic upstream.
        const isScope = e instanceof ToolScopeError
        const isArgument = e instanceof ToolArgumentError
        const isExpected = isScope || isArgument

        if (!isExpected) console.error(`[ai-tools] ${call.name} failed:`, e)

        const message = isExpected
          ? String(e?.message || 'Out of scope.')
          : `The "${call.name}" lookup failed: ${String(e?.message || e).slice(0, 200)}`

        return {
          entry: {
            name: call.name,
            args: call.args,
            ok: false,
            error: isScope ? 'out-of-scope' : isArgument ? 'bad-argument' : 'failed',
            detail: message,
            durationMs: Date.now() - startedAt,
            truncated: false,
          },
          result: { call, content: JSON.stringify({ error: message }) },
        }
      }
    }))

    for (const s of settled) {
      trace.push(s.entry)
      results.push(s.result)
    }
  }

  // The streaming path relays plain text, so a tool round is invisible from the
  // browser. One compact line per round is what lets an operator tell "the
  // model consulted Ceph and answered" from "the model made it up".
  console.log(
    `[ai-tools] ${trace.map(t => `${t.name}(${t.ok ? `${t.durationMs}ms${t.truncated ? ', truncated' : ''}` : t.error})`).join(' ')}`
  )

  return { results, trace }
}

/**
 * Drive the model until it answers.
 *
 * `send` performs one turn and returns the parsed provider response. It is
 * called with `includeTools = false` on the degradation path and for the final
 * turn once the round budget is spent, so a model that keeps asking for data
 * still produces a conclusion instead of a truncated thread.
 */
export async function runToolRounds(opts: {
  provider: AiProvider
  tools: AiTool[]
  ctx: AiToolContext
  messages: any[]
  send: SendTurn
  maxRounds?: number
  onToolCalls?: (calls: ToolCallRequest[]) => void
}): Promise<ToolRoundsResult> {
  const { provider, tools, ctx, send, onToolCalls } = opts
  const maxRounds = opts.maxRounds ?? MAX_TOOL_ROUNDS

  const messages = [...opts.messages]
  const trace: ToolTraceEntry[] = []

  let mode: ToolMode = tools.length > 0 ? 'auto' : 'off'
  let toolsDisabled = false
  let degradeAttempted = false
  let rounds = 0

  while (rounds <= maxRounds) {
    let json: any

    try {
      // A copy per turn: the thread is mutated below, and handing the live
      // array to the caller would let it observe a later state.
      json = await send([...messages], mode)
    } catch (e: any) {
      const message = String(e?.message || e)

      // One retry without tools, for a model or gateway that cannot take them.
      // Only valid while the thread is still clean: once it holds tool blocks,
      // dropping the declaration produces a request Anthropic rejects, so a
      // late failure is a real failure and propagates.
      if (mode === 'auto' && !degradeAttempted && rounds === 0 && isToolsUnsupportedError(message)) {
        console.warn('[ai-tools] provider rejected the tools payload, falling back to a prompt-only turn')
        mode = 'off'
        toolsDisabled = true
        degradeAttempted = true
        continue
      }

      throw e
    }

    let calls = mode === 'auto' ? parseToolCalls(provider, json) : []

    // A model that wrote its call as prose rather than as a tool call. Left
    // alone, the raw JSON is what the user reads.
    if (calls.length === 0 && mode === 'auto') {
      const textCall = extractTextToolCall(parseAssistantText(provider, json), tools.map(t => t.name))

      if (textCall) {
        console.warn(`[ai-tools] recovered a text-form call to ${textCall.name} from the model output`)
        calls = [textCall]
      }
    }

    if (calls.length === 0) {
      return {
        messages,
        text: parseAssistantText(provider, json),
        trace,
        rounds,
        toolsDisabled,
        budgetExhausted: false,
      }
    }

    if (rounds === maxRounds) {
      // Budget spent while the model still wanted data. Take the thread as it
      // stands and ask for a conclusion with new calls forbidden, so it answers
      // from what it already gathered. `none` rather than `off`: the thread
      // holds tool blocks by now, and dropping the declaration entirely makes
      // the request invalid for Anthropic.
      const finalJson = await send([...messages], 'none')
      const finalText = parseAssistantText(provider, finalJson)
      // A closing turn that is still a call written as prose is not an answer.
      const stillCalling = extractTextToolCall(finalText, tools.map(t => t.name))

      return {
        messages,
        text: stillCalling ? budgetFallbackText(ctx.locale, trace) : finalText,
        trace,
        rounds,
        toolsDisabled,
        budgetExhausted: true,
      }
    }

    onToolCalls?.(calls)

    messages.push(assistantTurnFor(provider, json))

    const { results, trace: roundTrace } = await executeToolCalls(calls, tools, ctx)

    trace.push(...roundTrace)
    messages.push(...toolResultTurns(provider, results))
    rounds++
  }

  // Unreachable: the loop always returns from inside. Kept for the type.
  return { messages, text: '', trace, rounds, toolsDisabled, budgetExhausted: true }
}
