import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, getRequestGuestScopePerimeter, PERMISSIONS } from "@/lib/rbac"
import { getCurrentTenantId } from "@/lib/tenant"
import { resolveVdcForTenant, checkVdcQuota } from "@/lib/vdc/quota"
import { getAllowedBridgesForTenant, resolveSubnetForBridge, parseBridgeFromNet } from "@/lib/vdc/vnets"
import { generatePveMacAddress } from "@/lib/vdc/sdn"
import { allocateIp, releaseIp, IpamExhaustedError } from "@/lib/vdc/ipam"
import { parseCidr } from "@/lib/vdc/network"
import { checkVmidAgainstTenantRange } from "@/lib/tenant/vmidRange"

export const runtime = "nodejs"

/**
 * Sum the total size (in MB) of NEW disk allocations in a PVE create payload.
 * Matches qemu disk keys (scsi0, virtio0, ide0, sata0, efidisk0, tpmstate0)
 * and lxc mount points (rootfs, mp0..mp9). Size format `storage:<number>` is
 * GB for new allocations; entries whose value is a volid (e.g.
 * `storage:vm-100-disk-0`) are existing attaches and are skipped. CDROM/media
 * entries are ignored.
 */
function sumNewDiskStorageMb(body: Record<string, any>): number {
  const diskKeyRe = /^(scsi|virtio|ide|sata|efidisk|tpmstate)\d+$|^rootfs$|^mp\d+$/
  const sizeRe = /^[^:]+:(\d+(?:\.\d+)?)$/
  let totalMb = 0
  for (const [key, raw] of Object.entries(body || {})) {
    if (!diskKeyRe.test(key)) continue
    if (typeof raw !== 'string') continue
    if (/\bmedia=cdrom\b/.test(raw)) continue
    const [head] = raw.split(',')
    const m = head.match(sizeRe)
    if (!m) continue
    const gb = Number.parseFloat(m[1])
    if (Number.isFinite(gb) && gb > 0) totalMb += Math.round(gb * 1024)
  }
  return totalMb
}

// POST /api/v1/connections/{id}/guests/{type}/{node}
// Create a new VM (qemu) or LXC container
export async function POST(
  req: Request, 
  ctx: { params: Promise<{ id: string; type: string; node: string }> | { id: string; type: string; node: string } }
) {
  try {
    const params = await Promise.resolve(ctx.params)
    const { id, type, node } = params as { id: string; type: string; node: string }

    if (!id || !type || !node) {
      return NextResponse.json({ error: "Missing required parameters" }, { status: 400 })
    }

    if (type !== 'qemu' && type !== 'lxc') {
      return NextResponse.json({ error: "Type must be 'qemu' or 'lxc'" }, { status: 400 })
    }

    // Flat-scoped creators (vm/tag/pool) never match a connection-scoped check
    // and used to 403 here, so the wizard failed on submit even once its
    // dropdowns were populated (issue #262). They come in through the
    // guest-derived perimeter, and the pool guard below keeps their new guest
    // inside their own scope.
    const denied = await checkPermission(PERMISSIONS.VM_CREATE, "connection", id)
    const perimeter = denied ? await getRequestGuestScopePerimeter(id, PERMISSIONS.VM_CREATE) : null

    if (denied && !(perimeter?.holdsPermission && perimeter.hasVisibleGuests)) return denied

    const conn = await getConnectionById(id)
    const body = await req.json()

    // Valider les champs requis
    if (!body.vmid) {
      return NextResponse.json({ error: "vmid is required" }, { status: 400 })
    }

    // Pool containment for flat-scoped creators: a guest created outside their
    // pools would be invisible to them the moment it exists. A single
    // accessible pool is applied implicitly, mirroring the vDC forcing below.
    if (perimeter?.restricted) {
      const requestedPool = typeof body.pool === 'string' ? body.pool.trim() : ''

      if (requestedPool) {
        if (!perimeter.pools.has(requestedPool)) {
          return NextResponse.json({ error: "Resource pool outside your scope" }, { status: 403 })
        }
      } else if (perimeter.pools.size === 1) {
        body.pool = [...perimeter.pools][0]
      } else {
        return NextResponse.json({ error: "A resource pool within your scope is required" }, { status: 400 })
      }
    }

    // vDC quota enforcement
    const tenantId = await getCurrentTenantId()

    // MSP VMID range: enforced for NEW guests only (existing guests are
    // never retro-checked).
    const vmidRangeCheck = await checkVmidAgainstTenantRange(tenantId, Number(body.vmid))
    if (!vmidRangeCheck.ok) {
      return NextResponse.json({ error: vmidRangeCheck.error }, { status: vmidRangeCheck.status ?? 400 })
    }

    try {
      const vdcInfo = await resolveVdcForTenant(tenantId, id, node)

      if (vdcInfo) {
        // Estimate resources from body
        const vcpus = Number.parseInt(body.cores || '1') * Number.parseInt(body.sockets || '1')
        const ramMb = Number.parseInt(body.memory || '512')
        const storageMb = sumNewDiskStorageMb(body)

        const quotaCheck = await checkVdcQuota(id, vdcInfo.poolName, vdcInfo.quota, {
          type: 'create',
          addVcpus: vcpus,
          addRamMb: ramMb,
          addStorageMb: storageMb,
          addVms: 1,
        })

        if (!quotaCheck.allowed) {
          return NextResponse.json({
            error: 'Quota exceeded',
            violations: quotaCheck.violations,
            currentUsage: quotaCheck.currentUsage,
          }, { status: 409 })
        }

        // Force pool assignment - inject into body before PVE call
        body.pool = vdcInfo.poolName
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

    // IPAM auto-allocation: for each NIC bound to a SDN VNet that has a
    // ProxCenter-managed subnet, claim an IP from our IPAM and inject the
    // matching ipconfigN into the body. Only fires for QEMU (LXC has its
    // own ip-by-net0 syntax, treated separately if/when needed). Skipped
    // when the user explicitly set ipconfigN already (e.g. ip=dhcp for
    // PXE / non-cloud-init OS).
    //
    // Subnet lookup is keyed on (connectionId, bridge) — no tenant filter,
    // because the tenant authorisation already happened upstream via
    // resolveVdcForTenant + allowed bridges check.
    const allocations: Array<{ subnetId: string; ip: string }> = []
    let injectedDns: string[] = []
    if (type === 'qemu') {
      for (const key of Object.keys(body || {})) {
        const m = key.match(/^net(\d+)$/)
        if (!m) continue
        const idx = m[1]
        const ipconfigKey = `ipconfig${idx}`
        if (typeof body[ipconfigKey] === 'string' && body[ipconfigKey].trim()) {
          // User-provided ipconfigN — respect their choice (manual IP, dhcp, …).
          continue
        }
        const netStr = String(body[key] || '')
        const bridge = parseBridgeFromNet(netStr)
        if (!bridge) continue
        const subnet = await resolveSubnetForBridge(id, bridge)
        if (!subnet) continue

        // Make sure netN carries an explicit MAC so our IPAM can key on
        // it and a future re-create of the same VM with the same MAC
        // reuses the same IP. PVE accepts both "<model>=MAC,bridge=…" and
        // "<model>,bridge=…,macaddr=…" syntaxes; we normalise to the first.
        const existingMacMatch = netStr.match(/(?:^|=)(?:[0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}/)
        let mac = existingMacMatch ? existingMacMatch[0].replace(/^=/, '').toUpperCase() : null
        if (!mac) {
          mac = generatePveMacAddress()
          // Inject the MAC into the model=… part so PVE doesn't roll its
          // own and our IPAM record stays in sync.
          const parts = netStr.split(',')
          // Replace first part (model token) — handle "virtio" or "virtio=AA:..".
          const head = parts[0] ?? 'virtio'
          const headModel = head.includes('=') ? head.split('=')[0] : head
          parts[0] = `${headModel}=${mac}`
          body[key] = parts.join(',')
        }

        try {
          const vmidNum = body.vmid != null ? Number(body.vmid) : null
          const allocated = await allocateIp({
            vdcId: subnet.vdcId,
            subnetId: subnet.subnetId,
            vnetId: subnet.vnetId,
            connectionId: id,
            mac,
            vmid: Number.isFinite(vmidNum) ? vmidNum : null,
            hostname: body.name || `vm-${body.vmid}`,
          })
          const cidrInfo = parseCidr(subnet.cidr)
          const prefix = cidrInfo?.prefix
          const ipconfig = [
            `ip=${allocated.ip}${prefix !== undefined ? `/${prefix}` : ''}`,
            `gw=${subnet.gateway}`,
          ].join(',')
          body[ipconfigKey] = ipconfig
          allocations.push({ subnetId: subnet.subnetId, ip: allocated.ip })
          // DNS resolvers live at the VM level in PVE CloudInit (`nameserver`
          // is shared across NICs). Take the first non-empty list we see;
          // if multiple NICs declare different DNS the first one wins —
          // that's an edge case worth a warning eventually but not blocking.
          if (injectedDns.length === 0 && subnet.dnsServers.length > 0) {
            injectedDns = subnet.dnsServers
          }
        } catch (e: any) {
          // Roll back any previously allocated IPs from this same request
          // so we don't leave dangling reservations on a partial failure.
          for (const a of allocations) {
            try { await releaseIp({ subnetId: a.subnetId, ip: a.ip }) } catch { /* tolerate */ }
          }
          const msg = e instanceof IpamExhaustedError
            ? `Subnet ${subnet.cidr} is full — no free IP available`
            : `IPAM allocation failed: ${e?.message ?? String(e)}`
          return NextResponse.json({ error: msg }, { status: 500 })
        }
      }

      // Push DNS resolvers via CloudInit `nameserver` (space-separated). Skip
      // if the user already provided one to honour explicit overrides.
      if (injectedDns.length > 0 && !body.nameserver) {
        body.nameserver = injectedDns.join(' ')
      }
    }

    // Construire l'URL Proxmox
    const endpoint = `/nodes/${encodeURIComponent(node)}/${type}`

    // Appeler l'API Proxmox pour créer la VM/LXC
    let result: any
    try {
      result = await pveFetch<any>(conn, endpoint, {
        method: "POST",
        body: JSON.stringify(body),
        headers: {
          'Content-Type': 'application/json'
        }
      })
    } catch (err: any) {
      // Release IPAM allocations on PVE create failure — otherwise the IP
      // sits reserved without an actual VM behind it.
      for (const a of allocations) {
        try { await releaseIp({ subnetId: a.subnetId, ip: a.ip }) } catch { /* tolerate */ }
      }
      throw err
    }

    return NextResponse.json({
      data: result,
      message: `${type === 'qemu' ? 'VM' : 'Container'} creation started`,
      allocatedIps: allocations.map(a => a.ip),
    })
  } catch (e: any) {
    console.error('Error creating guest:', e)

return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
