/**
 * Clickable choices under an answer (roadmap#188).
 *
 * When a tool refuses a reference that matched several targets (two VMs of
 * the same name, a host name two clusters share, several clusters and none
 * named), the resolver lists the candidates itself (`AmbiguousTargetError`).
 * The loop keeps them in the trace, never in what the model reads, and the
 * widget shows them as rows the user clicks: picking one sends its `reply` as
 * the next message. The model never chooses among homonyms.
 *
 * Pure module, shared by the routes (collect) and the drawer (sanitise): no
 * Next, Prisma or React import belongs here.
 */

import { MAX_TARGET_CHOICES, type TargetChoice } from '@/lib/tools/types'

/** Longest label or reply kept: a guest, host and cluster name fit well under it. */
export const MAX_CHOICE_TEXT = 200

const KINDS: readonly TargetChoice['kind'][] = ['guest', 'host', 'cluster']

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isChoiceText = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_CHOICE_TEXT && !/[\u0000-\u001f]/.test(value)

/** A choice read back from the stream or the plain route, or null when it is not one. */
export function sanitizeTargetChoice(raw: unknown): TargetChoice | null {
  if (!isRecord(raw)) return null

  const kind = KINDS.find(k => k === raw.kind)
  const { label, reply } = raw

  if (!kind || !isChoiceText(label) || !isChoiceText(reply)) return null

  const guestKind = kind === 'guest' && (raw.guestKind === 'qemu' || raw.guestKind === 'lxc') ? raw.guestKind : undefined

  return { label, reply, kind, ...(guestKind ? { guestKind } : {}) }
}

/** The valid choices of a list, once per reply, at most MAX_TARGET_CHOICES. */
export function sanitizeTargetChoices(raw: unknown): TargetChoice[] {
  const seen = new Set<string>()
  const kept: TargetChoice[] = []

  for (const item of Array.isArray(raw) ? raw : []) {
    const choice = sanitizeTargetChoice(item)

    if (!choice || seen.has(choice.reply)) continue

    seen.add(choice.reply)
    kept.push(choice)

    if (kept.length >= MAX_TARGET_CHOICES) break
  }

  return kept
}

/**
 * The choices of one answer: those of the LAST ambiguous refusal of the
 * request, the one the model closed on. An earlier one may concern a lookup
 * the model moved past.
 *
 * None when a later call of the same tool succeeded: the ambiguity is settled
 * already (recette #188: after the user clicked "w22-i1000 (vmid 111 ...)",
 * the model first passed the bare name, got the choices again, then the vmid,
 * and the card came with a "Which one?" list that no longer had a question).
 */
export function collectTargetChoices(
  trace: ReadonlyArray<{ name?: string; ok?: boolean; args?: Record<string, unknown>; choices?: TargetChoice[] }>
): TargetChoice[] {
  const index = trace.findLastIndex(entry => entry.choices?.length)

  if (index === -1) return []

  const { name, choices = [] } = trace[index]
  const later = trace.slice(index + 1)
  const vmids = new Set(choices.map(choiceVmid).filter(Boolean))
  const settled =
    (name !== undefined && later.some(entry => entry.name === name && entry.ok === true)) ||
    // The model went on with one of the listed vmids and no new ambiguity
    // (lab, roadmap#188: the evacuation of pve1 moved on to vmid 9921, the
    // r9lxc-zfs of pve1, and the list asked a question already answered).
    later.some(entry => !entry.choices?.length && vmids.has(String(entry.args?.guest ?? '').trim()))

  return settled ? [] : sanitizeTargetChoices(choices)
}

/** The vmid a guest choice's reply carries ("web-01 (vmid 104, pve1, PVE-PROD)"), else ''. */
function choiceVmid(choice: TargetChoice): string {
  return choice.kind === 'guest' ? (/\(vmid (\d+)/.exec(choice.reply)?.[1] ?? '') : ''
}

/**
 * Whether a call reads as consulted, for the "Sources" row. A refusal that
 * hands the user choices is a question back, not a failure.
 */
export function consultedOk(entry: { ok: boolean; choices?: TargetChoice[] }): boolean {
  return entry.ok || Boolean(entry.choices?.length)
}
