import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { isVmConfigNotFoundError, locateVmInCluster, type GuestType } from "@/lib/proxmox/locateVm"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, buildVmResourceId, PERMISSIONS } from "@/lib/rbac"
import { getCurrentTenantId } from "@/lib/tenant"
import { resolveVdcForTenant, checkVdcQuota } from "@/lib/vdc/quota"
import { enforceTenantDrives, DriveScopeError } from "@/lib/vdc/driveGuard"
import { getAllowedNetworksForTenant, validateNetAgainstScope } from "@/lib/vdc/vnets"
import { syncIpamForVmConfig, IpamHintUnavailableError, IpamExhaustedError } from "@/lib/vdc/ipamSync"

export const runtime = "nodejs"

const ALLOWED_TYPES = new Set(["qemu", "lxc"])

// Champs autorisés pour la modification (QEMU)
const ALLOWED_QEMU_FIELDS = new Set([
  // Basic
  'name', 'description', 'tags', 'onboot', 'protection',

  // CPU
  'cores', 'sockets', 'cpu', 'vcpus', 'cpulimit', 'cpuunits', 'numa',

  // Memory
  'memory', 'balloon', 'shares',

  // Boot
  'boot', 'bootdisk', 'bios', 'machine',

  // Agent
  'agent',

  // Hardware
  'scsihw', 'vga',

  // Options
  'ostype', 'hotplug', 'tablet', 'localtime', 'freeze', 'kvm', 'acpi',

  // Args
  'args',

  // Cloud-Init
  'ciuser', 'cipassword', 'sshkeys', 'nameserver', 'searchdomain', 'citype', 'cicustom',

  // Delete (pour supprimer des options)
  'delete',

  // Revert pending changes (comma-separated config keys to undo)
  'revert',
])

// Champs autorisés pour LXC
const ALLOWED_LXC_FIELDS = new Set([
  'hostname', 'description', 'tags', 'onboot', 'protection',
  'cores', 'cpulimit', 'cpuunits',
  'memory', 'swap',
  'unprivileged', 'features',
  'delete',
  'revert',
])

// GET: Récupérer la configuration de la VM
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string; type: string; node: string; vmid: string }> }
) {
  try {
    const { id, type, node, vmid } = await ctx.params

    if (!ALLOWED_TYPES.has(type)) {
      return NextResponse.json({ error: "Invalid type" }, { status: 400 })
    }

    // RBAC: Check vm.view permission
    const resourceId = buildVmResourceId(id, node, type, vmid)
    const denied = await checkPermission(PERMISSIONS.VM_VIEW, "vm", resourceId)

    if (denied) return denied

    const conn = await getConnectionById(id)

    // Resolve via the original node first; on "config does not exist"
    // (post-intra-cluster-migration, source .conf already removed by PVE),
    // re-resolve the VM's current node via /cluster/resources and retry.
    let resolvedNode = node
    let movedTo: string | null = null
    let configEffective: any
    try {
      configEffective = await pveFetch<any>(
        conn,
        `/nodes/${encodeURIComponent(node)}/${type}/${encodeURIComponent(vmid)}/config`,
        { method: "GET" }
      )
    } catch (err: any) {
      if (!isVmConfigNotFoundError(err)) throw err
      const located = await locateVmInCluster(conn, vmid, type as GuestType)
      if (!located || located.node === node) throw err
      resolvedNode = located.node
      movedTo = located.node
      configEffective = await pveFetch<any>(
        conn,
        `/nodes/${encodeURIComponent(resolvedNode)}/${type}/${encodeURIComponent(vmid)}/config`,
        { method: "GET" }
      )
    }
    const configCurrent = await pveFetch<any>(
      conn,
      `/nodes/${encodeURIComponent(resolvedNode)}/${type}/${encodeURIComponent(vmid)}/config?current=1`,
      { method: "GET" }
    ).catch(() => null)

    // Calculer les pending changes (différence entre effective et current)
    // = changements qui nécessitent un reboot pour prendre effet
    const pending: Record<string, any> = {}

    if (configCurrent) {
      const skipKeys = new Set(['digest', 'pending'])

      for (const key of Object.keys(configEffective)) {
        if (skipKeys.has(key)) continue
        if (configEffective[key] !== configCurrent[key] && configEffective[key] !== undefined) {
          pending[key] = configEffective[key]
        }
      }
    }

    // Retourner la config effective (inclut les dernières modifications)
    // avec les pending pour indiquer ce qui nécessite un reboot
    const result = {
      ...configEffective,
      pending: Object.keys(pending).length > 0 ? pending : undefined
    }

    return NextResponse.json({ data: result, movedTo })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

// PUT: Mettre à jour la configuration de la VM
export async function PUT(
  req: Request,
  ctx: { params: Promise<{ id: string; type: string; node: string; vmid: string }> }
) {
  try {
    const { id, type, node, vmid } = await ctx.params

    if (!ALLOWED_TYPES.has(type)) {
      return NextResponse.json({ error: "Invalid type" }, { status: 400 })
    }

    // RBAC: Check vm.config permission
    const resourceId = buildVmResourceId(id, node, type, vmid)
    const denied = await checkPermission(PERMISSIONS.VM_CONFIG, "vm", resourceId)

    if (denied) return denied

    const body = await req.json().catch(() => null)

    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
    }

    const conn = await getConnectionById(id)

    // ── vDC Quota Check (CPU/RAM increases) ──
    const tenantId = await getCurrentTenantId()
    let vdcInfo: Awaited<ReturnType<typeof resolveVdcForTenant>> = null
    try {
      vdcInfo = await resolveVdcForTenant(tenantId, id, node)

      if (vdcInfo && (body.cores || body.sockets || body.memory)) {
        // Fetch current VM config from PVE to compute deltas
        const currentConfig = await pveFetch<any>(
          conn,
          `/nodes/${encodeURIComponent(node)}/${type}/${encodeURIComponent(vmid)}/config`
        )

        const currentVcpus = (currentConfig?.cores || 1) * (currentConfig?.sockets || 1)
        const newCores = body.cores ? Number.parseInt(String(body.cores)) : (currentConfig?.cores || 1)
        const newSockets = body.sockets ? Number.parseInt(String(body.sockets)) : (currentConfig?.sockets || 1)
        const newVcpus = newCores * newSockets
        const vcpuDelta = newVcpus - currentVcpus

        const currentRamMb = currentConfig?.memory || 512
        const newRamMb = body.memory ? Number.parseInt(String(body.memory)) : currentRamMb
        const ramDelta = newRamMb - currentRamMb

        // Only enforce quota when resources are INCREASING (decreases are always allowed)
        if (vcpuDelta > 0 || ramDelta > 0) {
          const quotaCheck = await checkVdcQuota(id, vdcInfo.poolName, vdcInfo.quota, {
            type: 'config',
            addVcpus: Math.max(0, vcpuDelta),
            addRamMb: Math.max(0, ramDelta),
            addVms: 0,
          })

          if (!quotaCheck.allowed) {
            return NextResponse.json({
              error: 'Quota exceeded',
              violations: quotaCheck.violations,
            }, { status: 409 })
          }
        }
      }
    } catch (e: any) {
      if (e?.message === 'NODE_NOT_AUTHORIZED') {
        return NextResponse.json({ error: 'This node is not authorized for your vDC' }, { status: 403 })
      }
      throw e
    }

    // Phase 4b: enforce the network allow-list (bridge name + VLAN tag/trunks)
    const allowedNetworks = await getAllowedNetworksForTenant(tenantId, id)
    if (allowedNetworks !== null) {
      for (const key of Object.keys(body || {})) {
        if (!/^net\d+$/.test(key)) continue
        const verdict = validateNetAgainstScope(String(body[key] || ""), allowedNetworks)
        if (verdict.ok === false) return NextResponse.json({ error: verdict.error }, { status: 403 })
      }
    }

    // Disk storage allow-list + storage-policy QoS stamping + quota metering
    // (pre-existing hole: disk keys used to flow verbatim to PVE).
    try {
      const drives = await enforceTenantDrives({ tenantId, connectionId: id, type: type as 'qemu' | 'lxc', body })
      if (drives && drives.totalAddMb > 0 && vdcInfo) {
        const quotaCheck = await checkVdcQuota(id, vdcInfo.poolName, vdcInfo.quota, {
          type: 'config',
          addStorageMb: drives.totalAddMb,
          addStorageMbByStorage: drives.addStorageMbByStorage,
        }, vdcInfo.storagePolicies, node)
        if (!quotaCheck.allowed) {
          return NextResponse.json({ error: 'Quota exceeded', violations: quotaCheck.violations }, { status: 409 })
        }
      }
    } catch (e: any) {
      if (e instanceof DriveScopeError) {
        return NextResponse.json({ error: e.message }, { status: 403 })
      }
      throw e
    }

    // Sélectionner les champs autorisés selon le type
    const allowedFields = type === 'qemu' ? ALLOWED_QEMU_FIELDS : ALLOWED_LXC_FIELDS

    // Construire les données à envoyer à Proxmox
    const formData = new URLSearchParams()
    
    for (const [key, value] of Object.entries(body)) {
      // Vérifier si le champ est autorisé ou si c'est un champ réseau/disque
      const isAllowed = allowedFields.has(key) ||
                        /^net\d+$/.test(key) ||      // net0, net1, etc.
                        /^(scsi|virtio|ide|sata)\d+$/.test(key) || // disques
                        /^unused\d+$/.test(key) ||   // unused disks
                        /^hostpci\d+$/.test(key) ||  // PCI passthrough
                        /^usb\d+$/.test(key) ||      // USB passthrough
                        /^ipconfig\d+$/.test(key) || // Cloud-Init IP configs
                        /^efidisk\d+$/.test(key) ||  // EFI disk
                        /^tpmstate\d+$/.test(key) || // TPM state
                        /^serial\d+$/.test(key) ||   // Serial ports
                        /^audio\d+$/.test(key) ||    // Audio device
                        key === 'rng0'               // VirtIO RNG

      if (isAllowed && value !== undefined && value !== null) {
        // PVE requires sshkeys to be URL-encoded inside the value (double-encoding)
        if (key === 'sshkeys') {
          formData.append(key, encodeURIComponent(String(value)))
        } else {
          formData.append(key, String(value))
        }
      }
    }

    if (formData.toString() === '') {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 })
    }

    // ── IPAM sync (qemu only) ──
    // Reconcile our IPAM DB with the netN/ipconfigN changes the user is
    // about to push. The helper handles the no-op case (no IPAM-managed
    // bridge involved) cheaply, so this is safe to call unconditionally.
    let ipamRollback: (() => Promise<void>) | null = null
    if (type === 'qemu') {
      const before = await pveFetch<any>(
        conn,
        `/nodes/${encodeURIComponent(node)}/${type}/${encodeURIComponent(vmid)}/config`
      )
      // Build the after-snapshot the helper compares against. body is a
      // sparse patch — fields not in body inherit from before.
      const after = { ...before, ...body }
      try {
        const sync = await syncIpamForVmConfig({
          before,
          after,
          conn,
          connectionId: id,
          vmid: Number(vmid),
          hostname: typeof body.name === 'string' ? body.name : (before?.name ?? null),
        })
        ipamRollback = sync.rollback
        // Patch the PVE PUT body with any ipconfigN corrections the
        // allocator emitted (auto-pick, hint conflict resolution).
        for (const [k, v] of Object.entries(sync.bodyOverrides)) {
          formData.set(k, v)
        }
      } catch (err: any) {
        if (err instanceof IpamHintUnavailableError) {
          return NextResponse.json({ error: `IP unavailable: ${err.hint}` }, { status: 409 })
        }
        if (err instanceof IpamExhaustedError) {
          return NextResponse.json({ error: `Subnet is full — no free IP available` }, { status: 409 })
        }
        throw err
      }
    }

    // Proxmox: PUT /nodes/{node}/{qemu|lxc}/{vmid}/config
    let result: any
    try {
      result = await pveFetch<any>(
        conn,
        `/nodes/${encodeURIComponent(node)}/${type}/${encodeURIComponent(vmid)}/config`,
        {
          method: "PUT",
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: formData.toString()
        }
      )
    } catch (err) {
      // PVE rejected the write — undo the IPAM mutations so the DB doesn't
      // drift away from the unchanged qm config.
      if (ipamRollback) {
        try { await ipamRollback() } catch { /* tolerate */ }
      }
      throw err
    }

    // Audit
    const { audit } = await import("@/lib/audit")

    await audit({
      action: "update",
      category: type === 'lxc' ? 'containers' : 'vms',
      resourceType: type,
      resourceId: vmid,
      details: { node, connectionId: id, fields: Object.keys(body).filter(k => allowedFields.has(k) || /^net\d+$/.test(k) || /^(scsi|virtio|ide|sata)\d+$/.test(k) || /^efidisk\d+$/.test(k) || /^tpmstate\d+$/.test(k) || /^serial\d+$/.test(k) || /^hostpci\d+$/.test(k) || /^usb\d+$/.test(k) || /^audio\d+$/.test(k) || k === 'rng0') },
    })

    return NextResponse.json({ data: result, success: true })
  } catch (e: any) {
    console.error("[PUT config] Error:", e)

return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

