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
import { cardsFromToolResult, collectActionCards, type ActionCardsPayload } from '@/lib/ai/actions/cards'
import { chartFromToolResult, type AiChart } from '@/lib/ai/charts'
import { collectTargetChoices } from '@/lib/ai/choices'
import { invokeTool } from '@/lib/tools/invoke'
import type { CatalogTool, TargetChoice, ToolContext } from '@/lib/tools/types'

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
  /** What the widget can plot from the result, see `charts.ts`. Never sent to the model. */
  chart?: AiChart
  /** The signed action cards a proposal tool produced, see `actions/cards.ts`. Never sent to the model. */
  actions?: ActionCardsPayload
  /** The targets an ambiguous reference matched, offered as clickable choices, see `choices.ts`. Never sent to the model. */
  choices?: TargetChoice[]
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

/**
 * `retryEmpty` marks the single replay of an empty turn: a provider with a
 * thinking channel can turn it off for that turn (see `ollamaCanThink`).
 */
export type SendTurn = (messages: any[], mode: ToolMode, opts?: { retryEmpty?: boolean }) => Promise<any>

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

/** Said once to a model that still calls a tool with the round budget spent. */
export const CLOSING_NUDGE =
  'No lookups are left for this question. Answer me now from the tool results above, in my language; do not call a tool.'

/**
 * What the user reads when the round budget is spent and the closing turn is
 * still a tool call written as text. A raw JSON call is never an answer; the
 * refusal the last call got is the honest one. An earlier one is not: a
 * later call recovered from it (lab, roadmap#188: "Last error: several guests
 * are named NginX" under 17 successful simulations).
 */
export function budgetFallbackText(locale: string, trace: ToolTraceEntry[]): string {
  const last = trace[trace.length - 1]
  const lastFailure = last && !last.ok ? last : undefined
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

/**
 * What the user reads when the model closed with an empty turn right after a
 * successful proposal. The card is the answer, so the line points at it
 * instead of reporting a failure above a perfectly valid card.
 */
export function proposedActionText(locale: string): string {
  return locale === 'fr'
    ? 'J\'ai proposé l\'action ci-dessous. Vérifie-la, puis approuve-la sur la carte.'
    : 'I proposed the action below. Check it, then approve it on the card.'
}

/**
 * What the user reads above the clickable choices when the model closed with
 * an empty turn: the rows are the answer, so the line points at them.
 */
export function ambiguousTargetText(locale: string): string {
  return locale === 'fr'
    ? 'Plusieurs cibles correspondent : choisis celle que tu veux.'
    : 'Several targets match: pick the one you want.'
}

/**
 * The text of a turn that stayed empty after its retry: the card pointer when
 * a proposal succeeded, the choice pointer when a target was ambiguous, else
 * the failure line.
 */
export function emptyClosingText(
  locale: string,
  trace: ReadonlyArray<{ actions?: ActionCardsPayload; choices?: TargetChoice[] }>
): string {
  const { cards, plans } = collectActionCards(trace)

  if (cards.length || plans.length) return proposedActionText(locale)

  return collectTargetChoices(trace).length ? ambiguousTargetText(locale) : emptyAnswerText(locale)
}

/**
 * What the user reads when the model returned an empty turn twice in a row.
 *
 * Thinking models served by Ollama sometimes write their whole answer into the
 * separate `thinking` channel and leave `content` empty: measured on
 * qwen3.5:9b against the lab (#459), the correct answer sat in `thinking`,
 * `done_reason` was `stop` after 69 tokens, so this is not a truncation. The
 * loops retry such a turn once; a blank chat bubble is never shown.
 */
export function emptyAnswerText(locale: string): string {
  return locale === 'fr'
    ? 'Le modèle n\'a renvoyé aucune réponse. Repose la question.'
    : 'The model returned no answer. Ask the question again.'
}

/**
 * What the user wrote, from the request body rather than the provider thread:
 * for Ollama the last user turn also carries the whole system prompt, which
 * names every cluster.
 */
export function userTextOf(messages: Array<{ role?: string; content?: unknown }>): string {
  return messages
    .filter(m => m?.role === 'user' && typeof m.content === 'string')
    .map(m => m.content as string)
    .join('\n')
    .toLowerCase()
}

/**
 * Drop a `cluster` the user never named.
 *
 * Asked which storage had the least free space, llama3.1:8b passed
 * cluster="PVE-PROD" on 5 of 8 calls with two clusters visible and none named,
 * then answered for PVE-PROD alone; no tool description stopped it. Without the
 * filter, every tool covers every visible cluster, so the answer can only get
 * wider, never wrong. Only the assistant does this: an MCP client names its
 * own arguments.
 */
export function groundClusterArgument(
  args: Record<string, unknown>,
  userText: string | undefined
): { args: Record<string, unknown>; dropped?: string } {
  const cluster = typeof args?.cluster === 'string' ? args.cluster.trim() : ''

  if (userText === undefined || !cluster || userText.includes(cluster.toLowerCase())) return { args }

  const { cluster: _dropped, ...rest } = args

  return { args: rest, dropped: cluster }
}

function traceOutcome(t: ToolTraceEntry): string {
  if (!t.ok) return String(t.error)

  return t.truncated ? `${t.durationMs}ms, truncated` : `${t.durationMs}ms`
}

export async function executeToolCalls(
  calls: ToolCallRequest[],
  tools: CatalogTool[],
  ctx: ToolContext,
  { userText }: { userText?: string } = {}
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

      const grounded = groundClusterArgument(call.args, userText)

      if (grounded.dropped) console.warn(`[ai-tools] ${call.name}: ignored cluster="${grounded.dropped}", the user named no such cluster`)

      const outcome = await invokeTool(tool, grounded.args, ctx)

      if (outcome.ok === true) {
        const { content, truncated } = serialiseResult(outcome.value)
        const chart = chartFromToolResult(call.name, outcome.value)
        const actions = cardsFromToolResult(call.name, outcome.value)

        return {
          entry: {
            name: call.name,
            args: call.args,
            ok: true,
            durationMs: Date.now() - startedAt,
            truncated,
            ...(chart ? { chart } : {}),
            ...(actions ? { actions } : {}),
          },
          result: { call, content },
        }
      }

      return {
        entry: {
          name: call.name,
          args: call.args,
          ok: false,
          error: outcome.error,
          detail: outcome.message,
          durationMs: Date.now() - startedAt,
          truncated: false,
          ...(outcome.choices?.length ? { choices: outcome.choices } : {}),
        },
        result: { call, content: JSON.stringify({ error: outcome.message }) },
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
  console.log(`[ai-tools] ${trace.map(t => `${t.name}(${traceOutcome(t)})`).join(' ')}`)

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
  tools: CatalogTool[]
  ctx: ToolContext
  messages: any[]
  send: SendTurn
  maxRounds?: number
  onToolCalls?: (calls: ToolCallRequest[]) => void
  /** The user's own words (`userTextOf` on the request body), to ground model-chosen filters. */
  userText?: string
}): Promise<ToolRoundsResult> {
  const { provider, tools, ctx, send, onToolCalls, userText } = opts
  const maxRounds = opts.maxRounds ?? MAX_TOOL_ROUNDS

  const messages = [...opts.messages]
  const trace: ToolTraceEntry[] = []

  let mode: ToolMode = tools.length > 0 ? 'auto' : 'off'
  let toolsDisabled = false
  let degradeAttempted = false
  let emptyRetried = false
  let replayingEmpty = false
  let rounds = 0

  while (rounds <= maxRounds) {
    let json: any

    try {
      // A copy per turn: the thread is mutated below, and handing the live
      // array to the caller would let it observe a later state. The replay of
      // an empty turn says so, so the provider can turn thinking off for it.
      json = replayingEmpty ? await send([...messages], mode, { retryEmpty: true }) : await send([...messages], mode)
      replayingEmpty = false
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
      const text = parseAssistantText(provider, json)

      // An empty turn is not an answer, see `emptyAnswerText`: ask once more.
      if (!text.trim() && !emptyRetried) {
        console.warn('[ai-tools] the model returned an empty turn, retrying it once')
        emptyRetried = true
        replayingEmpty = true
        continue
      }

      return {
        messages,
        text: text.trim() ? text : emptyClosingText(ctx.locale, trace),
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

    const { results, trace: roundTrace } = await executeToolCalls(calls, tools, ctx, { userText })

    trace.push(...roundTrace)
    messages.push(...toolResultTurns(provider, results))
    rounds++
  }

  // Unreachable: the loop always returns from inside. Kept for the type.
  return { messages, text: '', trace, rounds, toolsDisabled, budgetExhausted: true }
}
