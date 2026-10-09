// src/app/api/v1/guest-file-restore/jobs/route.ts
//
// GET lists the restore jobs of the tenant (optionally one guest); POST
// creates one and starts it after the response. Everything that needs the
// request (session, RBAC, tenant scope, connection records) is resolved
// here and handed to the runner; the SSH credentials travel in memory only.
// An SSH job needs the host key fingerprint confirmed after the probe, and
// its host must be one of the guest's own addresses (super admins excepted).

import { NextResponse, after } from 'next/server'
import type { Prisma } from '@prisma/client'

import { audit } from '@/lib/audit'
import { getConnectionByIdOrNull } from '@/lib/connections/getConnection'
import { authorizeRestoreTarget, isProviderCaller, requireGuestFileRestoreUser } from '@/lib/guestFileRestore/guard'
import { assertSshHostAllowed } from '@/lib/guestFileRestore/guestAddresses'
import { knownBytesTotal, runGuestFileRestoreJob, type RunContext } from '@/lib/guestFileRestore/runner'
import { createJobRequestSchema, listJobsQuerySchema, validationError } from '@/lib/guestFileRestore/schemas'
import { loadGuestFileRestoreSettings } from '@/lib/guestFileRestore/settings'
import { resolveGuestRestoreSource, sourceLabel } from '@/lib/guestFileRestore/sources'
import { purgeExpiredJobs, reconcileStaleJobs, toJobDto } from '@/lib/guestFileRestore/store'
import { pveFetch } from '@/lib/proxmox/client'
import { PERMISSIONS, checkPermission } from '@/lib/rbac'
import { getCurrentTenantId, getSessionPrisma } from '@/lib/tenant'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const guard = await requireGuestFileRestoreUser()
  if (guard.denied) return guard.denied

  const url = new URL(request.url)
  const parsed = listJobsQuerySchema.safeParse({
    connId: url.searchParams.get('connId') ?? undefined,
    vmid: url.searchParams.get('vmid') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
  })
  if (!parsed.success) return validationError(parsed.error, 'Invalid query')
  const { connId, vmid, limit } = parsed.data

  const denied = connId
    ? await checkPermission(PERMISSIONS.BACKUP_VIEW, 'connection', connId)
    : await checkPermission(PERMISSIONS.BACKUP_VIEW)
  if (denied) return denied

  try {
    const settings = await loadGuestFileRestoreSettings()
    const tenantId = await getCurrentTenantId()
    await purgeExpiredJobs(tenantId, settings.jobRetentionDays).catch(() => 0)

    const db = await getSessionPrisma()
    const rows = await db.guestFileRestoreJob.findMany({
      where: {
        ...(connId ? { connectionId: connId } : {}),
        ...(vmid !== undefined ? { vmid } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })
    const reconciled = await reconcileStaleJobs(rows)
    return NextResponse.json({ data: reconciled.map(toJobDto) })
  } catch (error: any) {
    console.error('Erreur GET guest-file-restore/jobs:', error)
    return NextResponse.json({ error: error?.message || 'Erreur serveur' }, { status: 500 })
  }
}

/** Name of the guest as PVE knows it, best effort (never blocks the job). */
async function lookupGuestName(conn: NonNullable<Awaited<ReturnType<typeof getConnectionByIdOrNull>>>, target: { node: string; type: string; vmid: number }): Promise<string | null> {
  try {
    const config = await pveFetch<any>(
      conn,
      `/nodes/${encodeURIComponent(target.node)}/${target.type}/${target.vmid}/config`,
      {},
      { timeoutMs: 10_000 },
    )
    const name = target.type === 'lxc' ? config?.hostname : config?.name
    return typeof name === 'string' && name ? name : null
  } catch {
    return null
  }
}

export async function POST(request: Request) {
  const guard = await requireGuestFileRestoreUser()
  if (guard.denied) return guard.denied

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const parsed = createJobRequestSchema.safeParse(body)
  if (!parsed.success) return validationError(parsed.error)
  const { source, items, target, method, destination, ssh } = parsed.data

  try {
    const settings = await loadGuestFileRestoreSettings()
    if (method === 'agent') {
      if (!settings.agentEnabled) {
        return NextResponse.json({ error: 'The guest agent method is disabled in the settings' }, { status: 403 })
      }
      if (target.type !== 'qemu') {
        return NextResponse.json({ error: 'The guest agent method is only available for virtual machines' }, { status: 400 })
      }
    } else {
      if (!settings.sshEnabled) {
        return NextResponse.json({ error: 'The SSH method is disabled in the settings' }, { status: 403 })
      }
      if (!ssh) return NextResponse.json({ error: 'SSH credentials are required' }, { status: 400 })
    }

    const denied = await authorizeRestoreTarget(target)
    if (denied) return denied

    const resolved = await resolveGuestRestoreSource(source)
    if (resolved instanceof Response) return resolved

    const conn = await getConnectionByIdOrNull(target.connId)
    if (!conn) return NextResponse.json({ error: 'Connection not found' }, { status: 404 })

    const providerCaller = await isProviderCaller(guard.principal)
    if (method === 'ssh' && ssh) {
      const hostDenied = await assertSshHostAllowed({ conn, target, host: ssh.host, principal: guard.principal, providerCaller })
      if (hostDenied) return hostDenied
    }

    const guestName = await lookupGuestName(conn, target)
    const conflict = parsed.data.conflict ?? settings.defaultConflict
    // Directories have no size until the runner walks them (agent method).
    const bytesTotal = knownBytesTotal(items)
    const cleanDestination = { ...destination, path: destination.path?.trim() || undefined }

    const db = await getSessionPrisma()
    const row = await db.guestFileRestoreJob.create({
      data: {
        connectionId: target.connId,
        node: target.node,
        vmid: target.vmid,
        guestType: target.type,
        guestName,
        source: source as unknown as Prisma.InputJsonValue,
        items: items as unknown as Prisma.InputJsonValue,
        method,
        destination: cleanDestination as unknown as Prisma.InputJsonValue,
        conflict,
        status: 'queued',
        bytesTotal: bytesTotal === null ? null : BigInt(bytesTotal),
        createdById: guard.principal.userId ?? null,
        createdByEmail: guard.principal.userEmail ?? null,
      },
    })

    await audit({
      action: 'restore',
      category: 'backups',
      resourceType: 'guest_file_restore_job',
      resourceId: row.id,
      resourceName: guestName || `${target.type}/${target.vmid}`,
      details: {
        operation: 'restore_files_to_guest',
        phase: 'start',
        source: sourceLabel(source),
        target: { connId: target.connId, node: target.node, type: target.type, vmid: target.vmid },
        method,
        items: items.length,
        destination: cleanDestination,
        conflict,
      },
    })

    const ctx: RunContext = {
      source: resolved,
      sourceSpec: source,
      target: { conn, node: target.node, vmid: target.vmid, type: target.type },
      items,
      method,
      destination: cleanDestination,
      conflict,
      settings,
      ssh,
      opaqueConnectErrors: !providerCaller,
    }
    after(() => runGuestFileRestoreJob(row.id, ctx))

    return NextResponse.json({ data: { id: row.id } }, { status: 202 })
  } catch (error: any) {
    console.error('Erreur POST guest-file-restore/jobs:', error)
    return NextResponse.json({ error: error?.message || 'Erreur serveur' }, { status: 500 })
  }
}
