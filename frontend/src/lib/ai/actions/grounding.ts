/**
 * Grounding of an action proposal (roadmap#188, Review Focus 1).
 *
 * A proposal may only target something the user named or was shown in the
 * conversation. Tool results are deliberately left out: a VM name read from a
 * task log, a guest note or a job comment is text anyone with write access to
 * Proxmox can plant, and a prompt injection there must not be able to put a
 * card for that guest under the user's cursor.
 */

import { ToolScopeError } from '@/lib/tools/types'

export const UNGROUNDED_TARGET_MESSAGE = 'Name the guest or host you want me to act on.'

/**
 * What the user wrote and what the assistant already answered, from the
 * request body. Those turns are what the user has read; tool results never
 * travel in the body, so they cannot ground a target.
 */
export function visibleConversationText(messages: Array<{ role?: string; content?: unknown }>): string {
  if (!Array.isArray(messages)) return ''

  return messages
    .filter(m => (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string')
    .map(m => m.content as string)
    .join('\n')
    .toLowerCase()
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Whether `term` appears in the text as a whole token: vmid 10 is not named by
 * "104", host pve1 is not named by "pve12", db-01 is not named by "db-01-old".
 * Punctuation, dots included, ends a token, so "reboot pve1." names pve1.
 */
export function isGrounded(visibleText: string, term: string | number | undefined): boolean {
  const needle = String(term ?? '').trim().toLowerCase()

  if (!needle || !visibleText) return false

  return new RegExp(`(?<![\\p{L}\\p{N}_-])${escapeRegExp(needle)}(?![\\p{L}\\p{N}_-])`, 'u').test(visibleText)
}

/** Refuses a target whose name (or, for a guest, vmid) the conversation never showed. */
export function assertTargetGrounded(visibleText: string, target: { name: string; vmid?: number | string }): void {
  if (isGrounded(visibleText, target.name)) return
  if (target.vmid !== undefined && isGrounded(visibleText, target.vmid)) return

  throw new ToolScopeError(UNGROUNDED_TARGET_MESSAGE)
}
