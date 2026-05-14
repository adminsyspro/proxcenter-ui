import { NextResponse } from "next/server"

import { getCurrentTenantId } from "@/lib/tenant"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { getVdcById } from "@/lib/vdc"
import { getConnectionById } from "@/lib/connections/getConnection"
import { pveFetch } from "@/lib/proxmox/client"
import { computeGreenMetricsForVms, type VmGreenInput, type GreenConfig } from "@/lib/green/compute"
import { resolveGreenConfigForNode } from "@/lib/green/resolve"
import { ensureDefaultDatacenter } from "@/lib/db/datacenters"

export const runtime = "nodejs"

type RouteContext = { params: Promise<{ id: string }> | { id: string } }

/**
 * GET /api/v1/vdcs/{id}/green
 *
 * Tenant-scoped Green-IT metrics: aggregates over the VMs that live in the
 * vDC's PVE pool. Reads provider-level configuration (PUE, electricity, CO₂
 * factor) since these are datacentre concerns owned by the MSP, not the
 * tenant.
 *
 * Cost is NOT exposed here — pricing is a super-admin concern. The card on
 * the tenant's /my-vdc page should show consumption + CO₂ only.
 */
export async function GET(_req: Request, ctx: RouteContext) {
  try {
    const params = await Promise.resolve(ctx.params)
    const vdcId = (params as any)?.id

    if (!vdcId) return NextResponse.json({ error: "Missing vDC ID" }, { status: 400 })

    const denied = await checkPermission(PERMISSIONS.VM_VIEW)

    if (denied) return denied

    const vdc = await getVdcById(vdcId)

    if (!vdc) return NextResponse.json({ error: "vDC not found" }, { status: 404 })

    const tenantId = await getCurrentTenantId()

    if (vdc.tenantId !== tenantId) {
      return NextResponse.json({ error: "vDC not accessible" }, { status: 403 })
    }

    // Fallback config built from the provider's Default DC. The per-VM
    // resolver below normally returns a node-specific config; this fallback
    // only kicks in when a VM lacks a known node (rare) or when no DC has
    // been seeded yet (we auto-seed via ensureDefaultDatacenter).
    const defaultDc = await ensureDefaultDatacenter()

    const fallback: GreenConfig = {
      tdpPerCore: defaultDc.tdpPerCoreW,
      wattsPerGbRam: defaultDc.wattsPerGbRam,
      pue: defaultDc.pue,
      co2Factor: defaultDc.co2Factor,
      electricityPrice: defaultDc.electricityPrice,
      currency: defaultDc.currency,
      equivalences: {
        kmVoiture: 0.193,
        arbreParAn: 25,
        chargeSmartphone: 0.0085,
      },
    }

    // Fetch all VMs from the cluster, then keep only those in the vDC's pool.
    const conn = await getConnectionById(vdc.connectionId)
    const guests = await pveFetch<any[]>(conn, '/cluster/resources?type=vm').catch(() => [])

    // Per-VM config: resolve the green-IT chain for the VM's host node so
    // that VMs spread across nodes / datacentres aggregate with the right
    // PUE / CO₂ factor / electricity price each.
    const vmInputs: VmGreenInput[] = await Promise.all((guests || [])
      .filter((g: any) => typeof g?.pool === 'string' && g.pool === vdc.pvePoolName)
      .map(async (g: any) => {
        const nodeName = String(g.node ?? '')
        let perVmConfig: GreenConfig | undefined

        if (nodeName) {
          const resolved = await resolveGreenConfigForNode(vdc.connectionId, nodeName)

          perVmConfig = {
            tdpPerCore: resolved.tdpPerCore,
            wattsPerGbRam: resolved.wattsPerGbRam,
            pue: resolved.datacenter.pue,
            co2Factor: resolved.datacenter.co2Factor,
            electricityPrice: resolved.datacenter.electricityPrice,
            currency: resolved.datacenter.currency,
            equivalences: fallback.equivalences,
          }
        }


return {
          vcpus: Number(g.maxcpu) || 0,
          ramBytes: Number(g.maxmem) || 0,
          status: String(g.status ?? 'stopped'),
          cpuPct: Number(g.cpu) || 0,
          config: perVmConfig,
        }
      }))

    const metrics = computeGreenMetricsForVms(vmInputs, fallback)

    return NextResponse.json({
      data: {
        power: metrics.power,
        co2: metrics.co2,
        efficiency: metrics.efficiency,

        // cost intentionally omitted for tenant view
      },
      configured: true,
      vmCount: vmInputs.length,
      runningVmCount: vmInputs.filter(v => v.status === 'running').length,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
