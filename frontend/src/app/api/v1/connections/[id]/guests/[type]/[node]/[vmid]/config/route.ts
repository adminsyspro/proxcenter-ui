import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, buildVmResourceId, PERMISSIONS } from "@/lib/rbac"

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

  // Options
  'ostype', 'tablet', 'localtime', 'freeze', 'kvm', 'acpi',

  // Args
  'args',

  // Delete (pour supprimer des options)
  'delete',
])

// Champs autorisés pour LXC
const ALLOWED_LXC_FIELDS = new Set([
  'hostname', 'description', 'tags', 'onboot', 'protection',
  'cores', 'cpulimit', 'cpuunits',
  'memory', 'swap',
  'unprivileged', 'features',
  'delete',
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

    // Proxmox: GET /nodes/{node}/{qemu|lxc}/{vmid}/config
    // Sans paramètre = config effective (après reboot)
    // Avec current=1 = config actuelle (avant reboot)
    const [configEffective, configCurrent] = await Promise.all([
      pveFetch<any>(
        conn,
        `/nodes/${encodeURIComponent(node)}/${type}/${encodeURIComponent(vmid)}/config`,
        { method: "GET" }
      ),
      pveFetch<any>(
        conn,
        `/nodes/${encodeURIComponent(node)}/${type}/${encodeURIComponent(vmid)}/config?current=1`,
        { method: "GET" }
      ).catch(() => null)
    ])

    // Calculer les pending changes (différence entre effective et current)
    const pending: Record<string, any> = {}

    if (configCurrent) {
      const keysToCheck = ['sockets', 'cores', 'cpu', 'cpulimit', 'memory', 'balloon']

      for (const key of keysToCheck) {
        if (configEffective[key] !== configCurrent[key] && configEffective[key] !== undefined) {
          pending[key] = configEffective[key]
        }
      }
    }

    // Retourner la config actuelle avec les pending
    const result = {
      ...configCurrent || configEffective,
      pending: Object.keys(pending).length > 0 ? pending : undefined
    }

    return NextResponse.json({ data: result })
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
                        /^usb\d+$/.test(key)         // USB passthrough

      if (isAllowed && value !== undefined && value !== null) {
        formData.append(key, String(value))
      }
    }

    if (formData.toString() === '') {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 })
    }

    // Proxmox: PUT /nodes/{node}/{qemu|lxc}/{vmid}/config
    const result = await pveFetch<any>(
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

    return NextResponse.json({ data: result, success: true })
  } catch (e: any) {
    console.error("[PUT config] Error:", e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

