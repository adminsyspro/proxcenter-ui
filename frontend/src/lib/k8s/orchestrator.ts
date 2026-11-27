import type { SanitizedCredential, ClusterHealth, ListResourcesResult, GetResourceResult, EventsResult, PodLogsResult, NodeMetricsResult, PodMetricsResult } from './types'
import { getClusterHealth } from './server/health'
import { invalidateClusterClients, type BuildKubeClientInput } from './server/client'
import { listResources as _listResources } from './server/resources'
import { getResourceDetail } from './server/getResource'
import { listEvents as _listEvents } from './server/events'
import { getPodLogs } from './server/logs'
import { getNodeMetrics, getPodMetrics } from './server/metrics'
import {
  restartWorkload as _restartWorkload, scaleWorkload as _scaleWorkload,
  listDeploymentRevisions as _listDeploymentRevisions, rollbackDeployment as _rollbackDeployment,
  deletePod as _deletePod,
  type RestartableKind, type ScalableKind, type DeploymentRevision,
} from './server/workloadOps'
import { readClusterHistory, type TimelineEntry } from './server/timeline'
import { setNodeCordon as _setNodeCordon, drainNode as _drainNode, readNodeCordon as _readNodeCordon, deleteNodeObject as _deleteNodeObject } from './server/nodeOps'
import type { DrainResult } from './nodeDrain'

// ── Health / connectivity (served locally by the TS k8s client) ─────────────

function sanitizedToHealthInput(
  clusterId: string,
  credentialVersion: number,
  cred: SanitizedCredential,
  skipCache?: boolean,
) {
  return {
    clusterId,
    credentialVersion,
    server: cred.apiServerUrl,
    cred: {
      type: cred.credentialType as 'token' | 'client_cert',
      value: cred.credential,
    },
    caData: cred.caDataPem,
    serverName: cred.tlsServerName,
    insecure: cred.insecureSkipTlsVerify,
    skipCache,
  }
}

export async function checkConnectivity(cred: SanitizedCredential): Promise<{ ok: boolean; error?: string; value?: ClusterHealth }> {
  // Pre-save connectivity check: no cluster ID yet. skipCache prevents two
  // concurrent validations from colliding on the shared '_validate:0' cache key.
  const r = await getClusterHealth(sanitizedToHealthInput('_validate', 0, cred, true))
  if (r.ok) return { ok: true, value: r.value }
  return { ok: false, error: r.errorCode ?? 'connectivity failed', value: r.value }
}

export async function fetchHealth(args: { clusterId: string; credentialVersion: number; cred: SanitizedCredential }): Promise<{ ok: boolean; error?: string; value?: ClusterHealth }> {
  const r = await getClusterHealth(sanitizedToHealthInput(args.clusterId, args.credentialVersion, args.cred))
  if (r.ok) return { ok: true, value: r.value }
  return { ok: false, error: r.errorCode ?? 'health failed', value: r.value }
}

export async function invalidateClient(clusterId: string): Promise<void> {
  invalidateClusterClients(clusterId)
}

// ── Slice 2a: read-only explorer wrappers (served locally by TS k8s client) ─

type Base = { clusterId: string; credentialVersion: number; cred: SanitizedCredential }

function credToInput(a: Base): BuildKubeClientInput {
  return {
    clusterId: a.clusterId,
    credentialVersion: a.credentialVersion,
    server: a.cred.apiServerUrl,
    cred: { type: a.cred.credentialType, value: a.cred.credential },
    caData: a.cred.caDataPem,
    serverName: a.cred.tlsServerName,
    insecure: a.cred.insecureSkipTlsVerify,
  }
}

export async function listResources(a: Base & { kind: string; namespace?: string }): Promise<{ ok: boolean; error?: string; value?: ListResourcesResult }> {
  const r = await _listResources(credToInput(a), a.kind as any, a.namespace)
  if (!r.ok) return { ok: false, error: r.errorCode ?? 'list failed' }
  return { ok: true, value: r.value as ListResourcesResult }
}

export async function getResource(a: Base & { kind: string; namespace?: string; name: string }): Promise<{ ok: boolean; error?: string; value?: GetResourceResult }> {
  const r = await getResourceDetail(credToInput(a), a.kind as any, a.namespace, a.name)
  if (!r.ok) return { ok: false, error: r.errorCode ?? 'get failed' }
  return { ok: true, value: { detail: r.value ?? null } }
}

export async function listEvents(a: Base & { namespace?: string; involvedUid?: string; involvedName?: string }): Promise<{ ok: boolean; error?: string; value?: EventsResult }> {
  const r = await _listEvents(credToInput(a), { namespace: a.namespace, involvedUid: a.involvedUid, involvedName: a.involvedName })
  if (!r.ok) return { ok: false, error: r.errorCode ?? 'events failed' }
  return { ok: true, value: r.value as EventsResult }
}

export async function fetchPodLogs(a: Base & { namespace: string; pod: string; container?: string; tailLines?: number; previous?: boolean }): Promise<{ ok: boolean; error?: string; value?: PodLogsResult }> {
  const r = await getPodLogs(credToInput(a), a.namespace, a.pod, { container: a.container, tailLines: a.tailLines, previous: a.previous })
  if (!r.ok) return { ok: false, error: r.errorCode ?? 'logs failed' }
  const { logs, truncated, container } = r.value!
  return { ok: true, value: { container, logs, truncated } }
}

// ── Phase 2: node resource utilisation ─────────────────────────────────────

export async function fetchNodeMetrics(a: Base): Promise<{ ok: boolean; error?: string; value?: NodeMetricsResult }> {
  const r = await getNodeMetrics(credToInput(a))
  if (!r.ok) return { ok: false, error: r.errorCode ?? 'metrics failed', value: r.value }
  return { ok: true, value: r.value }
}

export async function fetchPodMetrics(a: Base): Promise<{ ok: boolean; error?: string; value?: PodMetricsResult }> {
  const r = await getPodMetrics(credToInput(a))
  if (!r.ok) return { ok: false, error: r.errorCode ?? 'metrics failed', value: r.value }
  return { ok: true, value: r.value }
}

// ── SP1: node day-2 operations (cordon / drain) ─────────────────────────────

export async function cordonNode(a: Base & { nodeName: string; unschedulable: boolean }): Promise<{ ok: boolean; error?: string; value?: { unschedulable: boolean } }> {
  const r = await _setNodeCordon(credToInput(a), a.nodeName, a.unschedulable)
  if (!r.ok) return { ok: false, error: r.errorCode ?? 'cordon failed' }
  return { ok: true, value: r.value }
}

export async function drainNode(a: Base & { nodeName: string; force?: boolean; dryRun?: boolean }): Promise<{ ok: boolean; error?: string; value?: DrainResult }> {
  const r = await _drainNode(credToInput(a), a.nodeName, { force: !!a.force, dryRun: !!a.dryRun })
  if (!r.ok) return { ok: false, error: r.errorCode ?? 'drain failed' }
  return { ok: true, value: r.value }
}

export async function nodeCordonState(a: Base & { nodeName: string }): Promise<{ ok: boolean; error?: string; value?: { exists: boolean; cordoned: boolean } }> {
  const r = await _readNodeCordon(credToInput(a), a.nodeName)
  if (!r.ok) return { ok: false, error: r.errorCode ?? 'node read failed' }
  return { ok: true, value: r.value }
}

/** Removes the node object of a worker whose VM was destroyed. */
export async function removeNodeObject(a: Base & { nodeName: string }): Promise<{ ok: boolean; error?: string }> {
  const r = await _deleteNodeObject(credToInput(a), a.nodeName)
  return r.ok ? { ok: true } : { ok: false, error: r.errorCode ?? 'node removal failed' }
}

// ── Workload day-2 operations (restart / scale / rollback / pod delete) ──────

type OpOut<T> = Promise<{ ok: boolean; error?: string; value?: T }>

export async function restartWorkload(a: Base & { kind: RestartableKind; namespace: string; name: string }): OpOut<{ restartedAt: string }> {
  const r = await _restartWorkload(credToInput(a), a.kind, a.namespace, a.name)
  return r.ok ? { ok: true, value: r.value } : { ok: false, error: r.errorCode ?? 'restart failed' }
}

export async function scaleWorkload(a: Base & { kind: ScalableKind; namespace: string; name: string; replicas: number }): OpOut<{ replicas: number }> {
  const r = await _scaleWorkload(credToInput(a), a.kind, a.namespace, a.name, a.replicas)
  return r.ok ? { ok: true, value: r.value } : { ok: false, error: r.errorCode ?? 'scale failed' }
}

export async function listDeploymentRevisions(a: Base & { namespace: string; name: string }): OpOut<{ revisions: DeploymentRevision[] }> {
  const r = await _listDeploymentRevisions(credToInput(a), a.namespace, a.name)
  return r.ok ? { ok: true, value: r.value } : { ok: false, error: r.errorCode ?? 'revisions failed' }
}

export async function rollbackDeployment(a: Base & { namespace: string; name: string; revision: number }): OpOut<{ revision: number }> {
  const r = await _rollbackDeployment(credToInput(a), a.namespace, a.name, a.revision)
  return r.ok ? { ok: true, value: r.value } : { ok: false, error: r.errorCode ?? 'rollback failed' }
}

export async function deletePod(a: Base & { namespace: string; name: string }): OpOut<{ deleted: true }> {
  const r = await _deletePod(credToInput(a), a.namespace, a.name)
  return r.ok ? { ok: true, value: r.value } : { ok: false, error: r.errorCode ?? 'delete failed' }
}

export async function readHistory(a: Base & { namespace?: string }): OpOut<{ entries: TimelineEntry[]; partial: boolean }> {
  const r = await readClusterHistory(credToInput(a), a.namespace)
  return r.ok ? { ok: true, value: { entries: r.value ?? [], partial: !!r.partial } } : { ok: false, error: r.errorCode ?? 'history failed' }
}
