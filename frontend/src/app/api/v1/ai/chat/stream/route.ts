export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'

import { getSetting } from '@/lib/db/settings'
import { openAiSecrets } from '@/lib/ai/settingsSecrets'
import { getCurrentTenantId } from "@/lib/tenant"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { getRequestLocale, languageInstruction, normalizeLocale, normalizeTimeZone } from '@/lib/ai/locale'
import { validateAIUrl } from '@/lib/ai/url-guard'
import { ollamaOptions, ollamaThread } from '@/lib/ai/ollama'
import { DEFAULT_OLLAMA_MODEL } from '@/lib/ai/qualifiedModels'
import { collectActionCards } from '@/lib/ai/actions/cards'
import { resolveAssistantTools } from '@/lib/ai/actions/resolve'
import { collectCharts } from '@/lib/ai/charts'
import { buildAiSystemPrompt } from '@/lib/ai/context'
import { buildToolContext } from '@/lib/tools/catalog'
import { coerceToolArgs, extractTextToolCall, toolResultTurns, toolsForProvider, type ToolCallRequest } from '@/lib/ai/tools/adapters'
import { budgetFallbackText, emptyAnswerText, executeToolCalls, MAX_TOOL_ROUNDS, userTextOf, type ToolTraceEntry } from '@/lib/ai/tools/loop'
import type { CatalogTool, ToolContext } from '@/lib/tools/types'
import { encodeFrame } from '@/lib/ai/streamFrames'
import { requireFeature } from '@/lib/auth/requireEnterprise'
import { Features } from '@/lib/license/features'

// Récupérer les paramètres IA (tenant-scoped)
async function getAISettings() {
  try {
    const tenantId = await getCurrentTenantId()
    const stored = await getSetting<any>('ai', tenantId)
    // Keys are sealed at rest (lib/ai/settingsSecrets); open them for the call.
    if (stored) return openAiSecrets(stored)
  } catch (e) {
    console.error('Failed to get AI settings:', e)
  }

  return {
    enabled: false,
    provider: 'ollama',
    ollamaUrl: 'http://localhost:11434',
    ollamaModel: DEFAULT_OLLAMA_MODEL
  }
}

type OllamaTurn = {
  /** Text relayed to the client during this turn. */
  text: string
  /** Normalised tool calls the model asked for. */
  toolCalls: ToolCallRequest[]
  /** The raw assistant message, echoed back so the thread stays coherent. */
  assistant: any
}

/**
 * One streamed Ollama turn.
 *
 * `relay` decides whether content reaches the browser as it arrives. It is
 * false for every turn that carries tool definitions, and that is a deliberate
 * trade of smoothness for correctness: Ollama only lifts a call out of the
 * output when the call IS the whole output, so a model that prefixes it with a
 * sentence ("Voici la réponse :") has its raw `{"name": ..., "parameters": ...}`
 * handed back as content. Observed on llama3.1:8b during recette, printed
 * verbatim in the chat window. Relaying eagerly makes that unrecoverable, since
 * text already sent cannot be taken back, so a turn that may still turn out to
 * be a tool call is buffered and only emitted once it is known to be prose.
 *
 * The closing turn withholds the tools, so it streams token by token as before.
 *
 * The reader keeps a line buffer: Ollama's NDJSON is not aligned with the
 * network chunks, and the previous implementation split each chunk on newlines
 * in isolation, silently dropping any JSON object that straddled two reads.
 */
async function streamOllamaTurn(opts: {
  base: string
  model: string
  messages: any[]
  tools: unknown[] | null
  relay: boolean
  toolNames: string[]
  controller: ReadableStreamDefaultController
  encoder: TextEncoder
}): Promise<OllamaTurn> {
  const { base, model, messages, tools, relay, toolNames, controller, encoder } = opts

  const response = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      ...(tools ? { tools } : {}),
      options: ollamaOptions(),
    })
  })

  if (!response.ok) {
    const text = await response.text()

    throw new Error(`Ollama error: ${text}`)
  }

  const reader = response.body?.getReader()

  if (!reader) return { text: '', toolCalls: [], assistant: { role: 'assistant', content: '' } }

  const decoder = new TextDecoder()
  const rawToolCalls: any[] = []

  let buffer = ''
  let text = ''

  const consume = (line: string) => {
    if (!line.trim()) return

    try {
      const json = JSON.parse(line)

      if (json.message?.content) {
        text += json.message.content
        if (relay) controller.enqueue(encoder.encode(json.message.content))
      }

      if (Array.isArray(json.message?.tool_calls)) {
        rawToolCalls.push(...json.message.tool_calls)
      }
    } catch {
      // Ignorer les lignes non-JSON
    }
  }

  while (true) {
    const { done, value } = await reader.read()

    if (done) break

    buffer += decoder.decode(value, { stream: true })

    const lines = buffer.split('\n')

    // The tail may be an incomplete object: keep it for the next read.
    buffer = lines.pop() ?? ''

    for (const line of lines) consume(line)
  }

  consume(buffer)

  const toolCalls: ToolCallRequest[] = rawToolCalls
    .filter(c => c?.function?.name)
    .map(c => ({ name: String(c.function.name), args: coerceToolArgs(c.function.arguments) }))

  // No structured call: the turn may still be a call the model wrote as prose.
  if (toolCalls.length === 0) {
    const textCall = extractTextToolCall(text, toolNames)

    if (textCall) {
      console.warn(`[ai-tools] recovered a text-form call to ${textCall.name} from the streamed output`)

      return { text: '', toolCalls: [textCall], assistant: { role: 'assistant', content: text } }
    }
  }

  // Prose, and it was held back: emit it now that it is known to be an answer.
  if (!relay && toolCalls.length === 0 && text) {
    controller.enqueue(encoder.encode(text))
  }

  return {
    text,
    toolCalls,
    assistant: { role: 'assistant', content: text, ...(rawToolCalls.length ? { tool_calls: rawToolCalls } : {}) },
  }
}

/**
 * Run the streamed conversation, tool rounds included.
 *
 * Mirrors `runToolRounds` from the shared loop but streams each turn instead of
 * buffering it, which is why it does not simply call it: the non-streaming loop
 * would cost one extra full generation per question on the common no-tool path.
 *
 * Tool activity is announced in-band (see `streamFrames.ts`): a `tool` frame
 * before each round so the drawer can say what it is waiting on, and one
 * `trace` frame at the very end listing what was consulted. A plain answer
 * with no tool round emits no frame at all and stays byte-identical to before.
 */
async function streamAgenticConversation(opts: {
  base: string
  model: string
  messages: any[]
  wireTools: unknown[]
  /** The tools handed to the model: read-only, plus the proposal tools when actions are on. */
  tools: CatalogTool[]
  ctx: ToolContext
  /** The user's own words, see `userTextOf`. */
  userText: string
  controller: ReadableStreamDefaultController
  encoder: TextEncoder
}) {
  const { base, model, wireTools, tools, ctx, controller, encoder } = opts
  const messages = [...opts.messages]

  const toolNames = tools.map(t => t.name)
  const trace: ToolTraceEntry[] = []

  let emptyRetried = false

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const isLastRound = round === MAX_TOOL_ROUNDS
    const turn = await streamOllamaTurn({
      base,
      model,
      messages,
      // Withhold the tools on the final round so the model concludes from what
      // it already gathered rather than asking for more it cannot get.
      tools: isLastRound ? null : wireTools,
      // No turn is relayed live: a tool-bearing turn might still be a call the
      // model wrote as text, and so might the closing turn (llama3.1:8b, out of
      // rounds, printed `{"name": "list_ceph_osds", ...}` to the user). The
      // closing turn is rare (four rounds spent) and short, so buffering it is
      // the right price for never showing a raw call.
      relay: false,
      toolNames,
      controller,
      encoder,
    })

    if (isLastRound && turn.toolCalls.length) {
      controller.enqueue(encoder.encode(budgetFallbackText(ctx.locale, trace)))
      break
    }

    if (!turn.toolCalls.length) {
      if (turn.text.trim()) break

      // An empty turn is not an answer (see `emptyAnswerText`): replay the
      // same round once, then say so rather than leave the bubble blank.
      if (!emptyRetried) {
        console.warn('[ai-tools] the model returned an empty turn, retrying it once')
        emptyRetried = true
        round--
        continue
      }

      controller.enqueue(encoder.encode(emptyAnswerText(ctx.locale)))
      break
    }

    messages.push(turn.assistant)

    // Announce the round before it runs: this is what the drawer shows while
    // the user waits, in place of the generic spinner.
    controller.enqueue(encoder.encode(encodeFrame({ type: 'tool', names: turn.toolCalls.map(c => c.name) })))

    const { results, trace: roundTrace } = await executeToolCalls(turn.toolCalls, tools, ctx, { userText: opts.userText })

    trace.push(...roundTrace)
    messages.push(...toolResultTurns('ollama', results))
  }

  if (trace.length) {
    controller.enqueue(
      encoder.encode(encodeFrame({ type: 'trace', calls: trace.map(t => ({ name: t.name, ok: t.ok })) }))
    )
  }

  const charts = collectCharts(trace)

  if (charts.length) controller.enqueue(encoder.encode(encodeFrame({ type: 'charts', charts })))

  const { cards, plans } = collectActionCards(trace)

  if (cards.length || plans.length) controller.enqueue(encoder.encode(encodeFrame({ type: 'actions', cards, plans })))
}

// POST /api/v1/ai/chat/stream - Chat avec streaming
export async function POST(request: Request) {
  try {
    const denied = await checkPermission(PERMISSIONS.CONNECTION_VIEW)
    if (denied) return denied

    // The assistant is an Enterprise feature: the widget and the settings tab
    // hide it, and the API refuses it too, so a direct call cannot get round it.
    const unlicensed = await requireFeature(Features.AI_INSIGHTS)
    if (unlicensed) return unlicensed

    const { messages, locale, timeZone, conversationId } = await request.json()

    // Le drawer envoie `locale`; repli sur le cookie NEXT_LOCALE pour tout
    // appelant qui ne le fait pas.
    const uiLocale = locale ? normalizeLocale(locale) : await getRequestLocale()
    const lang = uiLocale === 'fr' ? 'fr' : 'en'
    const settings = await getAISettings()

    if (!settings.enabled) {
      return NextResponse.json({
        error: lang === 'fr'
          ? 'L\'assistant IA n\'est pas activé.'
          : 'The AI assistant is not enabled.'
      }, { status: 400 })
    }

    if (settings.provider !== 'ollama') {
      // Pour OpenAI et Anthropic, on pourrait aussi implémenter le streaming
      // mais pour l'instant on retourne une erreur
      return NextResponse.json({
        error: lang === 'fr'
          ? 'Le streaming n\'est supporté que pour Ollama.'
          : 'Streaming is only supported for Ollama.'
      }, { status: 400 })
    }

    const tenantId = await getCurrentTenantId()

    // Read-only unless every condition for proposing actions holds, see the helper.
    const assistant = await resolveAssistantTools({ tenantId, conversationId, messages })

    const { prompt: systemPrompt, snapshot } = await buildAiSystemPrompt(lang, uiLocale, {
      toolsEnabled: true,
      terse: true,
      ...(assistant.actionsEnabled ? { actionsEnabled: true } : {}),
    })
    const toolCtx = {
      ...buildToolContext(snapshot, tenantId, uiLocale, normalizeTimeZone(timeZone)),
      ...(assistant.actions ? { actions: assistant.actions } : {}),
    }
    const wireTools = toolsForProvider('ollama', assistant.tools)

    // The SSRF guard's own contract requires every AI route fetching an
    // operator-supplied base URL to go through it; this route used to skip it.
    const ollamaBase = await validateAIUrl(settings.ollamaUrl)

    const ollamaMessages = ollamaThread(systemPrompt, messages, languageInstruction(uiLocale))

    const encoder = new TextEncoder()

    const stream = new ReadableStream({
      async start(controller) {
        try {
          await streamAgenticConversation({
            base: ollamaBase,
            model: settings.ollamaModel,
            messages: ollamaMessages,
            wireTools,
            tools: assistant.tools,
            ctx: toolCtx,
            userText: userTextOf(messages),
            controller,
            encoder,
          })
        } catch (e) {
          console.error('Stream error:', e)
        } finally {
          controller.close()
        }
      }
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Transfer-Encoding': 'chunked'
      }
    })

  } catch (e: any) {
    console.error('AI chat stream failed:', e)

return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
