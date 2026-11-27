// src/lib/k8s/server/destroyClusterNodes.ts
// Proxmox-direct destruction of a deployed cluster's node VMs. The per-node
// sequence is parameterized over injected primitives (DestroyDeps) so it is
// unit-testable without a live Proxmox (mirrors the k3s kubeconfig-fetch seam).
import { getConnectionById, type PveConn } from '@/lib/connections/getConnection'
import { pveFetch } from '@/lib/proxmox/client'
import { locateVmInCluster, isVmConfigNotFoundError } from '@/lib/proxmox/locateVm'
import { releaseAllocationsForVm } from '@/lib/vdc/ipam'
import { getNodeMapping } from '@/lib/k8s/repository'

export interface SnippetRef { storage: string; volid: string }

export function parseCicustomSnippet(cicustom: string | null | undefined): SnippetRef | null {
  if (!cicustom) return null
  for (const part of cicustom.split(',')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    if (part.slice(0, eq).trim() === 'user') {
      const volid = part.slice(eq + 1).trim()
      const colon = volid.indexOf(':')
      if (colon <= 0) return null
      return { storage: volid.slice(0, colon), volid }
    }
  }
  return null
}

export type NodeDestroyStatus = 'destroyed' | 'already-gone' | 'error'
export interface NodeDestroyResult { vmid: number; nodeName?: string; status: NodeDestroyStatus; error?: string; snippetWarning?: string }

export interface DestroyDeps {
  locate: (vmid: number) => Promise<{ node: string; status: string } | null>
  getCicustom: (node: string, vmid: number) => Promise<string | null>
  stop: (node: string, vmid: number) => Promise<void>
  waitStopped: (node: string, vmid: number) => Promise<void>
  deleteVm: (node: string, vmid: number) => Promise<void>
  deleteSnippet: (node: string, ref: SnippetRef) => Promise<void>
  releaseIpam: (vmid: number) => Promise<void>
  isNotFound: (err: unknown) => boolean
}

export async function destroyOneNode(deps: DestroyDeps, vmid: number, nodeName?: string): Promise<NodeDestroyResult> {
  try {
    const loc = await deps.locate(vmid)
    if (!loc) return { vmid, nodeName, status: 'already-gone' }
    const cicustom = await deps.getCicustom(loc.node, vmid).catch(() => null)
    const snippet = parseCicustomSnippet(cicustom)
    if (loc.status !== 'stopped') {
      await deps.stop(loc.node, vmid)
      await deps.waitStopped(loc.node, vmid)
    }
    await deps.deleteVm(loc.node, vmid)
    let snippetWarning: string | undefined
    if (snippet) {
      try { await deps.deleteSnippet(loc.node, snippet) } catch (e: any) { snippetWarning = String(e?.message ?? e) }
    }
    await deps.releaseIpam(vmid).catch(() => {})
    return { vmid, nodeName, status: 'destroyed', snippetWarning }
  } catch (err: any) {
    if (deps.isNotFound(err)) return { vmid, nodeName, status: 'already-gone' }
    return { vmid, nodeName, status: 'error', error: String(err?.message ?? err) }
  }
}

export async function destroyClusterNodesWith(
  nodes: { nodeName: string; connectionId: string; vmid: number }[],
  destroy: (connectionId: string, vmid: number, nodeName: string) => Promise<NodeDestroyResult>,
): Promise<{ results: NodeDestroyResult[]; allOk: boolean }> {
  const results: NodeDestroyResult[] = []
  for (const n of nodes) {
    try {
      results.push(await destroy(n.connectionId, n.vmid, n.nodeName))
    } catch (err: any) {
      // A throw here (e.g. getConnectionById on a deleted connection) must not
      // escape the loop: report it as a per-node error so the route still
      // returns the structured 409 + results and audits the failure.
      results.push({ vmid: n.vmid, nodeName: n.nodeName, status: 'error', error: String(err?.message ?? err) })
    }
  }
  return { results, allOk: results.every(r => r.status !== 'error') }
}

// Real wiring: build DestroyDeps from a PveConn using pveFetch + locateVmInCluster.
// Note: pveFetch already unwraps the PVE `{data: ...}` envelope, so responses
// are typed as the inner payload directly.
function realDeps(conn: PveConn): DestroyDeps {
  return {
    locate: async (vmid) => {
      const l = await locateVmInCluster(conn, vmid, 'qemu')
      return l ? { node: l.node, status: l.status ?? 'unknown' } : null
    },
    getCicustom: async (node, vmid) => {
      const cfg = await pveFetch<{ cicustom?: string } | null>(conn, `/nodes/${node}/qemu/${vmid}/config`)
      return cfg?.cicustom ?? null
    },
    stop: async (node, vmid) => { await pveFetch(conn, `/nodes/${node}/qemu/${vmid}/status/stop`, { method: 'POST' }) },
    waitStopped: async (node, vmid) => {
      for (let i = 0; i < 30; i++) {
        const s = await pveFetch<{ status?: string; lock?: string } | null>(conn, `/nodes/${node}/qemu/${vmid}/status/current`)
        if (s?.status === 'stopped' && !s?.lock) return
        await new Promise(r => setTimeout(r, 2000))
      }
      throw new Error(`vm ${vmid} did not stop in time`)
    },
    deleteVm: async (node, vmid) => { await pveFetch(conn, `/nodes/${node}/qemu/${vmid}?purge=1&destroy-unreferenced-disks=1`, { method: 'DELETE' }) },
    deleteSnippet: async (node, ref) => { await pveFetch(conn, `/nodes/${node}/storage/${ref.storage}/content/${encodeURIComponent(ref.volid)}`, { method: 'DELETE' }) },
    releaseIpam: async (vmid) => { await releaseAllocationsForVm(conn.id, vmid) },
    isNotFound: (err) => isVmConfigNotFoundError(err),
  }
}

export async function destroyClusterNodes(tenantId: string, clusterId: string): Promise<{ results: NodeDestroyResult[]; allOk: boolean }> {
  const nodes = await getNodeMapping(tenantId, clusterId)
  const cache = new Map<string, PveConn>()
  return destroyClusterNodesWith(nodes, async (connectionId, vmid, nodeName) => {
    let conn = cache.get(connectionId)
    if (!conn) { conn = await getConnectionById(connectionId, tenantId); cache.set(connectionId, conn) }
    return destroyOneNode(realDeps(conn), vmid, nodeName)
  })
}
