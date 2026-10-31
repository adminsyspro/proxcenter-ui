export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'

import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { validateAIUrl } from "@/lib/ai/url-guard"
import { resolveMaskedAiSecrets } from "@/lib/ai/storedSecrets"
import { getRequestLocale, languageInstruction } from "@/lib/ai/locale"
import { fetchOllamaCapabilities, OllamaProbeTimeoutError, probeOllamaModel } from "@/lib/ai/ollama"
import { preflightVerdict } from "@/lib/ai/qualifiedModels"
import { requireFeature } from "@/lib/auth/requireEnterprise"
import { Features } from "@/lib/license/features"

/** Sanitize a string for safe logging (strip newlines/control chars) */
function sanitizeLog(str) {
  return String(str || '').replace(/[\r\n]/g, '')
}

// POST /api/v1/ai/test - Tester la connexion au LLM
export async function POST(request) {
  try {
    const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)
    if (denied) return denied

    // The assistant is an Enterprise feature: the widget and the settings tab
    // hide it, and the API refuses it too, so a direct call cannot get round it.
    const unlicensed = await requireFeature(Features.AI_INSIGHTS)
    if (unlicensed) return unlicensed

    // The form sends the mask back for a saved key: swap in the stored one.
    const settings = await resolveMaskedAiSecrets(await request.json())

    // #686: this probe used to be hardcoded in French for Ollama and
    // Anthropic and in English for OpenAI, so the reply language depended
    // on the provider instead of the UI language. One English probe for
    // every provider + an explicit instruction to answer in the caller's
    // language, derived from the NEXT_LOCALE cookie (the client posts only
    // the settings object, so the cookie is the sole locale signal here).
    const locale = await getRequestLocale()
    const probePrompt = `Reply in one sentence: are you functional?\n${languageInstruction(locale)}`

    if (settings.provider === 'ollama') {
      // Test Ollama
      const ollamaBase = await validateAIUrl(settings.ollamaUrl)

      // #459: the assistant needs tool calling. A model without it still
      // answers this probe, so the operator would read "Connected" and never
      // learn why the assistant only sees the live snapshot. null = unknown
      // (older Ollama without a capability list, or the probe failed).
      const { capabilities, toolCalling } = await fetchOllamaCapabilities(ollamaBase, settings.ollamaModel)

      // #459: load the model as the chat will and report whether it fits this
      // server, how fast it answers, and which qualified models would fit.
      const { response, measure } = await probeOllamaModel(ollamaBase, settings.ollamaModel, probePrompt, {
        thinking: capabilities?.includes('thinking') ?? false,
      })


return NextResponse.json({
        success: true,
        response,
        provider: 'ollama',
        model: settings.ollamaModel,
        toolCalling,
        preflight: preflightVerdict(measure),
      })
      
    } else if (settings.provider === 'openai') {
      // Test OpenAI
      const openaiRaw = settings.openaiBaseUrl || 'https://api.openai.com/v1'
      const openaiBase = await validateAIUrl(openaiRaw)
      const response = await fetch(`${openaiBase}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${settings.openaiKey}`
        },
        body: JSON.stringify({
          model: settings.openaiModel,
          messages: [{ role: 'user', content: probePrompt }],
          // One sentence, but the probe now answers in the caller's
          // language and Korean or Chinese spend noticeably more tokens on
          // the same sentence. 50 truncated them mid-word, which reads in
          // the settings panel like a broken provider.
          max_tokens: 150
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
          messages: [{ role: 'user', content: probePrompt }],
          // One sentence, but the probe now answers in the caller's
          // language and Korean or Chinese spend noticeably more tokens on
          // the same sentence. 50 truncated them mid-word, which reads in
          // the settings panel like a broken provider.
          max_tokens: 150
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
      throw new Error(`Unknown provider: ${settings.provider}`)
    }
    
  } catch (e) {
    console.error('AI test failed:', sanitizeLog(e?.message || e))

    // Not a failure of the server: a cold model may still be loading.
    if (e instanceof OllamaProbeTimeoutError) {
      return NextResponse.json({ error: e.message, code: 'probe-timeout' }, { status: 504 })
    }

return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
