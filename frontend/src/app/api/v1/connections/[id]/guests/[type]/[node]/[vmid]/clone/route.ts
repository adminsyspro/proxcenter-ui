import { NextResponse, after } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, buildVmResourceId, PERMISSIONS } from "@/lib/rbac"
import { cloneVmSchema } from "@/lib/schemas"
import { invalidateInventoryCache } from "@/lib/cache/inventoryCache"
import { getCurrentTenantId } from "@/lib/tenant"
import { resolveVdcForTenant, checkVdcQuota } from "@/lib/vdc/quota"
import { getAllowedBridgesForTenant, parseBridgeFromNet, resolveSubnetForBridge } from "@/lib/vdc/vnets"
import { syncIpamForVmConfig } from "@/lib/vdc/ipamSync"
import { releaseAllocationsForVm } from "@/lib/vdc/ipam"
import { waitForTask } from "@/lib/proxmox/tasks"

export const runtime = "nodejs"

// POST /api/v1/connections/{id}/guests/{type}/{node}/{vmid}/clone
// Clone a VM or template
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string; type: string; node: string; vmid: string }> | { id: string; type: string; node: string; vmid: string } }
) {
  try {
    const params = await Promise.resolve(ctx.params)
    const { id, type, node, vmid } = params as { id: string; type: string; node: string; vmid: string }

    if (!id || !type || !node || !vmid) {
      return NextResponse.json({ error: "Missing required parameters" }, { status: 400 })
    }

    if (type !== 'qemu' && type !== 'lxc') {
      return NextResponse.json({ error: "Type must be 'qemu' or 'lxc'" }, { status: 400 })
    }

    // RBAC: Check vm.clone permission
    const resourceId = buildVmResourceId(id, node, type, vmid)
    const denied = await checkPermission(PERMISSIONS.VM_CLONE, "vm", resourceId)

    if (denied) return denied

    const conn = await getConnectionById(id)
    const rawBody = await req.json()

    const parseResult = cloneVmSchema.safeParse(rawBody)

    if (!parseResult.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parseResult.error.flatten() },
        { status: 400 }
      )
    }

    const body = parseResult.data

    // vDC quota enforcement
    const tenantId = await getCurrentTenantId()
    let vdcPoolName: string | null = null

    try {
      const vdcInfo = await resolveVdcForTenant(tenantId, id, node)

      if (vdcInfo) {
        // Fetch source VM config to estimate resources for the clone
        const vmConfig = await pveFetch<any>(
          conn,
          `/nodes/${encodeURIComponent(node)}/${type}/${encodeURIComponent(vmid)}/config`
        )

        const vcpus = (vmConfig?.cores || 1) * (vmConfig?.sockets || 1)
        const ramMb = vmConfig?.memory || 512

        const quotaCheck = await checkVdcQuota(id, vdcInfo.poolName, vdcInfo.quota, {
          type: 'clone',
          addVcpus: vcpus,
          addRamMb: ramMb,
          addVms: 1,
        })

        if (!quotaCheck.allowed) {
          return NextResponse.json({
            error: 'Quota exceeded',
            violations: quotaCheck.violations,
            currentUsage: quotaCheck.currentUsage,
          }, { status: 409 })
        }

        // Remember pool name for formData injection below
        vdcPoolName = vdcInfo.poolName
      }
    } catch (e: any) {
      if (e?.message === 'NODE_NOT_AUTHORIZED') {
        return NextResponse.json({ error: 'This node is not authorized for your vDC' }, { status: 403 })
      }

      throw e
    }

    // Phase 4b: Enforce bridge whitelist
    const allowedBridges = await getAllowedBridgesForTenant(tenantId, id)

    if (allowedBridges !== null) {
      for (const key of Object.keys(body || {})) {
        if (!/^net\d+$/.test(key)) continue
        const bridge = parseBridgeFromNet(String(body[key] || ""))

        if (bridge && !allowedBridges.has(bridge)) {
          return NextResponse.json(
            { error: `Bridge "${bridge}" is not authorized for this vDC. Allowed: ${Array.from(allowedBridges).join(", ")}` },
            { status: 403 }
          )
        }
      }
    }

    // ── IPAM-managed clone hardening (qemu only) ──
    // PVE's clone keeps the source MACs by default, which would create
    // both a network-level MAC collision AND an IPAM (subnet, mac) UNIQUE
    // collision when allocating for the new vmid. If the source has any
    // NIC on an IPAM-managed VNet, force `unique=1` so PVE regenerates
    // every MAC. The post-clone sync below then allocates fresh IPs for
    // those new MACs.
    let cloneTouchesIpam = false

    if (type === 'qemu') {
      try {
        const sourceConfig = await pveFetch<any>(
          conn,
          `/nodes/${encodeURIComponent(node)}/qemu/${encodeURIComponent(vmid)}/config`
        )

        for (const k of Object.keys(sourceConfig || {})) {
          if (!/^net\d+$/.test(k)) continue
          const bridge = parseBridgeFromNet(String(sourceConfig[k] || ''))

          if (bridge && await resolveSubnetForBridge(id, bridge)) {
            cloneTouchesIpam = true
            break
          }
        }
      } catch { /* tolerate — fall through, sync will detect drift later */ }
    }

    // Construire l'URL Proxmox pour le clone
    const endpoint = `/nodes/${encodeURIComponent(node)}/${type}/${encodeURIComponent(vmid)}/clone`

    // Convertir le body en format URL-encoded (Proxmox attend ce format)
    const formData = new URLSearchParams()

    for (const [key, value] of Object.entries(body)) {
      if (value !== undefined && value !== null && value !== '') {
        formData.append(key, String(value))
      }
    }

    // Force pool assignment if tenant has a vDC
    if (vdcPoolName) {
      formData.set('pool', vdcPoolName)
    }

    if (cloneTouchesIpam) {
      // unique=1 tells PVE to regenerate every MAC on the clone's NICs.
      // Without it, two VMs would share MACs which collides at L2 and
      // breaks the IPAM (subnet, mac) UNIQUE constraint.
      formData.set('unique', '1')
    }

    // Appeler l'API Proxmox pour cloner la VM
    const result = await pveFetch<any>(conn, endpoint, {
      method: "POST",
      body: formData.toString(),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    })

    invalidateInventoryCache()

    // ── Post-clone IPAM sync ──
    // The clone runs as a PVE task (UPID returned in `result`). We schedule
    // the IPAM reconciliation in after() so the HTTP response goes back to
    // the client immediately and the sync runs once PVE actually finished
    // cloning. Failures are logged + auto-rollback'd; we don't try to roll
    // back the clone itself (data loss risk).
    if (cloneTouchesIpam && type === 'qemu' && body.newid) {
      const newVmid = Number(body.newid)
      const upid = String(result || '')
      const cloneNode = String(body.target || node)
      const cloneName = body.name ? String(body.name) : null

      after(async () => {
        try {
          if (upid) await waitForTask(conn, cloneNode, upid)

          const cloneConfig = await pveFetch<any>(
            conn,
            `/nodes/${encodeURIComponent(cloneNode)}/qemu/${encodeURIComponent(String(newVmid))}/config`
          )

          const sync = await syncIpamForVmConfig({
            before: null,
            after: cloneConfig,
            conn,
            connectionId: id,
            vmid: newVmid,
            hostname: cloneName ?? cloneConfig?.name ?? null,
          })

          // Push any ipconfigN corrections back to the clone so cloud-init
          // sees the freshly allocated IP — without this the clone would
          // boot with the source's ip baked in and collide on the wire.
          if (Object.keys(sync.bodyOverrides).length > 0) {
            const patch = new URLSearchParams()

            for (const [k, v] of Object.entries(sync.bodyOverrides)) patch.set(k, v)

            try {
              await pveFetch<any>(
                conn,
                `/nodes/${encodeURIComponent(cloneNode)}/qemu/${encodeURIComponent(String(newVmid))}/config`,
                {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                  body: patch.toString(),
                }
              )
            } catch (err: any) {
              console.error(`[clone-ipam-sync] PVE PUT config failed for vmid=${newVmid}: ${err?.message ?? err}`)
              try { await sync.rollback() } catch { /* tolerate */ }
              try { await releaseAllocationsForVm(id, newVmid) } catch { /* tolerate */ }
            }
          }
        } catch (err: any) {
          console.error(`[clone-ipam-sync] post-clone IPAM sync failed for vmid=${body.newid}: ${err?.message ?? err}`)

          // Best-effort cleanup so a failed sync doesn't leak partial
          // allocations. The clone itself stays, data loss > drift.
          try { await releaseAllocationsForVm(id, newVmid) } catch { /* tolerate */ }
        }
      })
    }

    // Audit
    const { audit } = await import("@/lib/audit")

    await audit({
      action: "clone",
      category: type === 'lxc' ? 'containers' : 'vms',
      resourceType: type,
      resourceId: vmid,
      details: { node, connectionId: id, newVmId: body.newid, newName: body.name },
    })

    return NextResponse.json({
      data: result,
      message: `Clone operation started`
    })
  } catch (e: any) {
    console.error('Error cloning VM:', e)

return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
