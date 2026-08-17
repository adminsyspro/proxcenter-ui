export const dynamic = "force-dynamic"
import { NextResponse } from 'next/server'

import { getSetting } from '@/lib/db/settings'
import { openAiSecrets } from '@/lib/ai/settingsSecrets'
import { getCurrentTenantId } from "@/lib/tenant"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { getRequestLocale, languageInstruction, normalizeLocale } from '@/lib/ai/locale'
import { validateAIUrl } from '@/lib/ai/url-guard'
import { buildAiSystemPrompt } from '@/lib/ai/context'
import { AI_TOOLS, buildToolContext } from '@/lib/ai/tools/registry'
import { toolsForProvider, type AiProvider } from '@/lib/ai/tools/adapters'
import { runToolRounds, type SendTurn, type ToolMode } from '@/lib/ai/tools/loop'

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
    ollamaModel: 'llama3.1:8b'
  }
}

function stripTrailingSlashes(value: string): string {
  let end = value.length
  while (end > 0 && value[end - 1] === '/') end--
  return value.slice(0, end)
}

// POST /api/v1/ai/chat - Envoyer un message au LLM
export async function POST(request: Request) {
  try {
    const denied = await checkPermission(PERMISSIONS.CONNECTION_VIEW)
    if (denied) return denied

    const { messages, locale } = await request.json()

    // The drawer sends `locale`; fall back to the NEXT_LOCALE cookie for any
    // caller that does not (the streaming fallback used to be one of them).
    const uiLocale = locale ? normalizeLocale(locale) : await getRequestLocale()
    const lang = uiLocale === 'fr' ? 'fr' : 'en'
    const settings = await getAISettings()

    if (!settings.enabled) {
      return NextResponse.json({
        error: lang === 'fr'
          ? 'L\'assistant IA n\'est pas activé. Allez dans Paramètres → Intelligence Artificielle pour le configurer.'
          : 'The AI assistant is not enabled. Go to Settings → Artificial Intelligence to configure it.'
      }, { status: 400 })
    }

    const provider = settings.provider as AiProvider

    if (provider !== 'ollama' && provider !== 'openai' && provider !== 'anthropic') {
      throw new Error(`Unknown provider: ${settings.provider}`)
    }

    const tenantId = await getCurrentTenantId()

    // The snapshot is RBAC-scoped and is reused as the tool context, so the
    // tools can only ever reach what the prompt was already allowed to show.
    const { prompt: systemPrompt, snapshot } = await buildAiSystemPrompt(lang, uiLocale, {
      toolsEnabled: true,
    })
    const toolCtx = buildToolContext(snapshot, tenantId, uiLocale)
    const wireTools = toolsForProvider(provider, AI_TOOLS)

    const lastUserMessage = messages[messages.length - 1]
    const userInstruction = lang === 'fr'
      ? 'Réponds en utilisant les données de l\'infrastructure ci-dessus, ou appelle un outil si la réponse n\'y figure pas. Cite les noms exacts des VMs et leurs métriques.'
      : 'Respond using the infrastructure data above, or call a tool if the answer is not in it. Cite exact VM names and their metrics.'

    // Ollama gets the system prompt inlined in the user message, so the
    // language instruction is repeated last where models weigh it most.
    const contextualizedMessage = `${systemPrompt}

=== ${lang === 'fr' ? 'QUESTION DE L\'UTILISATEUR' : 'USER QUESTION'} ===
${lastUserMessage.content}

${userInstruction}

${languageInstruction(uiLocale)}`

    let send: SendTurn
    let initialMessages: any[]
    let model: string

    /**
     * The tool fields for one turn, per mode.
     *
     * `none` keeps the declaration and forbids new calls, because a thread that
     * already holds tool blocks is rejected by Anthropic (and by several
     * OpenAI-compatible gateways) when the `tools` field disappears. Only `off`
     * omits it, and the loop restricts that to a thread with no tool turn yet.
     */
    const toolFields = (mode: ToolMode) => {
      if (mode === 'off') return {}
      if (mode === 'auto') return { tools: wireTools }

      if (provider === 'anthropic') return { tools: wireTools, tool_choice: { type: 'none' } }
      if (provider === 'openai') return { tools: wireTools, tool_choice: 'none' }

      // Ollama has no tool_choice, and does not validate tool blocks against a
      // declaration, so withholding the field is enough to close the loop.
      return {}
    }

    if (provider === 'ollama') {
      // The SSRF guard's own contract requires every AI route that fetches an
      // operator-supplied base URL to go through it. The chat routes used to
      // skip it while `ai/test` and `ai/models` honoured it.
      const ollamaBase = await validateAIUrl(settings.ollamaUrl)

      model = settings.ollamaModel
      initialMessages = [
        ...messages.slice(0, -1),
        { role: 'user', content: contextualizedMessage },
      ]

      send = async (msgs, mode) => {
        const response = await fetch(`${ollamaBase}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: settings.ollamaModel,
            messages: msgs,
            stream: false,
            ...toolFields(mode),
            options: {
              num_predict: 4096, // Permet des réponses plus longues
              temperature: 0.3  // Plus déterministe pour les listes
            }
          })
        })

        if (!response.ok) {
          const text = await response.text()

          throw new Error(`Ollama error: ${text}`)
        }

        return response.json()
      }
    } else if (provider === 'openai') {
      const openaiBase = stripTrailingSlashes(settings.openaiBaseUrl
        ? await validateAIUrl(settings.openaiBaseUrl)
        : 'https://api.openai.com/v1')

      model = settings.openaiModel
      initialMessages = [
        { role: 'system', content: systemPrompt },
        ...messages,
      ]

      send = async (msgs, mode) => {
        const response = await fetch(`${openaiBase}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${settings.openaiKey}`
          },
          body: JSON.stringify({
            model: settings.openaiModel,
            messages: msgs,
            max_tokens: 1000,
            ...toolFields(mode),
          })
        })

        if (!response.ok) {
          const json = await response.json().catch(() => ({}))

          throw new Error(json?.error?.message || `OpenAI error: ${response.status}`)
        }

        return response.json()
      }
    } else {
      model = settings.anthropicModel
      // Only the incoming history is flattened to text. The loop appends its
      // own turns verbatim, because a tool_use block must be echoed back
      // unchanged for the matching tool_result to be accepted.
      initialMessages = messages.map((m: any) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content
      }))

      send = async (msgs, mode) => {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': settings.anthropicKey,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({
            model: settings.anthropicModel,
            system: systemPrompt,
            messages: msgs,
            max_tokens: 1000,
            ...toolFields(mode),
          })
        })

        if (!response.ok) {
          const json = await response.json().catch(() => ({}))

          throw new Error(json?.error?.message || `Anthropic error: ${response.status}`)
        }

        return response.json()
      }
    }

    const outcome = await runToolRounds({
      provider,
      tools: AI_TOOLS,
      ctx: toolCtx,
      messages: initialMessages,
      send,
    })

    return NextResponse.json({
      response: outcome.text,
      provider,
      model,
      // What the assistant consulted, so the drawer can show it and an
      // operator can tell a tool failure from a model that stayed vague.
      toolCalls: outcome.trace.map(t => ({
        name: t.name,
        ok: t.ok,
        error: t.error,
        durationMs: t.durationMs,
        truncated: t.truncated,
      })),
      toolsDisabled: outcome.toolsDisabled,
      budgetExhausted: outcome.budgetExhausted,
    })

  } catch (e: any) {
    console.error('AI chat failed:', e)

return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
