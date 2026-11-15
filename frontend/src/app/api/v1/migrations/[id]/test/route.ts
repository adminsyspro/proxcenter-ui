import { NextResponse } from "next/server"

import { getCurrentTenantId, getSessionPrisma } from "@/lib/tenant"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { migrateScope, migrationNicPermissions, scopedJobWhere } from "@/lib/migration/authorize"
import { getConnectionById } from "@/lib/connections/getConnection"
import { pveFetch } from "@/lib/proxmox/client"
import { requestWarmTest, requestWarmTestStop } from "@/lib/migration/warm/job-control"
import {
  canStartMigrationTest, isTestActive, MIGRATION_TEST_MAX_SEC_CHOICES, MIGRATION_TEST_MAX_SEC_DEFAULT, parseTestRequest, readTestState,
} from "@/lib/migration/warm/migration-test-state"
import { withAudit } from "@/lib/audit/withAudit"

export const runtime = "nodejs"

type Params = { params: Promise<{ id: string }> }

/** Storage types a test overlay (a qcow2 file) can live on. */
const FILE_STORAGE_TYPES = new Set(["dir", "nfs", "cifs", "glusterfs", "btrfs", "cephfs"])

/** The job, for a caller allowed to migrate between its two ends; a Response otherwise. */
async function loadJob(id: string) {
  const denied = await checkPermission(PERMISSIONS.VM_MIGRATE)
  if (denied) return { denied }
  const prisma = await getSessionPrisma()
  const job = await prisma.migrationJob.findFirst({ where: scopedJobWhere({ id }, await migrateScope()) })
  if (!job) return { denied: NextResponse.json({ error: "Migration job not found" }, { status: 404 }) }
  return { prisma, job }
}

interface NodeOptions {
  storages: { id: string; type: string; availBytes: number }[]
  bridges: string[]
  nodeAvailableMemoryMB: number | null
}

/** What the target node offers a test: file storages holding VM disks, bridges, free RAM. Three reads, no task. */
async function nodeOptions(job: { targetConnectionId: string; targetNode: string }): Promise<NodeOptions> {
  const empty: NodeOptions = { storages: [], bridges: [], nodeAvailableMemoryMB: null }
  try {
    const conn = await getConnectionById(job.targetConnectionId)
    const node = encodeURIComponent(job.targetNode)
    const [storages, bridges, status] = await Promise.all([
      pveFetch<any[]>(conn as any, `/nodes/${node}/storage?content=images&enabled=1`).catch(() => []),
      pveFetch<any[]>(conn as any, `/nodes/${node}/network?type=any_bridge`).catch(() => []),
      pveFetch<any>(conn as any, `/nodes/${node}/status`).catch(() => null),
    ])
    const mem = Number(status?.memory?.available ?? status?.memory?.free)
    return {
      storages: (storages ?? [])
        .filter(s => FILE_STORAGE_TYPES.has(String(s?.type)))
        .map(s => ({ id: String(s.storage), type: String(s.type), availBytes: Number(s.avail) || 0 })),
      bridges: (bridges ?? []).map(b => String(b?.iface || "")).filter(Boolean).sort((a, b) => a.localeCompare(b)),
      nodeAvailableMemoryMB: Number.isFinite(mem) && mem > 0 ? Math.floor(mem / 1048576) : null,
    }
  } catch {
    return empty
  }
}

/**
 * GET /api/v1/migrations/[id]/test
 * The test of a waiting warm migration: its state, and what the target node
 * offers to run one (file storages for the overlays, bridges, free RAM).
 */
export async function GET(_req: Request, { params }: Params) {
  try {
    const { id } = await params
    const found = await loadJob(id)
    if (found.denied) return found.denied
    const { job } = found
    return NextResponse.json({
      data: {
        state: readTestState(job.testState),
        ...(await nodeOptions(job)),
        maxSecChoices: [...MIGRATION_TEST_MAX_SEC_CHOICES],
        maxSecDefault: MIGRATION_TEST_MAX_SEC_DEFAULT,
      },
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

/**
 * POST /api/v1/migrations/[id]/test
 * `{ storage, bridge, vlanTag, maxSec }`: boot a test VM on the copy of a
 * migration that waits for its manual cutover. The row is the signal, as for
 * the cutover (lib/migration/operator-signals): the engine takes it between
 * two syncs.
 */
async function handlePost(req: Request, { params }: Params) {
  try {
    const { id } = await params
    const found = await loadJob(id)
    if (found.denied) return found.denied
    const { prisma, job } = found
    const parsed = parseTestRequest(await req.json().catch(() => null))
    if (parsed.ok === false) return NextResponse.json({ error: parsed.error }, { status: 400 })
    if (isTestActive(job)) return NextResponse.json({ error: "A test is already running for this migration" }, { status: 409 })
    if (!canStartMigrationTest(job as any)) return NextResponse.json({ error: "A test can only start while a manual cutover migration waits" }, { status: 400 })
    const request = parsed.request
    // Only what the node offers reaches its shell (pvesm path, qemu-img).
    const offered = await nodeOptions(job)
    if (!offered.storages.some(s => s.id === request.storage)) {
      return NextResponse.json({ error: `"${request.storage}" is not a file storage holding VM disks on ${job.targetNode}` }, { status: 400 })
    }
    if (request.bridge && !offered.bridges.includes(request.bridge)) {
      return NextResponse.json({ error: `Bridge "${request.bridge}" does not exist on ${job.targetNode}` }, { status: 400 })
    }
    // The test VM's NICs need the rights a migration's NICs need (a VLAN
    // tag: vm.config.nic.vlan for a tenant user), as the creation route asks.
    if (request.bridge) {
      const needs = migrationNicPermissions({
        tenantId: await getCurrentTenantId(), targetConnectionId: job.targetConnectionId, targetNode: job.targetNode,
        networkBridge: request.bridge, vlanTag: request.vlanTag ?? undefined, nics: [],
      })
      for (const need of needs) {
        const denied = await checkPermission(need.permission, need.resourceType, need.resourceId)
        if (denied) return denied
      }
    }
    await prisma.migrationJob.update({
      where: { id },
      data: { testRequest: request as any, testStopRequestedAt: null, testState: { phase: "requested", storage: request.storage } },
    })
    requestWarmTest(id)
    return NextResponse.json({ data: { status: "test_requested" } })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

/** DELETE /api/v1/migrations/[id]/test: stop the running test; the engine removes the test VM and resumes the syncs. */
async function handleDelete(_req: Request, { params }: Params) {
  try {
    const { id } = await params
    const found = await loadJob(id)
    if (found.denied) return found.denied
    const { prisma, job } = found
    if (!isTestActive(job)) return NextResponse.json({ error: "No test is running for this migration" }, { status: 409 })
    await prisma.migrationJob.update({ where: { id }, data: { testStopRequestedAt: new Date() } })
    requestWarmTestStop(id)
    return NextResponse.json({ data: { status: "test_stop_requested" } })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

export const POST = withAudit({ category: "migration", resourceType: "migration", resourceParam: "id", action: "run" }, handlePost)
export const DELETE = withAudit({ category: "migration", resourceType: "migration", resourceParam: "id", action: "update" }, handleDelete)
