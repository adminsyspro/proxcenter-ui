export const dynamic = "force-dynamic"
// src/app/api/v1/firewall/publish/[connectionId]/route.ts
//
// POST: publishes the draft of the Firewalling tab (UA51) in one call. The operations are applied one after the
// other, guarded by the digests of the lists they write (lib/firewall/publish.ts), and the first failure stops the
// publish: the answer says what was applied, which operation failed and why. One audit row per publish.
//
// Proxmox is called directly, not through the orchestrator: its firewall endpoints take no digest, and a publish
// without one could overwrite a change made meanwhile.
import { NextRequest, NextResponse } from 'next/server'

import { getCurrentTenantId, verifyConnectionOwnership } from '@/lib/tenant'
import { getTenantInfrastructureScope } from '@/lib/tenant/infraScope'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { getConnectionById } from '@/lib/connections/getConnection'
import { pveFetch } from '@/lib/proxmox/client'
import { audit } from '@/lib/audit'
import { withAudit } from '@/lib/audit/withAudit'
import { forgetGuestCoverage } from '@/lib/firewall/guestCoverage'
import { noteGuestNicFirewall } from '@/lib/inventory/guestDiskTotals'
import { PUBLISH_CONFIRM_ABOVE, isFail, parsePublishBody, scopeKey, type PublishResult } from '@/lib/firewall/publishOps'
import { executePublish, publishStatus, publishSummary, type PublishIO } from '@/lib/firewall/publish'

type RouteContext = { params: Promise<{ connectionId: string }> }

/** A publish of 200 writes is far below this; anything larger is not a draft of this tab. */
const MAX_BODY_BYTES = 256 * 1024

/**
 * Connections with a publish running: a second one waits for the first to end (409 PUBLISH_RUNNING) rather than
 * interleave its writes. Per Next process: with several frontends (HA), two of them may still publish at once, and
 * the digests then stop the second one on its first write.
 */
const running = new Set<string>()

async function readBody(req: NextRequest): Promise<unknown> {
  const declared = Number(req.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return undefined
  const text = await req.text()
  if (text.length > MAX_BODY_BYTES) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function pveIO(conn: Awaited<ReturnType<typeof getConnectionById>>, connectionId: string): PublishIO {
  return {
    get: path => pveFetch(conn, path),
    write: async (method, path, form) => {
      await pveFetch(conn, path, form ? { method, body: form } : { method })
    },
    guestWritten: (scope, what) => {
      if (what === 'nic') noteGuestNicFirewall(connectionId, scope.vmType, scope.vmid, true)
      forgetGuestCoverage(connectionId, { type: scope.vmType, vmid: scope.vmid })
    },
  }
}

async function postHandler(req: NextRequest, ctx: RouteContext) {
  const { connectionId } = await ctx.params
  const ownershipDenied = await verifyConnectionOwnership(connectionId)
  if (ownershipDenied) return ownershipDenied

  const denied = await checkPermission(PERMISSIONS.NODE_MANAGE, 'connection', connectionId)
  if (denied) return denied

  // The connection's firewall is the provider's: a vDC tenant never writes it.
  const infra = await getTenantInfrastructureScope(await getCurrentTenantId(), { ignoreVdcContext: true })
  if (infra.kind === 'iaas') {
    return NextResponse.json({ error: 'The firewall of a connection is not available to a vDC tenant' }, { status: 403 })
  }

  const parsed = parsePublishBody(await readBody(req))
  if (isFail(parsed)) return NextResponse.json({ error: parsed.error, code: 'INVALID' }, { status: 400 })
  const { ops, digests, confirmed } = parsed.value
  if (ops.length > PUBLISH_CONFIRM_ABOVE && !confirmed) {
    return NextResponse.json({ error: `A publish of ${ops.length} changes must be confirmed`, code: 'CONFIRM_REQUIRED', count: ops.length }, { status: 400 })
  }

  if (running.has(connectionId)) {
    // Same shape as any other stop: nothing applied, the first operation named, the draft left as it is.
    const message = 'A publish of this connection is already running: try again once it ends'
    const busy: PublishResult = {
      applied: 0, total: ops.length, scopes: {},
      failed: { index: 0, kind: ops[0].kind, scope: scopeKey(ops[0].scope), code: 'PUBLISH_RUNNING', message },
    }
    const { scopeKeys, moreScopes } = publishSummary(ops)
    await audit({
      action: 'firewall.publish', category: 'firewall', resourceType: 'connection', resourceId: connectionId,
      status: 'failure', errorMessage: message, details: { reason: 'publish_running', scopeKeys, moreScopes, total: ops.length },
    })
    return NextResponse.json(busy, { status: 409 })
  }
  running.add(connectionId)
  try {
    const conn = await getConnectionById(connectionId)
    const result = await executePublish(ops, digests, pveIO(conn, connectionId))
    const status = publishStatus(result)

    await audit({
      action: 'firewall.publish',
      category: 'firewall',
      resourceType: 'connection',
      resourceId: connectionId,
      status: result.failed ? 'failure' : 'success',
      errorMessage: result.failed?.message,
      details: {
        ...publishSummary(ops),
        applied: result.applied,
        total: result.total,
        ...(result.failed ? { failed: { index: result.failed.index, kind: result.failed.kind, scope: result.failed.scope, code: result.failed.code } } : {}),
      },
    })

    return NextResponse.json(result, { status })
  } catch (e: any) {
    console.error('[firewall/publish] POST error:', e)
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  } finally {
    running.delete(connectionId)
  }
}

export const POST = withAudit({ category: 'firewall', action: 'firewall.publish', resourceType: 'connection', resourceParam: 'connectionId' }, postHandler)
