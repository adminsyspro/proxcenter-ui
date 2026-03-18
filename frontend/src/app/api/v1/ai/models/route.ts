import { NextResponse } from 'next/server'

const TIMEOUT_MS = 10_000

const OPENAI_EXCLUDED = /embed|tts|whisper|dall-e|moderation|audio|realtime/i

/** Validate that a user-provided URL is a valid HTTP(S) URL and not a private/internal address */
function validateAIUrl(input: string): string {
  const parsed = new URL(input)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http and https URLs are allowed')
  }
  return parsed.toString()
}

async function fetchWithTimeout(url: string, init?: RequestInit) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function fetchOllamaModels(ollamaUrl: string): Promise<string[]> {
  const validated = validateAIUrl(ollamaUrl)
  const url = validated.endsWith('/') ? validated.replace(/\/+$/, '') : validated
  const res = await fetchWithTimeout(`${url}/api/tags`)

  if (!res.ok) throw new Error(`Ollama error: ${res.status}`)

  const json = await res.json()

  return (json?.models || []).map((m: any) => m.name)
}

async function fetchOpenAIModels(key: string, baseUrl?: string): Promise<string[]> {
  const raw = baseUrl || 'https://api.openai.com/v1'
  const validated = validateAIUrl(raw)
  const url = validated.endsWith('/') ? validated.replace(/\/+$/, '') : validated
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
    const body = await request.json()
    const { provider, ollamaUrl, openaiKey, openaiBaseUrl, anthropicKey } = body

    let models: string[] = []

    if (provider === 'ollama') {
      models = await fetchOllamaModels(ollamaUrl)
    } else if (provider === 'openai') {
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
