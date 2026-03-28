export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'

import { checkPermission, PERMISSIONS } from "@/lib/rbac"

/** Validate and reconstruct a user-provided URL (SSRF protection) */
function validateAIUrl(input) {
  const parsed = new URL(input)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http and https URLs are allowed')
  }
  // Return origin + pathname to cut taint flow from user input
  return `${parsed.origin}${parsed.pathname}`
}

/** Sanitize a string for safe logging (strip newlines/control chars) */
function sanitizeLog(str) {
  return String(str || '').replace(/[\r\n]/g, '')
}

// POST /api/v1/ai/test - Tester la connexion au LLM
export async function POST(request) {
  try {
    const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)
    if (denied) return denied

    const settings = await request.json()
    
    if (settings.provider === 'ollama') {
      // Test Ollama
      const ollamaBase = validateAIUrl(settings.ollamaUrl)
      const response = await fetch(`${ollamaBase}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: settings.ollamaModel,
          prompt: 'Réponds en une phrase: Es-tu fonctionnel ?',
          stream: false
        })
      })
      
      if (!response.ok) {
        const text = await response.text()

        throw new Error(`Ollama error: ${text}`)
      }
      
      const json = await response.json()

      
return NextResponse.json({ 
        success: true, 
        response: json.response,
        provider: 'ollama',
        model: settings.ollamaModel
      })
      
    } else if (settings.provider === 'openai') {
      // Test OpenAI
      const openaiRaw = settings.openaiBaseUrl || 'https://api.openai.com/v1'
      const openaiBase = validateAIUrl(openaiRaw)
      const response = await fetch(`${openaiBase}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${settings.openaiKey}`
        },
        body: JSON.stringify({
          model: settings.openaiModel,
          messages: [{ role: 'user', content: 'Reply in one sentence: Are you functional?' }],
          max_tokens: 50
        })
      })
      
      if (!response.ok) {
        const json = await response.json().catch(() => ({}))

        throw new Error(json?.error?.message || `OpenAI error: ${response.status}`)
      }
      
      const json = await response.json()

      
return NextResponse.json({ 
        success: true, 
        response: json.choices?.[0]?.message?.content,
        provider: 'openai',
        model: settings.openaiModel
      })
      
    } else if (settings.provider === 'anthropic') {
      // Test Anthropic
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-api-key': settings.anthropicKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: settings.anthropicModel,
          messages: [{ role: 'user', content: 'Réponds en une phrase: Es-tu fonctionnel ?' }],
          max_tokens: 50
        })
      })
      
      if (!response.ok) {
        const json = await response.json().catch(() => ({}))

        throw new Error(json?.error?.message || `Anthropic error: ${response.status}`)
      }
      
      const json = await response.json()

      
return NextResponse.json({ 
        success: true, 
        response: json.content?.[0]?.text,
        provider: 'anthropic',
        model: settings.anthropicModel
      })
      
    } else {
      throw new Error(`Provider inconnu: ${settings.provider}`)
    }
    
  } catch (e) {
    console.error('AI test failed:', sanitizeLog(e?.message || e))
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
