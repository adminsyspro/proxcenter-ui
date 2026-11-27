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

/** kept: left untouched because another node of the cluster could not be checked. */
export type NodeDestroyStatus = 'destroyed' | 'already-gone' | 'error' | 'kept'
export interface NodeDestroyResult { vmid: number; nodeName?: string; status: NodeDestroyStatus; error?: string; snippetWarning?: string }

export interface VmIdentity { name?: string; tags?: string; cicustom?: string }

/**
 * Whether the VM found at a VMID is still the node ProxCenter deployed: same
 * name, and the tags every module sets ("proxcenter" and the cluster name).
 * A VMID is reused once its VM is gone, and a cluster deleted long after it
 * was deployed must not take an unrelated VM with it.
 */
export function isDeployedNode(cfg: VmIdentity | null, nodeName: string, clusterName: string): boolean {
  if (!cfg || cfg.name !== nodeName) return false
  const tags = new Set((cfg.tags ?? '').split(/[;,\s]+/).map(t => t.trim().toLowerCase()).filter(Boolean))
  return tags.has('proxcenter') && tags.has(clusterName.toLowerCase())
}

export interface DestroyDeps {
  locate: (vmid: number) => Promise<{ node: string; status: string } | null>
  /** The VM's name, tags and cloud-init snippet, read before anything is changed. */
  getConfig: (node: string, vmid: number) => Promise<VmIdentity | null>
  stop: (node: string, vmid: number) => Promise<void>
  waitStopped: (node: string, vmid: number) => Promise<void>
  deleteVm: (node: string, vmid: number) => Promise<void>
  deleteSnippet: (node: string, ref: SnippetRef) => Promise<void>
  releaseIpam: (vmid: number) => Promise<void>
  isNotFound: (err: unknown) => boolean
}

export async function destroyOneNode(deps: DestroyDeps, vmid: number, nodeName: string, clusterName: string): Promise<NodeDestroyResult> {
  try {
    const loc = await deps.locate(vmid)
    if (!loc) return { vmid, nodeName, status: 'already-gone' }
    const cfg = await deps.getConfig(loc.node, vmid)
    if (!isDeployedNode(cfg, nodeName, clusterName)) {
      // Left untouched, and the cluster is kept: the operator decides.
      return { vmid, nodeName, status: 'error', error: `vm ${vmid} is no longer node ${nodeName} of cluster ${clusterName}` }
    }
    const snippet = parseCicustomSnippet(cfg?.cicustom)
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

/**
 * Why a node's VM must not be destroyed, or null when it is still the node
 * that was deployed (or already gone).
 */
export async function checkOneNode(deps: Pick<DestroyDeps, 'locate' | 'getConfig'>, vmid: number, nodeName: string, clusterName: string): Promise<string | null> {
  const loc = await deps.locate(vmid)
  if (!loc) return null
  const cfg = await deps.getConfig(loc.node, vmid)
  return isDeployedNode(cfg, nodeName, clusterName) ? null : `vm ${vmid} is no longer node ${nodeName} of cluster ${clusterName}`
}

type NodeRef = { nodeName: string; connectionId: string; vmid: number }

export async function destroyClusterNodesWith(
  nodes: NodeRef[],
  destroy: (connectionId: string, vmid: number, nodeName: string) => Promise<NodeDestroyResult>,
  check?: (connectionId: string, vmid: number, nodeName: string) => Promise<string | null>,
): Promise<{ results: NodeDestroyResult[]; allOk: boolean }> {
  // Every VM is checked before any is touched: one VM that is no longer the
  // deployed node (or cannot be read) keeps the whole cluster as it is,
  // instead of leaving it half destroyed.
  if (check) {
    const refusals = await Promise.all(nodes.map(n => check(n.connectionId, n.vmid, n.nodeName)
      .catch((err: any) => String(err?.message ?? err))))
    if (refusals.some(r => r !== null)) {
      const results = nodes.map((n, i): NodeDestroyResult => (refusals[i] === null
        ? { vmid: n.vmid, nodeName: n.nodeName, status: 'kept' }
        : { vmid: n.vmid, nodeName: n.nodeName, status: 'error', error: refusals[i] as string }))
      return { results, allOk: false }
    }
  }
  // One node after the other: a cluster's VMs are stopped and deleted in
  // turn, never all at once on the same Proxmox cluster. A throw (e.g.
  // getConnectionById on a deleted connection) becomes that node's error, so
  // the route still answers with the per-node results.
  const results = await nodes.reduce<Promise<NodeDestroyResult[]>>(async (prev, n) => {
    const done = await prev
    const r = await destroy(n.connectionId, n.vmid, n.nodeName)
      .catch((err: any): NodeDestroyResult => ({ vmid: n.vmid, nodeName: n.nodeName, status: 'error', error: String(err?.message ?? err) }))
    return [...done, r]
  }, Promise.resolve([]))
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
    getConfig: async (node, vmid) => pveFetch<VmIdentity | null>(conn, `/nodes/${node}/qemu/${vmid}/config`),
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

/**
 * One connection lookup per connection id. The promise is cached: the checks
 * run side by side and must share it.
 */
function connectionLoader(tenantId: string): (connectionId: string) => Promise<PveConn> {
  const cache = new Map<string, Promise<PveConn>>()
  return connectionId => {
    let conn = cache.get(connectionId)
    if (!conn) { conn = getConnectionById(connectionId, tenantId); cache.set(connectionId, conn) }
    return conn
  }
}

export async function destroyClusterNodes(tenantId: string, clusterId: string, clusterName: string): Promise<{ results: NodeDestroyResult[]; allOk: boolean }> {
  const nodes = await getNodeMapping(tenantId, clusterId)
  const connection = connectionLoader(tenantId)
  return destroyClusterNodesWith(
    nodes,
    async (connectionId, vmid, nodeName) => destroyOneNode(realDeps(await connection(connectionId)), vmid, nodeName, clusterName),
    async (connectionId, vmid, nodeName) => checkOneNode(realDeps(await connection(connectionId)), vmid, nodeName, clusterName),
  )
}

/**
 * Why each of these node VMs must not be destroyed (null when it is still the
 * deployed node, or already gone): the check a deletion runs, for the workers
 * a change removes through OpenTofu, which destroys by VMID.
 */
export async function checkNodeVms(
  tenantId: string,
  nodes: { nodeName: string; connectionId: string; vmid: number }[],
  clusterName: string,
): Promise<{ vmid: number; nodeName: string; refusal: string | null }[]> {
  const connection = connectionLoader(tenantId)
  return Promise.all(nodes.map(async n => ({
    vmid: n.vmid,
    nodeName: n.nodeName,
    refusal: await connection(n.connectionId)
      .then(conn => checkOneNode(realDeps(conn), n.vmid, n.nodeName, clusterName))
      .catch((err: any) => String(err?.message ?? err)),
  })))
}
