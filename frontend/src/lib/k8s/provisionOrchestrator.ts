// src/lib/k8s/provisionOrchestrator.ts
// Thin wrapper around orchestratorFetch for the Go orchestrator's Talos
// provisioning endpoints. Tenant scoping flows automatically through
// orchestratorFetch's X-Tenant-ID header (see src/lib/orchestrator/client.ts),
// so these wrappers never take a tenantId param.

import { orchestratorFetch } from '@/lib/orchestrator/client'
import { orchestratorPath } from '@/lib/orchestrator/path'

export interface ProvisionNodeSpec {
  name: string
  ip: string
  vmid: number
  /** A worker sized on its own (cores, memory in MiB, disk in GiB); absent = the cluster's worker sizing. */
  cores?: number
  memory?: number
  disk?: number
}

export interface ProvisionRequest {
  // 'talos' | 'k3s' on the wire. Flat optional per-distro fields, NOT a
  // discriminated union (tsconfig strict:false union-narrowing caveat).
  distro: string
  clusterName: string
  connectionId: string
  pveNode: string
  imageDatastore: string
  vmDatastore: string
  bridge: string
  vlan: number
  subnetPrefix: number
  gateway: string
  dns: string[]
  // talos fields (present when distro === 'talos')
  talosVersion?: string
  kubernetesVersion?: string
  schematicId?: string
  // k3s fields (present when distro === 'k3s'); join tokens are NOT sent,
  // the backend generates them.
  k3sVersion?: string
  osImageUrl?: string
  osImageChecksum?: string
  snippetDatastore?: string
  // rke2 fields (present when distro === 'rke2'); reuses osImageUrl/
  // osImageChecksum/snippetDatastore. Join tokens are NOT sent.
  rke2Version?: string
  // kubeadm fields (present when distro === 'kubeadm'); reuses osImageUrl/
  // osImageChecksum/snippetDatastore. The control-plane VIP is a dedicated
  // free IP in the node subnet (kube-vip HA endpoint). Join/cert secrets are
  // NOT sent: the orchestrator mints them per run.
  kubeadmVersion?: string
  cni?: string
  controlPlaneVip?: string
  // Pod and service ranges; empty means the distribution's own default. The
  // orchestrator refuses ranges that overlap each other or the node network.
  podCIDR?: string
  serviceCIDR?: string
  controlPlane: ProvisionNodeSpec[]
  workers: ProvisionNodeSpec[]
  cpCores: number
  cpMemory: number
  cpDisk: number
  workerCores: number
  workerMemory: number
  workerDisk: number
}

export interface RunStatus {
  id: string
  status: string
  phase: string
  progress: number
  // Present on backends that speak the multi-distro contract.
  distro?: string
  // What the run was started with; the cluster is registered under them.
  clusterName?: string
  connectionId?: string
  error?: string
  // The deployed topology (no secret), once the run has completed.
  layout?: WorkerLayout
}

/** The nodes of a deployed cluster and what a new worker gets. */
export interface WorkerLayout {
  controlPlane: ProvisionNodeSpec[]
  workers: ProvisionNodeSpec[]
  gateway: string
  subnetPrefix: number
  controlPlaneVip?: string
  workerCores: number
  workerMemory: number
  workerDisk: number
  /** False for a cluster deployed before its join tokens were kept. */
  changeable: boolean
  /** The release the nodes run, and whether ProxCenter can raise it (k3s, RKE2). */
  version?: string
  upgradable?: boolean
}

export interface ProvisionRunNode {
  name: string
  role: string
  vmid: number
  ip: string
}

export interface RunOutputs {
  kubeconfig: string
  // Only Talos runs produce a talosconfig; k3s returns kubeconfig + nodes.
  talosconfig?: string
  nodes: ProvisionRunNode[]
}

export interface ProvisionLogLine {
  level: string
  message: string
  createdAt: string
}

export async function startProvision(
  req: ProvisionRequest,
  idempotencyKey: string
): Promise<{ ok: boolean; error?: string; value?: { runId: string; status: string } }> {
  try {
    const value = await orchestratorFetch<{ runId: string; status: string }>('/k8s/provision', {
      method: 'POST',
      // The key travels in the body: orchestratorFetch owns the request headers.
      body: { ...req, idempotencyKey },
    })
    return { ok: true, value }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'provisioning request failed' }
  }
}

export async function getProvisionRun(
  runId: string
): Promise<{ ok: boolean; error?: string; value?: { run: RunStatus; outputs?: RunOutputs } }> {
  try {
    const value = await orchestratorFetch<{ run: RunStatus; outputs?: RunOutputs }>(orchestratorPath`/k8s/provision/${runId}`)
    return { ok: true, value }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'provisioning request failed' }
  }
}

export async function getProvisionLogs(
  runId: string,
  limit: number
): Promise<{ ok: boolean; error?: string; value?: { logs: ProvisionLogLine[] } }> {
  try {
    const base = orchestratorPath`/k8s/provision/${runId}/logs`
    const path = limit > 0 ? `${base}?limit=${limit}` : base
    const value = await orchestratorFetch<{ logs: ProvisionLogLine[] }>(path)
    return { ok: true, value }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'provisioning request failed' }
  }
}

export async function destroyProvisionRun(
  runId: string
): Promise<{ ok: boolean; error?: string; value?: { status: string } }> {
  try {
    const value = await orchestratorFetch<{ status: string }>(orchestratorPath`/k8s/provision/${runId}/destroy`, {
      method: 'POST',
    })
    return { ok: true, value }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'provisioning request failed' }
  }
}

/**
 * Raises the Kubernetes version of a completed k3s or RKE2 deployment, node by
 * node, in the background (status "scaling", phase "upgrade").
 */
export async function upgradeCluster(
  runId: string,
  version: string
): Promise<{ ok: boolean; error?: string; value?: { runId: string; status: string } }> {
  try {
    const value = await orchestratorFetch<{ runId: string; status: string }>(orchestratorPath`/k8s/provision/${runId}/upgrade`, {
      method: 'POST',
      body: { version },
    })
    return { ok: true, value }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'provisioning request failed' }
  }
}

/**
 * Replaces the worker list of a completed deployment; the orchestrator
 * creates the added workers and destroys the removed ones in the background
 * (status "scaling", back to "completed" when done).
 */
export async function changeWorkers(
  runId: string,
  workers: ProvisionNodeSpec[]
): Promise<{ ok: boolean; error?: string; value?: { runId: string; status: string } }> {
  try {
    const value = await orchestratorFetch<{ runId: string; status: string }>(orchestratorPath`/k8s/provision/${runId}/workers`, {
      method: 'POST',
      body: { workers },
    })
    return { ok: true, value }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'provisioning request failed' }
  }
}
