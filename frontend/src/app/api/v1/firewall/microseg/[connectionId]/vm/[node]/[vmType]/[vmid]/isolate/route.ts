export const dynamic = "force-dynamic"
// src/app/api/v1/firewall/microseg/[connectionId]/vm/[node]/[vmType]/[vmid]/isolate/route.ts
import { NextRequest, NextResponse } from 'next/server'

import { getOrchestratorClient } from '@/lib/orchestrator/client'
import { verifyConnectionOwnership } from '@/lib/tenant'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { withPublicApiGuard } from '@/lib/api-tokens/routeGuard'
import type { Principal } from '@/lib/auth/principal'
import { getTenantInfrastructureScope } from '@/lib/tenant/infraScope'
import { withAudit } from '@/lib/audit/withAudit'

type Params = { connectionId: string; node: string; vmType: string; vmid: string }

// The orchestrator decodes this body with Go's encoding/json, which matches
// keys case-insensitively (with Unicode folding: "ſ" is an "s"). A token body
// is rebuilt from the exact IsolateVMRequest keys, typed, so what the checks
// below see is what the orchestrator gets. Sessions keep the raw body.
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

// apply_base_sgs may create cluster-level security groups and gateway
// aliases: a vDC tenant token isolates its own guest without it. Any spelling
// the orchestrator would read as apply_base_sgs counts (fail closed).
async function tokenBaseSgsRefusal(principal: Principal, body: Record<string, unknown>): Promise<string | null> {
  const asks = Object.entries(body).some(([key, value]) => goFold(key) === 'apply_base_sgs' && !!value)

  if (!asks) return null
  const infra = await getTenantInfrastructureScope(principal.tenantId, { ignoreVdcContext: true })

  return infra.kind === 'iaas' ? 'Cluster-level object not available to a vDC tenant token' : null
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

    let body = await request.json()

    if (principal?.kind === 'token') {
      const payload = tokenIsolatePayload(body)

      if (!payload) return NextResponse.json({ error: 'Invalid isolation request' }, { status: 400 })
      const tokenRefusal = await tokenBaseSgsRefusal(principal, body)

      if (tokenRefusal) return NextResponse.json({ error: tokenRefusal }, { status: 403 })
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
