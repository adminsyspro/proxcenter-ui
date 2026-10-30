export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'

import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { validateAIUrl } from "@/lib/ai/url-guard"
import { resolveMaskedAiSecrets } from "@/lib/ai/storedSecrets"
import { fetchOllamaCapabilities } from "@/lib/ai/ollama"
import { requireFeature } from "@/lib/auth/requireEnterprise"
import { Features } from "@/lib/license/features"

const TIMEOUT_MS = 10_000

const OPENAI_EXCLUDED = /embed|tts|whisper|dall-e|moderation|audio|realtime/i

async function fetchWithTimeout(url: string, init?: RequestInit) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

type OllamaModelList = {
  models: string[]
  /** Per model: true / false when /api/show reports capabilities, null when unknown (#459). */
  toolCalling: Record<string, boolean | null>
}

async function fetchOllamaModels(ollamaUrl: string): Promise<OllamaModelList> {
  const url = await validateAIUrl(ollamaUrl)
  const res = await fetchWithTimeout(`${url}/api/tags`)

  if (!res.ok) throw new Error(`Ollama error: ${res.status}`)

  const json = await res.json()
  const models: string[] = (json?.models || []).map((m: any) => m.name)

  // The assistant is agentic: a model without the "tools" capability silently
  // degrades to a snapshot-only answer, so the operator must see it in the
  // list. Each probe has its own timeout and never rejects, so a slow or
  // failing /api/show cannot fail the models call.
  const probes = await Promise.all(models.map(name => fetchOllamaCapabilities(url, name, fetch)))
  const toolCalling: Record<string, boolean | null> = {}

  models.forEach((name, i) => {
    toolCalling[name] = probes[i].toolCalling
  })

  return { models, toolCalling }
}

async function fetchOpenAIModels(key: string, baseUrl?: string): Promise<string[]> {
  const raw = baseUrl || 'https://api.openai.com/v1'
  const validated = await validateAIUrl(raw)
  const url = validated.endsWith('/') ? validated.replace(/(?<!\/)\/+$/, '') : validated
  const res = await fetchWithTimeout(`${url}/models`, {
    headers: { Authorization: `Bearer ${key}` },
  })

  if (!res.ok) throw new Error(`OpenAI error: ${res.status}`)

  const json = await res.json()

  return (json?.data || [])
    .map((m: any) => m.id)
    .filter((id: string) => !OPENAI_EXCLUDED.test(id))
    .sort()
}

async function fetchAnthropicModels(key: string): Promise<string[]> {
  const res = await fetchWithTimeout('https://api.anthropic.com/v1/models?limit=100', {
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
  })

  if (!res.ok) throw new Error(`Anthropic error: ${res.status}`)

  const json = await res.json()

  return (json?.data || []).map((m: any) => m.id).sort()
}

// POST /api/v1/ai/models - Fetch available models for a provider
export async function POST(request: Request) {
  try {
    const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)
    if (denied) return denied

    // The assistant is an Enterprise feature: the widget and the settings tab
    // hide it, and the API refuses it too, so a direct call cannot get round it.
    const unlicensed = await requireFeature(Features.AI_INSIGHTS)
    if (unlicensed) return unlicensed

    // The form sends the mask back for a saved key: swap in the stored one.
    const body = await resolveMaskedAiSecrets(await request.json())
    const { provider, ollamaUrl, openaiKey, openaiBaseUrl, anthropicKey } = body

    if (provider === 'ollama') {
      const { models, toolCalling } = await fetchOllamaModels(ollamaUrl)

      return NextResponse.json({ models, toolCalling })
    }

    let models: string[] = []

    if (provider === 'openai') {
      models = await fetchOpenAIModels(openaiKey, openaiBaseUrl)
    } else if (provider === 'anthropic') {
      models = await fetchAnthropicModels(anthropicKey)
    } else {
      throw new Error(`Unknown provider: ${provider}`)
    }

    return NextResponse.json({ models })
  } catch (e: any) {
    console.error('AI models fetch failed:', String(e?.message || e).replace(/[\r\n]/g, ''))

    return NextResponse.json({ models: [], error: e?.message || String(e) }, { status: 500 })
  }
}
