// Shared by the server (tools, execute route, settings) and the client (chat
// widget cards, Settings tab): keep this file pure, with no Next, Prisma or
// React import, so a client component can import it without dragging server
// code into the bundle.

// ---------------------------------------------------------------------------
// Closed whitelist of actions the assistant may PROPOSE (roadmap#188). Nothing
// outside this list exists in the code; the model never executes, only the
// user's click on a signed card does.
// ---------------------------------------------------------------------------

export const ACTION_KINDS = [
  'snapshot',
  'start',
  'migrate',
  'drs_apply',
  'backup_add',
  'shutdown',
  'reboot',
  'maintenance',
] as const

export type ActionKind = (typeof ACTION_KINDS)[number]

export type ActionTier = 'safe' | 'disruptive'

// Disruptive kinds ask for a double confirmation in the widget.
export const ACTION_TIER: Record<ActionKind, ActionTier> = {
  snapshot: 'safe',
  start: 'safe',
  migrate: 'safe',
  drs_apply: 'safe',
  backup_add: 'safe',
  shutdown: 'disruptive',
  reboot: 'disruptive',
  maintenance: 'disruptive',
}

// ---------------------------------------------------------------------------
// Per-tenant settings (key `ai_actions`)
// ---------------------------------------------------------------------------

export const AI_ACTIONS_SETTINGS_KEY = 'ai_actions'
export const DEFAULT_MAX_PER_CONVERSATION = 5
export const MIN_MAX_PER_CONVERSATION = 1
export const MAX_MAX_PER_CONVERSATION = 20

export type AiActionsSettings = {
  enabled: boolean
  actions: Record<ActionKind, boolean>
  maxPerConversation: number
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Turns whatever is stored or posted into a well-formed settings object. Fail
 * closed: anything that is not literally `true` is off, unknown kinds are
 * dropped, and the cap is forced into its bounds.
 */
export function normalizeAiActionsSettings(raw: unknown): AiActionsSettings {
  const src = isRecord(raw) ? raw : {}
  const rawActions = isRecord(src.actions) ? src.actions : {}

  const actions = {} as Record<ActionKind, boolean>
  for (const kind of ACTION_KINDS) actions[kind] = rawActions[kind] === true

  const n = typeof src.maxPerConversation === 'number' && Number.isFinite(src.maxPerConversation)
    ? Math.trunc(src.maxPerConversation)
    : DEFAULT_MAX_PER_CONVERSATION

  return {
    enabled: src.enabled === true,
    actions,
    maxPerConversation: Math.min(MAX_MAX_PER_CONVERSATION, Math.max(MIN_MAX_PER_CONVERSATION, n)),
  }
}

/** Kinds the assistant may propose, in ACTION_KINDS order; none when the master switch is off. */
export function enabledKinds(s: AiActionsSettings): ActionKind[] {
  if (!s.enabled) return []
  return ACTION_KINDS.filter(k => s.actions[k])
}

// ---------------------------------------------------------------------------
// Action cards and plans (built and signed server side, rendered client side)
// ---------------------------------------------------------------------------

export type ActionCard = {
  actionId: string
  kind: ActionKind
  tier: ActionTier
  target: {
    connId: string
    cluster: string
    node: string
    vmid?: number
    guestKind?: 'qemu' | 'lxc'
    name: string
  }
  params: Record<string, string | number | boolean>
  // Display data only: recomputed at execution, not covered by the signature.
  preflight: {
    ok: boolean
    checks: Array<{ level: 'ok' | 'warn' | 'block'; text: string }>
  }
  planId?: string
  step?: number
  /**
   * The step of the previous card of the same plan (manual steps skipped),
   * absent on the first one: execute refuses this card until that step was
   * dispatched and succeeded, so a plan runs one step at a time server side too.
   */
  after?: number
  expiresAt: number
  token: string
}

export type ActionPlan = {
  planId: string
  finding: 'unprotected_guests' | 'host_memory' | 'pending_updates'
  title: string
  steps: Array<{ step: number; card?: ActionCard; manual?: { text: string; href: string } }>
}

// Who a card was issued to: part of the signature, so a card cannot be replayed
// by another user, in another tenant or in another conversation.
export type ActionBinding = { userId: string; tenantId: string; conversationId: string }
