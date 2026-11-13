import { NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"

import { prisma } from "@/lib/db/prisma"
import { getCurrentTenantId, getSessionPrisma } from "@/lib/tenant"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { parseNetworkMap } from "@/lib/migration/target-overrides"
import { withAudit } from "@/lib/audit/withAudit"

export const runtime = "nodejs"

/** Connection ids as Prisma generates them. */
const CONN_ID_RE = /^[a-z0-9]{8,40}$/

/** Settings key of the table saved for one source/target pair. */
function networkMapKey(sourceConnectionId: string, targetConnectionId: string): string {
  return `migration.networkMap:${sourceConnectionId}:${targetConnectionId}`
}

function pair(sourceConnectionId: unknown, targetConnectionId: unknown): { source: string; target: string } | null {
  if (typeof sourceConnectionId !== "string" || typeof targetConnectionId !== "string") return null
  if (!CONN_ID_RE.test(sourceConnectionId) || !CONN_ID_RE.test(targetConnectionId)) return null
  return { source: sourceConnectionId, target: targetConnectionId }
}

/** The refusal when the caller lacks vm.migrate on either end of the pair, or null. */
async function denyOnPair(p: { source: string; target: string }): Promise<Response | null> {
  const denials = await Promise.all([p.source, p.target].map(id => checkPermission(PERMISSIONS.VM_MIGRATE, "connection", id)))
  return denials.find(Boolean) ?? null
}

/**
 * GET /api/v1/migrations/network-maps?sourceConnectionId=&targetConnectionId=
 * The network table saved for a source/target pair (ui#1333), or an empty
 * one. Saved per tenant: a tenant never reads the provider's table.
 */
export async function GET(req: Request) {
  const denied = await checkPermission(PERMISSIONS.VM_MIGRATE)
  if (denied) return denied
  const url = new URL(req.url)
  const p = pair(url.searchParams.get("sourceConnectionId"), url.searchParams.get("targetConnectionId"))
  if (!p) return NextResponse.json({ error: "sourceConnectionId and targetConnectionId are required" }, { status: 400 })
  // Same rights as saving it: vm.migrate on both ends.
  const deniedMigrate = await denyOnPair(p)
  if (deniedMigrate) return deniedMigrate
  const tenantId = await getCurrentTenantId()
  const row = await prisma.setting.findUnique({ where: { key_tenantId: { key: networkMapKey(p.source, p.target), tenantId } } })
  // Read back through the parser: a row written by an older version that no
  // longer passes is dropped rather than handed to the dialog.
  const parsed = parseNetworkMap(row?.value)
  return NextResponse.json({ data: { networkMap: parsed.ok ? parsed.value ?? [] : [] } })
}

/**
 * PUT /api/v1/migrations/network-maps
 * Body `{ sourceConnectionId, targetConnectionId, networkMap }`: save the
 * table for that pair, both connections in the caller's scope. An empty
 * table deletes the saved one.
 */
async function handlePut(req: Request) {
  const denied = await checkPermission(PERMISSIONS.VM_MIGRATE)
  if (denied) return denied
  const body = await req.json().catch(() => null)
  const p = pair(body?.sourceConnectionId, body?.targetConnectionId)
  if (!p) return NextResponse.json({ error: "sourceConnectionId and targetConnectionId are required" }, { status: 400 })
  const parsed = parseNetworkMap(body?.networkMap ?? [])
  if (parsed.ok === false) return NextResponse.json({ error: parsed.error }, { status: 400 })

  // Both ends must be connections the caller sees, of the right kinds.
  const scoped = await getSessionPrisma()
  const [source, target] = await Promise.all([
    scoped.connection.findUnique({ where: { id: p.source }, select: { type: true } }),
    scoped.connection.findUnique({ where: { id: p.target }, select: { type: true } }),
  ])
  if (source?.type !== "vmware" || target?.type !== "pve") {
    return NextResponse.json({ error: "Source VMware connection or target Proxmox connection not found" }, { status: 404 })
  }
  const deniedMigrate = await denyOnPair(p)
  if (deniedMigrate) return deniedMigrate

  const tenantId = await getCurrentTenantId()
  const key = networkMapKey(p.source, p.target)
  if (!parsed.value) {
    await prisma.setting.deleteMany({ where: { key, tenantId } })
    return NextResponse.json({ data: { networkMap: [] } })
  }
  const value = parsed.value as unknown as Prisma.InputJsonValue
  await prisma.setting.upsert({
    where: { key_tenantId: { key, tenantId } },
    update: { value, updatedAt: new Date() },
    create: { key, tenantId, value },
  })
  return NextResponse.json({ data: { networkMap: parsed.value } })
}

export const PUT = withAudit({ category: "migration", resourceType: "network_map" }, handlePut)
