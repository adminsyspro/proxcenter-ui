import { getSetting } from '@/lib/db/settings'
import { hasServerFeature } from '@/lib/auth/requireEnterprise'
import { Features } from '@/lib/license/features'

import { openAiSecrets } from './settingsSecrets'
import { validateAIUrl } from './url-guard'
import { ollamaOptions } from './ollama'
import type { AiProvider } from './tools/adapters'

/** Where a one-shot completion goes: the provider configured for the tenant. */
export type AiTarget = {
  provider: AiProvider
  model: string
  baseUrl: string
  apiKey?: string
}

/** Identifies a provider and model, so a reading made with another one is not reused. */
export const aiTargetId = (target: AiTarget | null) => (target ? `${target.provider}:${target.model}` : 'basic')

const LEGACY_OLLAMA_URL = 'http://localhost:11434'
const LEGACY_OLLAMA_MODEL = 'llama3.1:8b'

function stripTrailingSlashes(value: string): string {
  let end = value.length
  while (end > 0 && value[end - 1] === '/') end--

  return value.slice(0, end)
}

async function ollamaReachable(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(2000) })

    return response.ok
  } catch {
    return false
  }
}

/**
 * The model a page analysis should use, or null for the rule-based fallback.
 *
 * - AI configured and enabled in the settings, AI feature licensed: that provider.
 * - AI configured but switched off: none, the operator said no.
 * - Nothing configured: the Ollama named by OLLAMA_URL / OLLAMA_MODEL when it
 *   answers, which is what the resources analysis always did before it read the
 *   settings.
 */
export async function resolveAiTarget(tenantId: string): Promise<AiTarget | null> {
  const stored = await getSetting<Record<string, any>>('ai', tenantId).catch(() => null)

  if (stored) {
    if (!stored.enabled) return null
    if (!(await hasServerFeature(Features.AI_INSIGHTS))) return null

    const settings = openAiSecrets(stored)

    if (settings.provider === 'openai') {
      const baseUrl = settings.openaiBaseUrl ? await validateAIUrl(settings.openaiBaseUrl) : 'https://api.openai.com/v1'

      return settings.openaiKey && settings.openaiModel
        ? { provider: 'openai', model: settings.openaiModel, baseUrl: stripTrailingSlashes(baseUrl), apiKey: settings.openaiKey }
        : null
    }

    if (settings.provider === 'anthropic') {
      return settings.anthropicKey && settings.anthropicModel
        ? { provider: 'anthropic', model: settings.anthropicModel, baseUrl: 'https://api.anthropic.com/v1', apiKey: settings.anthropicKey }
        : null
    }

    if (!settings.ollamaUrl || !settings.ollamaModel) return null

    return { provider: 'ollama', model: settings.ollamaModel, baseUrl: stripTrailingSlashes(await validateAIUrl(settings.ollamaUrl)) }
  }

  const baseUrl = stripTrailingSlashes(process.env.OLLAMA_URL || LEGACY_OLLAMA_URL)

  if (!(await ollamaReachable(baseUrl))) return null

  return { provider: 'ollama', model: process.env.OLLAMA_MODEL || LEGACY_OLLAMA_MODEL, baseUrl }
}

export type CompletionRequest = {
  /** Empty: the whole instruction rides in the user message. */
  system: string
  user: string
  maxTokens: number
  /** Past this the call is abandoned: an API route must answer within nginx's 60 s. */
  timeoutMs: number
}

/** One system + user exchange, no tools, the reply's text. */
export async function completeText(target: AiTarget, request: CompletionRequest): Promise<string> {
  const signal = AbortSignal.timeout(request.timeoutMs)
  const messages = [
    ...(request.system ? [{ role: 'system', content: request.system }] : []),
    { role: 'user', content: request.user },
  ]

  if (target.provider === 'ollama') {
    const response = await fetch(`${target.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        model: target.model,
        messages,
        stream: false,
        format: 'json',
        // Thinking models would otherwise spend the budget before the answer.
        think: false,
        options: { ...ollamaOptions(), num_predict: request.maxTokens },
      }),
    })

    if (!response.ok) throw new Error(`Ollama error ${response.status}`)
    const json = await response.json()

    return json?.message?.content ?? ''
  }

  if (target.provider === 'openai') {
    const response = await fetch(`${target.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${target.apiKey}` },
      signal,
      body: JSON.stringify({
        model: target.model,
        messages,
        max_tokens: request.maxTokens,
      }),
    })

    if (!response.ok) throw new Error(`OpenAI error ${response.status}`)
    const json = await response.json()

    return json?.choices?.[0]?.message?.content ?? ''
  }

  const response = await fetch(`${target.baseUrl}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': target.apiKey ?? '', 'anthropic-version': '2023-06-01' },
    signal,
    body: JSON.stringify({
      model: target.model,
      ...(request.system && { system: request.system }),
      messages: [{ role: 'user', content: request.user }],
      max_tokens: request.maxTokens,
    }),
  })

  if (!response.ok) throw new Error(`Anthropic error ${response.status}`)
  const json = await response.json()

  return (json?.content ?? []).filter((b: any) => b?.type === 'text').map((b: any) => b.text).join('')
}

/** The first JSON object in a model reply, fences and chatter around it ignored. */
export function extractJsonObject(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/g, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')

  if (start === -1 || end <= start) return null

  try {
    return JSON.parse(cleaned.slice(start, end + 1))
  } catch {
    return null
  }
}
