/**
 * Which tools the chat routes hand the model (roadmap#188).
 *
 * One helper for both routes, so the gating cannot drift between the streamed
 * and the non-streamed path. The proposal tools are added only when ALL of
 * these hold, and otherwise the assistant stays exactly the read-only one it
 * was: same tools, no `ctx.actions`, same prompt.
 *
 *  1. the `ai_actions` feature is licensed;
 *  2. the tenant enabled at least one kind (`actionToolsFor` is non-empty);
 *  3. the caller is an interactive session, never an API token: a card is
 *     approved by a person clicking it, and a token has nobody to click;
 *  4. the request carries a `conversationId` the widget generated, since the
 *     card signature is bound to it;
 *  5. the session user is known, the signature is bound to them too.
 */

import { getPrincipal } from '@/lib/auth/principal'
import { hasServerFeature } from '@/lib/auth/requireEnterprise'
import { Features } from '@/lib/license/features'
import { READ_ONLY_TOOLS } from '@/lib/tools/catalog'
import { actionToolsFor } from '@/lib/tools/actions'
import type { CatalogTool, ToolContext } from '@/lib/tools/types'

import { conversationGrounding } from './grounding'
import { getAiActionsSettings } from './settings'

const CONVERSATION_ID_RE = /^[A-Za-z0-9_-]{1,100}$/

export type ResolvedAssistantTools = {
  tools: CatalogTool[]
  actions?: ToolContext['actions']
  actionsEnabled: boolean
}

export async function resolveAssistantTools(opts: {
  tenantId: string
  /** The `conversationId` of the request body, whatever it is. */
  conversationId: unknown
  /** The RAW `messages` of the request body, see `conversationGrounding`. */
  messages: Array<{ role?: string; content?: unknown }>
}): Promise<ResolvedAssistantTools> {
  const readOnly: ResolvedAssistantTools = { tools: READ_ONLY_TOOLS, actionsEnabled: false }
  const { conversationId } = opts

  if (typeof conversationId !== 'string' || !CONVERSATION_ID_RE.test(conversationId)) return readOnly

  try {
    if (!(await hasServerFeature(Features.AI_ACTIONS))) return readOnly

    const settings = await getAiActionsSettings(opts.tenantId)
    const actionTools = actionToolsFor(settings)

    if (actionTools.length === 0) return readOnly

    const { principal } = await getPrincipal()

    if (principal?.kind !== 'session' || !principal.userId) return readOnly

    return {
      tools: [...READ_ONLY_TOOLS, ...actionTools],
      actions: {
        settings,
        bind: { userId: principal.userId, tenantId: opts.tenantId, conversationId },
        ...conversationGrounding(opts.messages),
      },
      actionsEnabled: true,
    }
  } catch (e) {
    // Fail closed: a settings or licence hiccup must never cost the user the
    // assistant itself, only the optional actions.
    console.error('[ai-actions] could not resolve the action tools, staying read-only:', e)

    return readOnly
  }
}
