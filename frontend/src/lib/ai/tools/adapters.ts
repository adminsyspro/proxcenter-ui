/**
 * Provider adapters: one tool definition, three wire formats.
 *
 * Ollama and OpenAI share the `{ type: 'function', function: {...} }` envelope
 * with a JSON Schema `parameters`; Anthropic uses a flat `{ name, description,
 * input_schema }`. The difference that actually bites is in the *responses*:
 * OpenAI serialises tool arguments as a JSON **string**, Ollama hands back a
 * parsed **object**, and Anthropic puts them in `input` on a `tool_use`
 * content block. `parseToolCalls` normalises all three.
 */

import type { CatalogTool } from '@/lib/tools/types'

export type AiProvider = 'ollama' | 'openai' | 'anthropic'

/** A tool invocation the model asked for, normalised across providers. */
export type ToolCallRequest = {
  /** Present for OpenAI and Anthropic, which thread results by id. */
  id?: string
  name: string
  args: Record<string, unknown>
}

export function toOpenAiStyleTools(tools: CatalogTool[]) {
  return tools.map(t => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }))
}

export function toAnthropicTools(tools: CatalogTool[]) {
  return tools.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }))
}

export function toolsForProvider(provider: AiProvider, tools: CatalogTool[]) {
  return provider === 'anthropic' ? toAnthropicTools(tools) : toOpenAiStyleTools(tools)
}

/**
 * Coerce whatever the model put in the arguments slot into an object.
 *
 * A small local model sometimes emits `"{}"`, sometimes `{}`, and occasionally
 * a bare string for a single-argument tool. None of those should crash a turn.
 */
export function coerceToolArgs(raw: unknown): Record<string, unknown> {
  if (raw === undefined || raw === null) return {}

  if (typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>

  if (typeof raw === 'string') {
    const trimmed = raw.trim()

    if (!trimmed) return {}

    try {
      const parsed = JSON.parse(trimmed)

      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch {
      // Not JSON. Fall through and drop it rather than guessing a key name.
    }
  }

  return {}
}

/**
 * Find a tool call a model emitted as plain text instead of as a tool call.
 *
 * Ollama only lifts a call out of the output when the call IS the whole output.
 * llama3.1 writes its calls as `{"name": ..., "parameters": {...}}`, and as soon
 * as it prefixes that with a sentence ("Voici la réponse :"), the parse fails
 * and the raw JSON is handed back as content, which lands verbatim in the chat
 * window. Observed on llama3.1:8b during recette.
 *
 * `parameters` is the key of the *schema* we send, which is what makes the leak
 * recognisable; `arguments` and `input` are accepted too since other templates
 * use those.
 *
 * Only a call naming a tool we actually expose is accepted, so a model quoting
 * JSON for unrelated reasons is left alone.
 */
export function extractTextToolCall(content: string, knownNames: string[]): ToolCallRequest | null {
  if (!content || !content.includes('{')) return null

  for (let start = content.indexOf('{'); start !== -1; start = content.indexOf('{', start + 1)) {
    const end = matchingBrace(content, start)

    if (end === -1) continue

    let parsed: any

    try {
      parsed = JSON.parse(content.slice(start, end + 1))
    } catch {
      continue
    }

    const name = typeof parsed?.name === 'string' ? parsed.name : undefined

    if (!name || !knownNames.includes(name)) continue

    const rawArgs = parsed.parameters ?? parsed.arguments ?? parsed.input

    return { name, args: coerceToolArgs(rawArgs) }
  }

  return null
}

/** Index of the brace closing the one at `start`, string literals respected. */
function matchingBrace(text: string, start: number): number {
  let depth = 0
  let inString = false
  let escaped = false

  for (let i = start; i < text.length; i++) {
    const ch = text[i]

    if (escaped) {
      escaped = false
      continue
    }

    if (ch === '\\') {
      escaped = true
      continue
    }

    if (ch === '"') {
      inString = !inString
      continue
    }

    if (inString) continue

    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return i
    }
  }

  return -1
}

/** Tool calls carried by one non-streaming provider response. */
export function parseToolCalls(provider: AiProvider, json: any): ToolCallRequest[] {
  if (provider === 'anthropic') {
    const blocks = Array.isArray(json?.content) ? json.content : []

    return blocks
      .filter((b: any) => b?.type === 'tool_use' && b?.name)
      .map((b: any) => ({ id: b.id, name: String(b.name), args: coerceToolArgs(b.input) }))
  }

  const message = provider === 'openai' ? json?.choices?.[0]?.message : json?.message
  const calls = Array.isArray(message?.tool_calls) ? message.tool_calls : []

  return calls
    .filter((c: any) => c?.function?.name)
    .map((c: any) => ({
      id: c.id,
      name: String(c.function.name),
      args: coerceToolArgs(c.function.arguments),
    }))
}

/** The assistant's plain text in one non-streaming provider response. */
export function parseAssistantText(provider: AiProvider, json: any): string {
  if (provider === 'anthropic') {
    const blocks = Array.isArray(json?.content) ? json.content : []

    return blocks
      .filter((b: any) => b?.type === 'text' && typeof b.text === 'string')
      .map((b: any) => b.text)
      .join('')
  }

  if (provider === 'openai') return json?.choices?.[0]?.message?.content || ''

  return json?.message?.content || json?.response || ''
}

/**
 * The assistant turn to append before the tool results.
 *
 * OpenAI and Anthropic validate that a tool result answers an assistant turn
 * they actually produced, so the original message is echoed back verbatim
 * rather than rebuilt.
 */
export function assistantTurnFor(provider: AiProvider, json: any): any {
  if (provider === 'anthropic') {
    return { role: 'assistant', content: json?.content ?? [] }
  }

  if (provider === 'openai') {
    return json?.choices?.[0]?.message ?? { role: 'assistant', content: '' }
  }

  return json?.message ?? { role: 'assistant', content: '' }
}

/**
 * The message(s) carrying tool results back to the model.
 *
 * Anthropic wants a single user turn holding every `tool_result` block; the
 * other two want one `tool` message per call.
 */
export function toolResultTurns(
  provider: AiProvider,
  results: Array<{ call: ToolCallRequest; content: string }>
): any[] {
  if (provider === 'anthropic') {
    return [{
      role: 'user',
      content: results.map(r => ({
        type: 'tool_result',
        tool_use_id: r.call.id,
        content: r.content,
      })),
    }]
  }

  if (provider === 'openai') {
    return results.map(r => ({
      role: 'tool',
      tool_call_id: r.call.id,
      content: r.content,
    }))
  }

  // Ollama accepts a bare tool message; `tool_name` helps the models that
  // support it disambiguate parallel calls and is ignored by the ones that do not.
  return results.map(r => ({
    role: 'tool',
    tool_name: r.call.name,
    content: r.content,
  }))
}

/**
 * Whether an upstream error means "this model cannot do tools".
 *
 * Ollama answers a tools payload with an explicit complaint for models that
 * were not trained for it, and plenty of OpenAI-compatible gateways answer
 * with a generic 400 mentioning the field. Both must degrade to a plain
 * prompt-only turn rather than surfacing an error to the user.
 */
export function isToolsUnsupportedError(message: string): boolean {
  const m = message.toLowerCase()

  return (
    m.includes('does not support tools') ||
    m.includes('not support tools') ||
    m.includes('does not support function') ||
    m.includes('tools is not supported') ||
    m.includes('tool use is not supported') ||
    m.includes('unsupported parameter') && m.includes('tool') ||
    m.includes('unknown field') && m.includes('tool')
  )
}
