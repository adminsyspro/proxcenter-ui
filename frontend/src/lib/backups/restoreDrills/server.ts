// src/lib/backups/restoreDrills/server.ts
//
// Server-side preparation of a restore drill shared by the preflight and the
// create routes, and of a drill schedule: body validation, RBAC on the target
// node and the PBS, the VM-only rule, then the PBS storage (and archive)
// resolution on the target cluster.

import { NextResponse } from 'next/server'

import { getConnectionByIdOrNull } from '@/lib/connections/getConnection'
import { prisma } from '@/lib/db/prisma'
import { pveFetch } from '@/lib/proxmox/client'
import { PERMISSIONS, buildNodeResourceId, checkPermission, checkPermissions } from '@/lib/rbac'

import { CT_NOT_SUPPORTED, NO_MATCHING_STORAGE, parseDrillInput, pickPbsStorage, toDrillRequest, type DrillInput } from './request'
import { parseScheduleBody, toScheduleInput, type ScheduleBody } from './schedules'
import type { DrillRequest, ScheduleInput } from './types'

export type PreparedDrill =
  | { response: Response; request?: undefined; input?: undefined }
  | { response: null; request: DrillRequest; input: DrillInput }

function fail(status: number, error: string): { response: Response } {
  return { response: NextResponse.json({ error }, { status }) }
}

export type ResolvedPbsStorage =
  | { response: Response; pbsName?: undefined; pbsStorage?: undefined }
  | { response: null; pbsName: string; pbsStorage: string }

/**
 * The `pbs` storage of the target cluster that reaches this PBS datastore and
 * namespace from the target node, the way a whole-guest restore resolves it.
 * Shared by a manual drill and a schedule.
 */
export async function resolvePbsStorage(match: {
  pbsId: string
  datastore: string
  namespace: string
  connectionId: string
  node: string
}): Promise<ResolvedPbsStorage> {
  const pbs = await prisma.connection.findUnique({
    where: { id: match.pbsId },
    select: { name: true, baseUrl: true, type: true },
  })
  if (pbs?.type !== 'pbs' || !pbs.baseUrl) return fail(404, 'PBS connection not found')

  const conn = await getConnectionByIdOrNull(match.connectionId)
  if (!conn) return fail(404, 'Target connection not found')

  let storages: unknown
  try {
    storages = await pveFetch<unknown>(conn, '/storage', {}, { timeoutMs: 10_000 })
  } catch (e: any) {
    return fail(502, `Unable to read the storage configuration of the target cluster: ${e?.message || e}`)
  }

  const pbsStorage = pickPbsStorage(storages, {
    baseUrl: pbs.baseUrl,
    datastore: match.datastore,
    namespace: match.namespace,
    node: match.node,
  })
  if (!pbsStorage) return fail(409, NO_MATCHING_STORAGE)

  return { response: null, pbsName: pbs.name || match.pbsId, pbsStorage }
}

/** The same rights as a drill: VM_BACKUP and BACKUP_RESTORE on the target node, BACKUP_VIEW on the PBS. */
/** The rights a drill or a schedule needs on its target node and its PBS. */
export async function drillTargetDenied(connectionId: string, node: string, pbsId: string): Promise<Response | null> {
  const nodeDenied = await checkPermissions(
    [PERMISSIONS.VM_BACKUP, PERMISSIONS.BACKUP_RESTORE],
    'node',
    buildNodeResourceId(connectionId, node),
  )
  if (nodeDenied) return nodeDenied
  return checkPermission(PERMISSIONS.BACKUP_VIEW, 'pbs', pbsId)
}

export type PreparedSchedule =
  | { response: Response; input?: undefined; body?: undefined }
  | { response: null; input: ScheduleInput; body: ScheduleBody }

/** Create or update of a schedule: validation, RBAC, PBS storage resolution, `created_by`. */
export async function prepareScheduleInput(raw: unknown, createdBy: string): Promise<PreparedSchedule> {
  const parsed = parseScheduleBody(raw)
  if (parsed.ok === false) return fail(400, parsed.error)
  const body = parsed.value

  const denied = await drillTargetDenied(body.connection_id, body.node, body.source.pbs_id)
  if (denied) return { response: denied }

  const resolved = await resolvePbsStorage({
    pbsId: body.source.pbs_id,
    datastore: body.source.datastore,
    namespace: body.source.namespace,
    connectionId: body.connection_id,
    node: body.node,
  })
  if (resolved.response) return { response: resolved.response }

  return {
    response: null,
    body,
    input: toScheduleInput(body, { pbsName: resolved.pbsName, pbsStorage: resolved.pbsStorage, createdBy }),
  }
}

export async function prepareDrillRequest(body: unknown, requestedBy: string): Promise<PreparedDrill> {
  const parsed = parseDrillInput(body)
  if (parsed.ok === false) return fail(400, parsed.error)
  const input = parsed.value

  // Same rights as a whole-guest restore on the target node, plus reading the
  // backups of the source PBS.
  const denied = await drillTargetDenied(input.targetConnectionId, input.targetNode, input.pbsId)
  if (denied) return { response: denied }

  if (input.backupType !== 'vm') {
    const error = input.backupType === 'ct' ? CT_NOT_SUPPORTED : `guest type ${input.backupType} is not supported by restore drills yet`
    return fail(422, error)
  }

  const resolved = await resolvePbsStorage({
    pbsId: input.pbsId,
    datastore: input.datastore,
    namespace: input.namespace,
    connectionId: input.targetConnectionId,
    node: input.targetNode,
  })
  if (resolved.response) return { response: resolved.response }
  const { pbsName, pbsStorage } = resolved

  return {
    response: null,
    input,
    request: toDrillRequest(input, { pbsName, pbsStorage, requestedBy }),
  }
}
