import { getTenantPrisma } from '@/lib/tenant'
import { prisma } from '@/lib/db/prisma'
import { encryptSecret, decryptSecret } from '@/lib/crypto/secret'
import type { SanitizedCredential, ClusterHealth } from './types'

export interface CreateClusterInput {
  name: string
  distro: 'k3s' | 'kubeadm' | 'generic' | 'talos' | 'rke2'
  source: 'imported' | 'deployed'
  cred: SanitizedCredential
  proxmoxConnectionId?: string | null
  provisioningRunId?: string | null
  clusterUid?: string | null
  createdBy?: string | null
}

export function toPublic(row: any) {
  if (!row) return row
  const { credentialEnc, ...rest } = row
  return rest
}

export async function listClusters(tenantId: string) {
  const db = getTenantPrisma(tenantId)
  const rows = await db.kubernetesCluster.findMany({ orderBy: { createdAt: 'desc' } })
  return rows.map(toPublic)
}

export async function createCluster(tenantId: string, input: CreateClusterInput): Promise<string> {
  const db = getTenantPrisma(tenantId)
  const row = await db.kubernetesCluster.create({
    data: {
      tenantId,
      name: input.name,
      distro: input.distro,
      source: input.source,
      contextName: input.cred.contextName,
      apiServerUrl: input.cred.apiServerUrl,
      caDataPem: input.cred.caDataPem ?? null,
      tlsServerName: input.cred.tlsServerName ?? null,
      insecureSkipTlsVerify: input.cred.insecureSkipTlsVerify,
      credentialEnc: encryptSecret(input.cred.credential),
      credentialType: input.cred.credentialType,
      proxmoxConnectionId: input.proxmoxConnectionId ?? null,
      provisioningRunId: input.provisioningRunId ?? null,
      clusterUid: input.clusterUid ?? null,
      createdBy: input.createdBy ?? null,
    },
  })
  return row.id
}

export async function getClusterWithCredential(
  tenantId: string,
  id: string,
): Promise<{ row: any; credential: SanitizedCredential } | null> {
  const db = getTenantPrisma(tenantId)
  const row = await db.kubernetesCluster.findUnique({ where: { id } })
  if (!row) return null
  const credential: SanitizedCredential = {
    apiServerUrl: row.apiServerUrl,
    caDataPem: row.caDataPem ?? undefined,
    tlsServerName: row.tlsServerName ?? undefined,
    insecureSkipTlsVerify: row.insecureSkipTlsVerify,
    credentialType: row.credentialType as 'token' | 'client_cert',
    credential: decryptSecret(row.credentialEnc),
    contextName: row.contextName ?? '',
  }
  return { row: toPublic(row), credential }
}

export async function replaceCredential(
  tenantId: string,
  id: string,
  cred: SanitizedCredential,
): Promise<void> {
  const db = getTenantPrisma(tenantId)
  const current = await db.kubernetesCluster.findUnique({
    where: { id },
    select: { credentialVersion: true },
  })
  if (!current) throw new Error('Record not found')
  await db.kubernetesCluster.update({
    where: { id },
    data: {
      apiServerUrl: cred.apiServerUrl,
      caDataPem: cred.caDataPem ?? null,
      tlsServerName: cred.tlsServerName ?? null,
      insecureSkipTlsVerify: cred.insecureSkipTlsVerify,
      credentialEnc: encryptSecret(cred.credential),
      credentialType: cred.credentialType,
      contextName: cred.contextName,
      credentialVersion: current.credentialVersion + 1,
      credentialUpdatedAt: new Date(),
    },
  })
}

export async function updateMeta(
  tenantId: string,
  id: string,
  data: { name?: string; proxmoxConnectionId?: string | null },
): Promise<void> {
  const db = getTenantPrisma(tenantId)
  await db.kubernetesCluster.update({ where: { id }, data })
}

/**
 * Persist a health probe result and return the updated cluster row in its
 * public shape (credentialEnc stripped), so callers can respond with the
 * post-persist state instead of a stale pre-probe snapshot.
 */
export async function persistHealth(tenantId: string, id: string, h: ClusterHealth) {
  const db = getTenantPrisma(tenantId)
  const now = new Date()
  const success = h.state === 'healthy' || h.state === 'degraded'
  const updated = await db.kubernetesCluster.update({
    where: { id },
    data: {
      healthState: h.state,
      healthDetail: { nodesReady: h.nodesReady, nodesTotal: h.nodesTotal },
      version: h.version ?? undefined,
      lastHealthAt: now,
      lastSuccessAt: success ? now : undefined,
      lastFailureAt: success ? undefined : now,
      lastErrorCode: h.errorCode ?? null,
      lastErrorMessage: h.errorMessage ?? null,
    },
  })
  return toPublic(updated)
}

export async function deleteCluster(tenantId: string, id: string): Promise<void> {
  const db = getTenantPrisma(tenantId)
  await db.kubernetesCluster.delete({ where: { id } })
}

/**
 * Remove all node-mapping rows for a cluster. `kubernetes_cluster_nodes` has
 * no tenantId column and no FK cascade from the cluster row, so callers must
 * invoke this alongside deleteCluster or the rows are orphaned. Uses the BASE
 * prisma client for the same reason as recordNodeMapping/getNodeMapping.
 * Returns the number of rows deleted.
 */
export async function deleteClusterNodes(clusterId: string): Promise<number> {
  const res = await prisma.kubernetesClusterNode.deleteMany({ where: { clusterId } })
  return res.count
}

/**
 * Record the authoritative K8s-node to Proxmox-VM mapping for a cluster.
 * `kubernetes_cluster_nodes` has no tenantId column (the cluster row already
 * scopes it), so this writes through the base client rather than
 * getTenantPrisma. Upserts on the (clusterId, nodeName) unique key so
 * re-running a discovery/provisioning pass is safe.
 */
export async function recordNodeMapping(
  clusterId: string,
  nodes: { name: string; vmid: number; connectionId: string }[],
): Promise<void> {
  // All or nothing: a half-recorded mapping would let a later delete miss VMs.
  await prisma.$transaction(nodes.map(node => prisma.kubernetesClusterNode.upsert({
    where: { clusterId_nodeName: { clusterId, nodeName: node.name } },
    create: { clusterId, nodeName: node.name, vmid: node.vmid, connectionId: node.connectionId },
    update: { vmid: node.vmid, connectionId: node.connectionId },
  })))
}

/**
 * Read the authoritative K8s-node to Proxmox-VM mapping for a cluster.
 *
 * Tenant safety: `kubernetes_cluster_nodes` has no tenantId column (the
 * cluster row already scopes it), so we cannot rely on getTenantPrisma to
 * filter the node read itself -- doing so would inject a bogus tenantId
 * filter on a model that doesn't have that column. Instead we first verify
 * the cluster belongs to the tenant (via getTenantPrisma, which returns null
 * on a tenant mismatch), then read the node rows through the BASE prisma
 * client. A missing/foreign cluster returns [] rather than throwing.
 */
export async function getNodeMapping(
  tenantId: string,
  clusterId: string,
): Promise<{ nodeName: string; connectionId: string; vmid: number }[]> {
  const db = getTenantPrisma(tenantId)
  const cluster = await db.kubernetesCluster.findUnique({ where: { id: clusterId }, select: { id: true } })
  if (!cluster) return []
  const rows = await prisma.kubernetesClusterNode.findMany({ where: { clusterId } })
  return rows.map(r => ({ nodeName: r.nodeName, connectionId: r.connectionId, vmid: r.vmid }))
}

/**
 * Makes the node mapping of a cluster match its deployed nodes: rows of nodes
 * that are gone are removed, the others written. One transaction. Returns the
 * names of the nodes that were removed.
 */
export async function syncNodeMapping(
  clusterId: string,
  nodes: { name: string; vmid: number; connectionId: string }[],
): Promise<string[]> {
  const names = nodes.map(n => n.name)
  const gone = await prisma.kubernetesClusterNode.findMany({ where: { clusterId, nodeName: { notIn: names } }, select: { nodeName: true } })
  await prisma.$transaction([
    prisma.kubernetesClusterNode.deleteMany({ where: { clusterId, nodeName: { notIn: names } } }),
    ...nodes.map(node => prisma.kubernetesClusterNode.upsert({
      where: { clusterId_nodeName: { clusterId, nodeName: node.name } },
      create: { clusterId, nodeName: node.name, vmid: node.vmid, connectionId: node.connectionId },
      update: { vmid: node.vmid, connectionId: node.connectionId },
    })),
  ])
  return gone.map(g => g.nodeName)
}
