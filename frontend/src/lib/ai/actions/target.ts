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
import { resolveConnection, resolveGuest, resolveNode, ToolScopeError, type ToolContext } from '@/lib/tools/types'

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
