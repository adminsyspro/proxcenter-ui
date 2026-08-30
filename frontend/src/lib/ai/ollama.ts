/**
 * Request options shared by everything that talks to Ollama's /api/chat.
 *
 * `num_ctx` is the one that matters. Ollama defaults the context window to
 * 4096 tokens whatever the model was trained for, and silently truncates a
 * longer request by dropping tokens right after the first five. The tool-aware
 * prompt plus the eight tool definitions already weigh 3800 to 4400 tokens
 * depending on the tokenizer, so without this field the part thrown away was
 * the opening of the system prompt: the paragraph telling the model it has
 * tools and is expected to call them. Measured on Ollama 0.14.1 (#459):
 * mistral:7b lost 260 tokens on every question and never called a tool,
 * qwen2.5:7b sat 33 tokens under the limit and answered slower and worse.
 *
 * 16384 leaves room for a question, four tool rounds carrying results capped at
 * MAX_TOOL_RESULT_CHARS each, and some conversation history. It costs about
 * 2 GB of KV cache on an 8B model, which fits a 12 GB GPU next to the weights;
 * a smaller GPU spills to system RAM and slows down rather than failing.
 */
export const OLLAMA_NUM_CTX = 16384

export function ollamaOptions() {
  return {
    num_predict: 4096,
    temperature: 0.3,
    num_ctx: OLLAMA_NUM_CTX,
  }
}

export type OllamaModelCapabilities = {
  /** Raw list from /api/show, null when the server does not report one (Ollama before 0.6). */
  capabilities: string[] | null
  /** true / false when known, null when the server gave no capability list or the probe failed. */
  toolCalling: boolean | null
}

const UNKNOWN_CAPABILITIES: OllamaModelCapabilities = { capabilities: null, toolCalling: null }

/**
 * Ask Ollama whether a model can call tools.
 *
 * `/api/show` lists `capabilities` such as "completion", "tools", "vision",
 * "thinking". A model without "tools" answers a tools payload with HTTP 400
 * "does not support tools" and the chat loop then degrades to a snapshot-only
 * answer, which looks to the operator like a vague model rather than a
 * misconfiguration. Unknown is reported as null, never as false: an older
 * server that omits the list must not flag every model.
 */
export async function fetchOllamaCapabilities(
  base: string,
  model: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 10_000
): Promise<OllamaModelCapabilities> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetchImpl(`${base.replace(/\/+$/, '')}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model }),
      signal: controller.signal,
    })

    if (!res.ok) return UNKNOWN_CAPABILITIES

    const json = await res.json()
    const capabilities = json?.capabilities

    if (!Array.isArray(capabilities)) return UNKNOWN_CAPABILITIES

    return { capabilities, toolCalling: capabilities.includes('tools') }
  } catch {
    return UNKNOWN_CAPABILITIES
  } finally {
    clearTimeout(timer)
  }
}
