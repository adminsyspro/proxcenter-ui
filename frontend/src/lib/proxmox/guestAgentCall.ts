// src/lib/proxmox/guestAgentCall.ts
// Calls the QEMU guest agent of one VM through the node's pvedaemon slots
// (daemonSlots.ts), and leaves alone for AGENT_MUTE_MS a VM whose agent did
// not answer (roadmap#179). Ticking "QEMU Guest Agent" in the VM options
// without the agent running inside is common, and each call to such a VM
// holds a pvedaemon worker for about 3 s before PVE gives up: asking again on
// every page view, palette open or export is what saturated the node.

import { pveFetch, type ProxmoxClientOptions } from './client'
import { daemonNodeKey, DaemonSlotExpired, withDaemonSlot } from './daemonSlots'

export const AGENT_MUTE_MS = 10 * 60_000

const MAX_MUTED = 10_000

/** Until when each VM's agent is left alone. */
const muted = new Map<string, number>()

/** Raised without any PVE call while the VM's agent is left alone. */
export class GuestAgentMuted extends Error {
  constructor() {
    super('the guest agent did not answer recently, ProxCenter does not ask it again yet')
    this.name = 'GuestAgentMuted'
  }
}

type AgentConn = ProxmoxClientOptions & { id?: string }

function agentKey(conn: AgentConn, node: string, vmid: string | number) {
  return `${daemonNodeKey(conn, node)}/${vmid}`
}

/** Test hook: forget every muted agent. */
export function resetGuestAgentMutes() {
  muted.clear()
}

export function isGuestAgentMuted(conn: AgentConn, node: string, vmid: string | number, now = Date.now()): boolean {
  return (muted.get(agentKey(conn, node, vmid)) ?? 0) > now
}

function mute(key: string, now: number) {
  if (muted.size >= MAX_MUTED) {
    for (const [k, until] of muted) if (until <= now) muted.delete(k)
    if (muted.size >= MAX_MUTED) muted.delete(muted.keys().next().value!)
  }
  muted.set(key, now + AGENT_MUTE_MS)
}

/**
 * GET /nodes/{node}/qemu/{vmid}/agent/{command}. Throws GuestAgentMuted while
 * the agent is left alone, DaemonSlotExpired past `deadline`, and the PVE
 * error otherwise, which starts the mute. `mute: false` for a command an
 * agent that just answered may lack (get-osinfo on an old agent): its error
 * says nothing about the agent being down.
 */
export async function callGuestAgent<T>(
  conn: AgentConn,
  node: string,
  vmid: string | number,
  command: string,
  opts: { deadline?: number; now?: () => number; mute?: boolean } = {},
): Promise<T> {
  const now = opts.now ?? Date.now
  const key = agentKey(conn, node, vmid)

  if ((muted.get(key) ?? 0) > now()) throw new GuestAgentMuted()

  const path = `/nodes/${encodeURIComponent(node)}/qemu/${encodeURIComponent(String(vmid))}/agent/${command}`

  try {
    const answer = await withDaemonSlot(daemonNodeKey(conn, node), () => pveFetch<T>(conn, path), opts)

    muted.delete(key)

    return answer
  } catch (err) {
    if (opts.mute !== false && !(err instanceof DaemonSlotExpired)) mute(key, now())
    throw err
  }
}
