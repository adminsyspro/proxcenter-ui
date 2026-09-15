// src/lib/vdc/tenantNetworkReachability.ts
// Reachability test of a stretched tenant network (#901): every node of each
// member vDC pings the transport peers of the other members, over SSH. An
// address that answers proves the underlay routes it, not that UDP 4789
// passes; one that does not explains an overlay that stays silent although
// both zones are in sync. A diagnostic run on demand, never at save time.

import { prisma } from '@/lib/db/prisma'
import { executeSSH, shellEscape } from '@/lib/ssh/exec'
import { getNodeIp } from '@/lib/ssh/node-ip'

import { connectionOf, memberPeersForVdc, VDC_TRANSPORT_SELECT } from './stretchPeers'

const ERR = 'Tenant network:'

export type ReachabilityState = 'reachable' | 'unreachable' | 'unavailable'

export interface ReachabilityResult {
  vdcId: string
  vdcName: string
  connectionId: string
  connectionName: string
  node: string
  peer: string
  state: ReachabilityState
  /** Why the check could not run, when `unavailable`. */
  message?: string
}

const PING_COUNT = 1
const PING_TIMEOUT_S = 1

/** One shell round trip per node: pings every peer and prints "<peer> ok|ko". */
export function buildPingCommand(peers: string[]): string {
  const list = peers.map(shellEscape).join(' ')
  return `for p in ${list}; do if ping -c ${PING_COUNT} -W ${PING_TIMEOUT_S} -q "$p" >/dev/null 2>&1; then echo "$p ok"; else echo "$p ko"; fi; done`
}

/** The "<peer> ok|ko" lines back into a map; anything else is ignored. */
export function parsePingOutput(output: string, peers: string[]): Map<string, boolean> {
  const wanted = new Set(peers)
  const result = new Map<string, boolean>()
  for (const line of output.split('\n')) {
    const m = line.trim().match(/^(\S+) (ok|ko)$/)
    if (m && wanted.has(m[1])) result.set(m[1], m[2] === 'ok')
  }
  return result
}

export async function testNetworkReachability(networkId: string): Promise<ReachabilityResult[]> {
  const network = await prisma.tenantNetwork.findUnique({
    where: { id: networkId },
    select: {
      id: true,
      name: true,
      members: { select: { vdc: { select: { ...VDC_TRANSPORT_SELECT, nodes: { select: { nodeName: true } } } } } },
    },
  })
  if (!network) throw new Error(`${ERR} not found: ${networkId}`)
  if (network.members.length < 2) {
    throw new Error(`${ERR} "${network.name}" needs at least two member vDCs to test reachability.`)
  }

  const connectionIds = [...new Set(network.members.map(m => m.vdc.connectionId))]
  const connections = await prisma.connection.findMany({
    where: { id: { in: connectionIds } },
    select: { id: true, name: true, sshEnabled: true },
  })

  const results: ReachabilityResult[] = []
  for (const { vdc } of network.members) {
    const connection = connections.find(c => c.id === vdc.connectionId)
    const base = { vdcId: vdc.id, vdcName: vdc.name, connectionId: vdc.connectionId, connectionName: connection?.name ?? vdc.connectionId }
    const peers = await memberPeersForVdc(vdc.id)
    const nodes = vdc.nodes.map(n => n.nodeName)
    if (peers.length === 0 || nodes.length === 0) continue

    const unavailable = (node: string, message: string) => {
      for (const peer of peers) results.push({ ...base, node, peer, state: 'unavailable', message })
    }

    if (!connection?.sshEnabled) {
      for (const node of nodes) unavailable(node, 'SSH is not enabled on this connection')
      continue
    }

    let conn: any
    try {
      conn = await connectionOf(vdc.connectionId)
    } catch (err: any) {
      for (const node of nodes) unavailable(node, err?.message || String(err))
      continue
    }

    // The nodes of one cluster in parallel: each SSH session pings every peer once.
    const perNode = await Promise.all(nodes.map(async (node): Promise<ReachabilityResult[]> => {
      let nodeIp: string
      try {
        nodeIp = await getNodeIp(conn, node)
      } catch (err: any) {
        return peers.map(peer => ({ ...base, node, peer, state: 'unavailable' as const, message: err?.message || String(err) }))
      }
      const res = await executeSSH(vdc.connectionId, nodeIp, buildPingCommand(peers), 10_000 + peers.length * 2_000)
      if (!res.success) {
        return peers.map(peer => ({ ...base, node, peer, state: 'unavailable' as const, message: res.error || 'SSH command failed' }))
      }
      const parsed = parsePingOutput(res.output ?? '', peers)
      return peers.map(peer => {
        const ok = parsed.get(peer)
        if (ok === undefined) return { ...base, node, peer, state: 'unavailable' as const, message: 'no answer parsed from the node' }
        return { ...base, node, peer, state: ok ? 'reachable' as const : 'unreachable' as const }
      })
    }))
    for (const list of perNode) results.push(...list)
  }
  return results
}
