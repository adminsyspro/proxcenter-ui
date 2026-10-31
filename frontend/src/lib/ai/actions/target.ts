/**
 * What an action card targets, resolved on the caller's RBAC- and
 * vDC-filtered snapshot only (roadmap#188).
 *
 * Shared by the proposal tools (a guest or host the model names) and by the
 * execute route (a card's connection and vmid or host, re-resolved at click
 * time): a target the caller can no longer see is a refusal, never a lookup
 * against Proxmox.
 */

import type { SnapshotGuest, SnapshotNode } from '@/lib/tools/snapshot'
import {
  AmbiguousTargetError,
  guestChoice,
  guestsMovableTo,
  hostChoice,
  resolveConnection,
  resolveGuest,
  resolveNode,
  ToolScopeError,
  type ToolContext,
} from '@/lib/tools/types'

import { isGrounded } from './grounding'
import type { ActionCard, ActionKind } from './types'

/** Kinds acting on a host; every other kind acts on one guest. */
export const HOST_KINDS: readonly ActionKind[] = ['maintenance']

export const isHostKind = (kind: ActionKind) => HOST_KINDS.includes(kind)

export type ActionTargetInput = {
  kind: ActionKind
  /** Guest name or vmid (a vmid when `connId` is given). */
  guest?: string
  /** Host name, for a host kind. */
  host?: string
  /** Cluster name or id, to tell apart two guests or hosts of the same name. */
  cluster?: string
  /** Exact connection of a card being re-resolved: no fuzzy name match then. */
  connId?: string
}

export function guestTarget(g: SnapshotGuest): ActionCard['target'] {
  return { connId: g.connId, cluster: g.cluster, node: g.node, vmid: Number(g.vmid), guestKind: g.kind, name: g.name }
}

export function hostTarget(n: SnapshotNode): ActionCard['target'] {
  return { connId: n.connId, cluster: n.cluster, node: n.name, name: n.name }
}

/** The snapshot guest a card targets, by connection and vmid. */
export function findTargetGuest(ctx: ToolContext, target: ActionCard['target']): SnapshotGuest | undefined {
  if (target.vmid === undefined) return undefined

  return ctx.snapshot.guests.find(g => g.connId === target.connId && g.vmid === String(target.vmid))
}

/** The snapshot host a card targets, by connection and name. */
export function findTargetNode(ctx: ToolContext, connId: string, name: string): SnapshotNode | undefined {
  return ctx.snapshot.nodes.find(n => n.connId === connId && n.name === name)
}

// Pure, in ./types: the browser's decoder derives the same tier.
export { actionTier } from './types'

export function resolveActionTarget(input: ActionTargetInput, ctx: ToolContext): ActionCard['target'] {
  if (isHostKind(input.kind)) {
    if (input.connId) {
      const node = input.host ? findTargetNode(ctx, input.connId, input.host) : undefined

      if (!node) throw new ToolScopeError(`Host ${input.host ?? '(none)'} is not visible to you.`)

      return hostTarget(node)
    }

    if (!input.host) throw new ToolScopeError('Name the host to act on.')

    return hostTarget(resolveNode(ctx, input.host, input.cluster).node)
  }

  if (input.connId) {
    const guest = findTargetGuest(ctx, { connId: input.connId, cluster: '', node: '', name: '', vmid: Number(input.guest) })

    if (!guest || !/^\d+$/.test(String(input.guest ?? ''))) {
      throw new ToolScopeError(`No VM or container ${input.guest ?? ''} is visible to you.`)
    }

    return guestTarget(guest)
  }

  // A cluster narrows the guest lookup to it: two clusters may reuse a vmid.
  if (input.cluster) {
    const connection = resolveConnection(ctx, input.cluster)
    const scoped = { ...ctx, snapshot: { ...ctx.snapshot, guests: ctx.snapshot.guests.filter(g => g.connId === connection.id) } }

    return guestTarget(resolveGuest(scoped, input.guest))
  }

  return guestTarget(resolveGuest(ctx, input.guest))
}

/** What the user typed that may tell same-named guests apart (see `pickHomonymByScope`). */
export type HomonymScope = {
  userText: string
  /** migrate: the destination host the model passed, counted only when the user typed it. */
  targetHost?: string
}

/**
 * The one guest of `homonyms` the user's own words point at, else undefined
 * (lab, roadmap#188: "move what is left on pve1 to pve3" while a container of
 * the same name lives in PVE-DR got a "which one?" for a question the user had
 * already answered). Two hints, both from what the user typed, never from the
 * model's own pick:
 * - the destination of a migration: a guest can only move within its cluster,
 *   and one already on that host is not the one to move;
 * - the host the guest runs on, when the user named only one homonym's host.
 */
export function pickHomonymByScope(ctx: ToolContext, homonyms: SnapshotGuest[], scope: HomonymScope): SnapshotGuest | undefined {
  let pool = homonyms
  const dest = scope.targetHost?.trim().toLowerCase()

  if (dest && isGrounded(scope.userText, dest)) {
    pool = guestsMovableTo(ctx, pool, dest)

    if (pool.length === 1) return pool[0]
  }

  const onNamedHost = pool.filter(g => isGrounded(scope.userText, g.node))

  return onNamedHost.length === 1 ? onNamedHost[0] : undefined
}

/** The visible guests carrying exactly this name, case aside. */
export function guestsNamed(ctx: ToolContext, name: string | undefined): SnapshotGuest[] {
  const needle = String(name ?? '').trim().toLowerCase()

  return needle ? ctx.snapshot.guests.filter(g => g.name.toLowerCase() === needle) : []
}

const ASK_WHICH = 'The user picks one from the list shown under your answer: ask which one, do not pick one yourself.'

/**
 * Refuses a card for one of several same-named targets the user did not tell
 * apart (lab, roadmap#188: two VMs named w22-i1000, qwen3.5:9b picked vmid 111
 * from a tool result and proposed the card). A guest homonym needs its vmid in
 * what the user typed, plus its cluster when two clusters reuse that vmid; a
 * host homonym needs its cluster. The model's own choice, even grounded on a
 * name the user wrote, is never enough; the user's own scope is
 * (`pickHomonymByScope`). The refusal carries the homonyms as
 * clickable choices and is raised before the proposal budget is spent.
 */
export function assertTargetUnambiguous(
  ctx: ToolContext,
  target: ActionCard['target'],
  userText: string,
  opts: { targetHost?: string } = {}
): void {
  const name = target.name.toLowerCase()
  const clusterNamed = isGrounded(userText, target.cluster) || isGrounded(userText, target.connId)

  if (target.vmid !== undefined) {
    const homonyms = guestsNamed(ctx, name)

    if (homonyms.length < 2) return

    const sameVmid = homonyms.filter(g => g.vmid === String(target.vmid))

    if (isGrounded(userText, target.vmid) && (sameVmid.length < 2 || clusterNamed)) return

    const picked = pickHomonymByScope(ctx, homonyms, { userText, targetHost: opts.targetHost })

    if (picked && picked.connId === target.connId && picked.vmid === String(target.vmid)) return

    throw new AmbiguousTargetError(
      `Several guests are named "${target.name}": ${homonyms.map(g => `${g.name} (${g.vmid} on ${g.node}, ${g.cluster})`).join(', ')}. ${ASK_WHICH}`,
      homonyms.map(guestChoice)
    )
  }

  const homonyms = ctx.snapshot.nodes.filter(n => n.name.toLowerCase() === name)

  if (homonyms.length < 2 || clusterNamed) return

  throw new AmbiguousTargetError(
    `Several clusters have a host named "${target.name}": ${homonyms.map(n => n.cluster).join(', ')}. ${ASK_WHICH}`,
    homonyms.map(hostChoice)
  )
}
