import { NextResponse } from 'next/server'

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

async function fetchOllamaModels(ollamaUrl: string): Promise<string[]> {
  const url = ollamaUrl.replace(/\/+$/, '')
  const res = await fetchWithTimeout(`${url}/api/tags`)

  if (!res.ok) throw new Error(`Ollama error: ${res.status}`)

  const json = await res.json()

  return (json?.models || []).map((m: any) => m.name)
}

async function fetchOpenAIModels(key: string, baseUrl?: string): Promise<string[]> {
  const url = (baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '')
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
    console.error('AI models fetch failed:', e)

    return NextResponse.json({ models: [], error: e?.message || String(e) }, { status: 500 })
  }
}
