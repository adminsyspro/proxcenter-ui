export const dynamic = "force-dynamic"
// src/app/api/v1/firewall/microseg/[connectionId]/vm/[node]/[vmType]/[vmid]/isolate/route.ts
import { NextRequest, NextResponse } from 'next/server'

import { getOrchestratorClient } from '@/lib/orchestrator/client'
import { verifyConnectionOwnership } from '@/lib/tenant'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { withPublicApiGuard } from '@/lib/api-tokens/routeGuard'
import type { Principal } from '@/lib/auth/principal'
import { resolveCallerInfraScope } from '@/lib/tenant/iaasGuard'
import { orchestratorOrPve } from '@/lib/firewall/withPveFallback'
import * as pveDirect from '@/lib/firewall/pveDirect'
import { getConnectionById } from '@/lib/connections/getConnection'
import { guardSessionGuest } from '@/lib/vdc/guestGuard'
import { withAudit } from '@/lib/audit/withAudit'

type Params = { connectionId: string; node: string; vmType: string; vmid: string }

// The orchestrator decodes this body with Go's encoding/json, which matches
// keys case-insensitively (with Unicode folding: "ſ" is an "s"). The body of a
// token or of a vDC tenant session is rebuilt from the exact IsolateVMRequest
// keys, typed, so what the checks below see is what the orchestrator gets.
// Provider and MSP sessions keep the raw body.
const ISOLATE_FLAGS = ['enable_firewall', 'set_policy_in_drop', 'set_policy_out_drop', 'apply_base_sgs', 'enable_nic_fw'] as const

const goFold = (key: string) => key.replace(/\u017f/g, 's').replace(/\u212a/g, 'k').toLowerCase()

type IsolatePayload = Partial<Record<(typeof ISOLATE_FLAGS)[number], boolean>> & { additional_sgs?: string[] }

/** The typed token payload, or null when a known field has the wrong type or the body is not an object. */
function tokenIsolatePayload(body: unknown): IsolatePayload | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  const raw = body as Record<string, unknown>
  const payload: IsolatePayload = {}

  for (const flag of ISOLATE_FLAGS) {
    const value = raw[flag]

    if (value === undefined || value === null) continue
    if (typeof value !== 'boolean') return null
    payload[flag] = value
  }

  const sgs = raw.additional_sgs

  if (sgs !== undefined && sgs !== null) {
    if (!Array.isArray(sgs) || sgs.some(sg => typeof sg !== 'string')) return null
    payload.additional_sgs = sgs
  }

  return payload
}

// apply_base_sgs and an sg-base-* group that does not exist yet make the
// orchestrator create datacenter security groups and gateway aliases. A vDC
// (iaas) tenant, session or token, applies groups that already exist to its
// own guest and nothing else. Any spelling the orchestrator would read as
// apply_base_sgs counts (fail closed).
const asksBaseSgs = (body: Record<string, unknown>) =>
  Object.entries(body).some(([key, value]) => goFold(key) === 'apply_base_sgs' && !!value)

async function createsClusterGroups(connectionId: string, wanted: string[] | undefined): Promise<boolean> {
  if (!wanted?.length) return false
  const orchestrator = getOrchestratorClient()
  const groups = await orchestratorOrPve<unknown>(
    'firewall/groups',
    () => orchestrator.get(`/firewall/groups/${connectionId}`),
    async () => pveDirect.getSecurityGroups(await getConnectionById(connectionId)),
  )
  const existing = new Set(
    (Array.isArray(groups) ? groups : []).map(g => (g && typeof g === 'object' ? (g as Record<string, unknown>).group : undefined)),
  )

  return wanted.some(sg => !existing.has(sg))
}

// POST - Isolate VM
async function postHandler(
  request: NextRequest,
  { params, principal }: { params: Promise<Params>; principal?: Principal }
) {
  try {
    const { connectionId, node, vmType, vmid } = await params
    const ownershipDenied = await verifyConnectionOwnership(connectionId)
    if (ownershipDenied) return ownershipDenied

    const denied = await checkPermission(PERMISSIONS.NODE_MANAGE, "connection", connectionId)
    if (denied) return denied

    // node.manage is connection-wide: the guest itself must be inside the vDC.
    const scopeDenied = await guardSessionGuest({ connectionId, conn: () => getConnectionById(connectionId), type: vmType, node, vmid })
    if (scopeDenied) return scopeDenied

    let body = await request.json()

    const caller = await resolveCallerInfraScope()
    if (caller.ok === false) return caller.response
    const iaas = caller.infra.kind === 'iaas'

    if (principal?.kind === 'token' || iaas) {
      const payload = tokenIsolatePayload(body)

      if (!payload) return NextResponse.json({ error: 'Invalid isolation request' }, { status: 400 })

      if (iaas && (asksBaseSgs(body) || await createsClusterGroups(connectionId, payload.additional_sgs))) {
        const who = principal?.kind === 'token' ? 'a vDC tenant token' : 'a vDC tenant'

        return NextResponse.json({ error: `Cluster-level object not available to ${who}` }, { status: 403 })
      }
      body = payload
    }

    const orchestrator = getOrchestratorClient()

    const response = await orchestrator.post(
      `/firewall/microseg/${connectionId}/vm/${node}/${vmType}/${vmid}/isolate`,
      body
    )

    
return NextResponse.json(response.data)
  } catch (error: any) {
    console.error('Error isolating VM:', error)
    
return NextResponse.json(
      { error: error.message || 'Failed to isolate VM' },
      { status: 500 }
    )
  }
}

export const POST = withAudit({ category: 'firewall', resourceType: 'guest', resourceParam: 'vmid', action: 'apply' }, withPublicApiGuard("fw-vm-isolate", postHandler))
