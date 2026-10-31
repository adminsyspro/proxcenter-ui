/**
 * Grounding of an action proposal (roadmap#188, Review Focus 1).
 *
 * A proposal may only target something the user named or was shown in the
 * conversation. Tool results are deliberately left out: a VM name read from a
 * task log, a guest note or a job comment is text anyone with write access to
 * Proxmox can plant, and a prompt injection there must not be able to put a
 * card for that guest under the user's cursor.
 */

import { resolveConnection, ToolScopeError, type ToolContext } from '@/lib/tools/types'

export const UNGROUNDED_TARGET_MESSAGE =
  'The user named neither this guest nor the host it runs on: ask them which guest or host to act on, do not explain how to do it by hand.'
export const UNGROUNDED_CLUSTER_MESSAGE = 'Name the cluster you want me to act on.'

/** The two texts a target is grounded on, carried by `ctx.actions`. */
export type ConversationGrounding = {
  /** User and assistant turns: the NAME of a safe action's target may come from either. */
  visibleText: string
  /** User turns only: a bare vmid, and the name of a disruptive action's target, must come from here. */
  userText: string
}

type Message = { role?: string; content?: unknown }

function turnsText(messages: Message[], roles: readonly string[]): string {
  if (!Array.isArray(messages)) return ''

  return messages
    .filter(m => typeof m?.role === 'string' && roles.includes(m.role) && typeof m.content === 'string')
    .map(m => m.content as string)
    .join('\n')
    .toLowerCase()
}

/**
 * What the user wrote and what the assistant already answered, from the
 * request body. Those turns are what the user has read; tool results never
 * travel in the body, so they cannot ground a target.
 */
export function visibleConversationText(messages: Message[]): string {
  return turnsText(messages, ['user', 'assistant'])
}

/** What the user wrote, same normalisation. */
export function userConversationText(messages: Message[]): string {
  return turnsText(messages, ['user'])
}

/** Both texts at once, for the chat routes building `ctx.actions`. */
export function conversationGrounding(messages: Message[]): ConversationGrounding {
  return { visibleText: visibleConversationText(messages), userText: userConversationText(messages) }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Whether `term` appears in the text as a whole token: vmid 10 is not named by
 * "104", host pve1 is not named by "pve12", db-01 is not named by "db-01-old".
 * Punctuation, dots included, ends a token, so "reboot pve1." names pve1.
 */
export function isGrounded(text: string, term: string | number | undefined): boolean {
  const needle = String(term ?? '').trim().toLowerCase()

  if (!needle || !text) return false

  return new RegExp(`(?<![\\p{L}\\p{N}_-])${escapeRegExp(needle)}(?![\\p{L}\\p{N}_-])`, 'u').test(text)
}

/**
 * Refuses a target the conversation never named. A name may come from a user
 * or an assistant turn; a vmid only from what the user typed: assistant
 * answers are full of numbers relayed from tool results ("128 GB", "uptime
 * 104 days"), and an injected "reboot 128" must not find one there.
 *
 * `userOnly` (the disruptive kinds: shutdown, reboot, maintenance, a container
 * migration): the name too must come from what the user typed. An assistant
 * answer relays names read from tool results, and an injected text that gets
 * the model to write "web-01" must not be enough to put a reboot of web-01
 * under the user's cursor.
 *
 * `byHost` (a migration only): a guest is also grounded by its host, on the
 * same text as its name: "move everything off pve1" names every guest of pve1
 * (lab, roadmap#188: the evacuation of pve1 got no card at all, its guests
 * being named only in tool results). Never for a shutdown or a reboot: "is
 * pve1 healthy?" must not let a note planted in a VM put a shutdown of that VM
 * under the user's cursor.
 */
export function assertTargetGrounded(
  grounding: ConversationGrounding,
  target: { name: string; vmid?: number | string; node?: string },
  opts: { userOnly?: boolean; byHost?: boolean } = {}
): void {
  const text = opts.userOnly ? grounding.userText : grounding.visibleText

  if (isGrounded(text, target.name)) return
  if (target.vmid !== undefined && isGrounded(grounding.userText, target.vmid)) return
  if (opts.byHost && target.vmid !== undefined && isGrounded(text, target.node)) return

  throw new ToolScopeError(UNGROUNDED_TARGET_MESSAGE)
}

/**
 * A `cluster` argument picks which of two same-named guests or hosts is
 * targeted, so it must be grounded too: by its name or id in the visible text.
 * The loop already drops an ungrounded one; the tools do not rely on that.
 */
export function assertClusterGrounded(grounding: ConversationGrounding, ctx: ToolContext, clusterRef: string | undefined): void {
  if (!clusterRef) return

  const connection = resolveConnection(ctx, clusterRef)

  if (isGrounded(grounding.visibleText, connection.name) || isGrounded(grounding.visibleText, connection.id)) return

  throw new ToolScopeError(UNGROUNDED_CLUSTER_MESSAGE)
}
