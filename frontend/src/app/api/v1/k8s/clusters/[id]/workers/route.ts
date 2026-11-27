export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
import { PERMISSIONS } from '@/lib/rbac'
import { requireK8sPermission } from '@/lib/k8s/requireK8sPermission'
import { requireK8sProvision } from '@/lib/k8s/requireK8sProvision'
import { requireProvisionTarget } from '@/lib/k8s/provisionAccess'
import { resolveStrictTenant } from '@/lib/k8s/strictTenant'
import { getClusterWithCredential, syncNodeMapping } from '@/lib/k8s/repository'
import { getProvisionRun, changeWorkers, type RunStatus, type WorkerLayout } from '@/lib/k8s/provisionOrchestrator'
import { orchestratorFailure, failureBody } from '@/lib/k8s/provision/orchestratorStatus'
import { nodeCordonState, removeNodeObject } from '@/lib/k8s/orchestrator'
import { checkNodeVms } from '@/lib/k8s/server/destroyClusterNodes'
import { planWorkers } from '@/lib/k8s/workers'
import { audit } from '@/lib/audit'
import { withAudit } from '@/lib/audit/withAudit'

type Ctx = { params: Promise<{ id: string }> }

type Deployed = NonNullable<Awaited<ReturnType<typeof getClusterWithCredential>>> & { runId: string; connectionId: string }

/** The cluster, when ProxCenter deployed it (its run and its connection known). */
async function deployedCluster(tenantId: string, id: string): Promise<Deployed | Response> {
  const found = await getClusterWithCredential(tenantId, id)
  if (!found) return NextResponse.json({ error: 'Cluster not found' }, { status: 404 })
  const runId = found.row.provisioningRunId
  const connectionId = found.row.proxmoxConnectionId
  if (found.row.source !== 'deployed' || !runId || !connectionId) {
    return NextResponse.json({ error: 'not_deployed' }, { status: 404 })
  }
  return { ...found, runId, connectionId }
}

/** The run of a deployed cluster: where a worker change stands, and the layout. */
export async function GET(_req: Request, ctx: Ctx) {
  const denied = await requireK8sPermission(PERMISSIONS.K8S_VIEW); if (denied) return denied
  const tenant = await resolveStrictTenant(); if (!tenant.ok) return tenant.response
  const { id } = await ctx.params
  const cluster = await deployedCluster(tenant.tenantId, id)
  if (cluster instanceof Response) return cluster

  const r = await getProvisionRun(cluster.runId)
  if (!r.ok) {
    const failure = orchestratorFailure(r.error)
    return NextResponse.json(failureBody(failure), { status: failure.status })
  }
  const { run, outputs } = r.value!
  // Once a change has landed, the node mapping follows the deployed nodes
  // (a later deletion destroys exactly the VMs that exist), and the node
  // objects of removed workers go: their VM is destroyed, so their kubelet
  // can no longer bring them back.
  if (run.status === 'completed' && outputs?.nodes?.length) {
    const gone = await syncNodeMapping(id, outputs.nodes.map(n => ({ name: n.name, vmid: n.vmid, connectionId: cluster.connectionId })))
    for (const nodeName of gone) {
      const removed = await removeNodeObject({ clusterId: id, credentialVersion: cluster.row.credentialVersion, cred: cluster.credential, nodeName })
      await audit({ action: 'delete', category: 'k8s', resourceType: 'kubernetesNode', resourceId: `${id}/${nodeName}`, resourceName: nodeName, status: removed.ok ? 'success' : 'failure', details: { reason: 'worker removed', error: removed.error } })
    }
  }
  return NextResponse.json({
    status: run.status,
    phase: run.phase,
    progress: run.progress,
    error: run.error ?? null,
    layout: run.layout ?? null,
  })
}

function readAdditions(raw: unknown): { ip: string; vmid: number }[] | null {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) return null
  const out: { ip: string; vmid: number }[] = []
  for (const a of raw) {
    if (typeof a?.ip !== 'string' || !/^\d{1,3}(\.\d{1,3}){3}$/.test(a.ip)) return null
    if (!Number.isInteger(a?.vmid) || a.vmid < 100 || a.vmid > 999_999_999) return null
    out.push({ ip: a.ip, vmid: a.vmid })
  }
  return out
}

function readRemovals(raw: unknown): string[] | null {
  if (raw === undefined) return []
  if (!Array.isArray(raw) || raw.some(n => typeof n !== 'string' || n.length === 0 || n.length > 253)) return null
  return [...new Set(raw as string[])]
}

/** The completed run of the cluster, when its workers can change now. */
async function changeableRun(runId: string): Promise<(RunStatus & { layout: WorkerLayout }) | Response> {
  const r = await getProvisionRun(runId)
  if (!r.ok) {
    const failure = orchestratorFailure(r.error)
    return NextResponse.json(failureBody(failure), { status: failure.status })
  }
  const { run } = r.value!
  if (run.status !== 'completed' || !run.layout) return NextResponse.json({ error: 'run_not_changeable' }, { status: 409 })
  if (!run.layout.changeable) return NextResponse.json({ error: 'workers_not_changeable' }, { status: 409 })
  return { ...run, layout: run.layout }
}

/** vm.create to add workers, vm.delete to remove some, on the cluster's connection. */
async function requireVmRights(tenantId: string, connectionId: string, adding: boolean, removing: boolean): Promise<Response | null> {
  if (adding) {
    const target = await requireProvisionTarget(tenantId, connectionId, 'create'); if (target) return target
  }
  if (removing) return requireProvisionTarget(tenantId, connectionId, 'delete')
  return null
}

/**
 * Why the workers to remove cannot go, or null. OpenTofu destroys by VMID, so
 * each VM must still be the worker deployed; and the node must be cordoned
 * (drained by the interface first): a worker still taking pods is refused
 * rather than cut off with them.
 */
async function removalRefusal(id: string, tenantId: string, cluster: Deployed, workers: { name: string; vmid: number }[], remove: string[], clusterName: string): Promise<Response | null> {
  const vmid = new Map(workers.map(w => [w.name, w.vmid]))
  const checks = await checkNodeVms(tenantId, remove.map(nodeName => ({ nodeName, connectionId: cluster.connectionId, vmid: vmid.get(nodeName)! })), clusterName)
  const refusals = checks.filter(c => c.refusal !== null)
  if (refusals.length > 0) {
    await audit({ action: 'workers', category: 'k8s', resourceType: 'kubernetesCluster', resourceId: id, resourceName: cluster.row.name, status: 'failure', details: { removed: remove, refusals } })
    return NextResponse.json({ error: 'vm_not_node', results: refusals }, { status: 409 })
  }
  const states = await Promise.all(remove.map(nodeName => nodeCordonState({ clusterId: id, credentialVersion: cluster.row.credentialVersion, cred: cluster.credential, nodeName })))
  const unreadable = states.findIndex(s => !s.ok)
  if (unreadable >= 0) return NextResponse.json({ error: states[unreadable].error, node: remove[unreadable] }, { status: 502 })
  const notCordoned = states.findIndex(s => s.value!.exists && !s.value!.cordoned)
  if (notCordoned >= 0) return NextResponse.json({ error: 'not_cordoned', node: remove[notCordoned] }, { status: 409 })
  return null
}

/**
 * Adds workers ({ add: [{ ip, vmid }] }) or removes them ({ remove: [name] }).
 * A removed worker must be cordoned (drained by the caller); the orchestrator
 * destroys its VM, and its node object goes once that is done (GET).
 */
async function handlePost(req: Request, ctx: Ctx) {
  const refused = await requireK8sProvision(); if (refused) return refused
  const tenant = await resolveStrictTenant(); if (!tenant.ok) return tenant.response
  const { id } = await ctx.params
  const cluster = await deployedCluster(tenant.tenantId, id)
  if (cluster instanceof Response) return cluster

  const body = await req.json().catch(() => null)
  const add = readAdditions(body?.add)
  const remove = readRemovals(body?.remove)
  if (!add || !remove) return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  const rights = await requireVmRights(tenant.tenantId, cluster.connectionId, add.length > 0, remove.length > 0)
  if (rights) return rights

  const run = await changeableRun(cluster.runId)
  if (run instanceof Response) return run

  const clusterName = run.clusterName || cluster.row.name
  const plan = planWorkers(clusterName, run.layout, add, remove)
  if (!plan.ok) return NextResponse.json({ error: plan.error }, { status: 400 })
  if (remove.length > 0) {
    const removal = await removalRefusal(id, tenant.tenantId, cluster, run.layout.workers, remove, clusterName)
    if (removal) return removal
  }

  const changed = await changeWorkers(cluster.runId, plan.workers)
  const details = { added: plan.added.map(w => w.name), removed: remove }
  const failure = changed.ok ? null : orchestratorFailure(changed.error)
  await audit({ action: 'workers', category: 'k8s', resourceType: 'kubernetesCluster', resourceId: id, resourceName: cluster.row.name, status: failure ? 'failure' : 'success', details: failure ? { ...details, error: failure.code } : details })
  if (failure) return NextResponse.json(failureBody(failure), { status: failure.status })
  return NextResponse.json({ status: changed.value!.status, added: plan.added }, { status: 202 })
}

export const POST = withAudit({ category: 'k8s', action: 'workers', resourceType: 'kubernetesCluster', resourceParam: 'id' }, handlePost)
