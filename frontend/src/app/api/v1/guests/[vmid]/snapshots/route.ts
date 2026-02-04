import { NextResponse } from "next/server"

import { prisma } from "@/lib/db/prisma"
import { pveFetch } from "@/lib/proxmox/client"
import { decryptSecret } from "@/lib/crypto/secret"
import { checkPermission, buildVmResourceId, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

type Params = {
  vmid: string // Format: connId:type:node:vmid
}

function parseVmKey(vmKey: string) {
  const parts = vmKey.split(':')

  if (parts.length !== 4) {
    throw new Error('Invalid vmKey format. Expected connId:type:node:vmid')
  }

  
return {
    connId: parts[0],
    type: parts[1],
    node: parts[2],
    vmid: parts[3],
  }
}

async function getConnection(id: string) {
  const connection = await prisma.connection.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      baseUrl: true,
      insecureTLS: true,
      apiTokenEnc: true,
    }
  })

  if (!connection || !connection.apiTokenEnc) {
    return null
  }

  return {
    id: connection.id,
    name: connection.name,
    baseUrl: connection.baseUrl,
    apiToken: decryptSecret(connection.apiTokenEnc),
    insecureDev: !!connection.insecureTLS,
  }
}

/**
 * GET /api/v1/guests/[vmid]/snapshots
 * Liste les snapshots d'une VM
 * vmid format: connId:type:node:vmid
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<Params> }
) {
  try {
    const params = await ctx.params
    const { connId, type, node, vmid } = parseVmKey(params.vmid)

    // RBAC: Check vm.view permission
    const resourceId = buildVmResourceId(connId, node, type, vmid)
    const denied = await checkPermission(PERMISSIONS.VM_VIEW, "vm", resourceId)

    if (denied) return denied

    const conn = await getConnection(connId)

    if (!conn) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 })
    }

    const apiPath = `/nodes/${encodeURIComponent(node)}/${type}/${vmid}/snapshot`
    const snapshots = await pveFetch<any[]>(conn, apiPath)

    // Filtrer "current" et formater
    const formatted = (snapshots || [])
      .filter(s => s.name !== 'current')
      .map(s => ({
        name: s.name,
        description: s.description || '',
        snaptime: s.snaptime || 0,
        snaptimeFormatted: s.snaptime 
          ? new Date(s.snaptime * 1000).toLocaleString('fr-FR')
          : '-',
        vmstate: s.vmstate || false,
        parent: s.parent || null,
      }))
      .sort((a, b) => b.snaptime - a.snaptime)

    return NextResponse.json({
      data: {
        snapshots: formatted,
        count: formatted.length,
      }
    })
  } catch (e: any) {
    console.error("Snapshots list error:", e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

/**
 * POST /api/v1/guests/[vmid]/snapshots
 * Créer un nouveau snapshot
 * Body: { name: string, description?: string, vmstate?: boolean }
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<Params> }
) {
  try {
    const params = await ctx.params
    const { connId, type, node, vmid } = parseVmKey(params.vmid)

    // RBAC: Check vm.snapshot permission
    const resourceId = buildVmResourceId(connId, node, type, vmid)
    const denied = await checkPermission(PERMISSIONS.VM_SNAPSHOT, "vm", resourceId)

    if (denied) return denied

    const body = await req.json()

    const { name, description, vmstate } = body

    if (!name || typeof name !== 'string') {
      return NextResponse.json({ error: "Snapshot name is required" }, { status: 400 })
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      return NextResponse.json({
        error: "Invalid snapshot name. Use only letters, numbers, dashes and underscores."
      }, { status: 400 })
    }

    const conn = await getConnection(connId)

    if (!conn) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 })
    }

    const apiPath = `/nodes/${encodeURIComponent(node)}/${type}/${vmid}/snapshot`
    
    const formData = new URLSearchParams()

    formData.append('snapname', name)
    if (description) formData.append('description', description)
    if (vmstate !== undefined) formData.append('vmstate', vmstate ? '1' : '0')

    const result = await pveFetch<string>(conn, apiPath, {
      method: 'POST',
      body: formData.toString(),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    })

    return NextResponse.json({
      data: {
        success: true,
        upid: result,
        message: `Snapshot '${name}' creation started`,
      }
    })
  } catch (e: any) {
    console.error("Snapshot create error:", e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

/**
 * DELETE /api/v1/guests/[vmid]/snapshots
 * Supprimer un snapshot
 * Query: ?name=snapshot_name
 */
export async function DELETE(
  req: Request,
  ctx: { params: Promise<Params> }
) {
  try {
    const params = await ctx.params
    const { connId, type, node, vmid } = parseVmKey(params.vmid)

    // RBAC: Check vm.snapshot permission
    const resourceId = buildVmResourceId(connId, node, type, vmid)
    const denied = await checkPermission(PERMISSIONS.VM_SNAPSHOT, "vm", resourceId)

    if (denied) return denied

    const url = new URL(req.url)
    const snapname = url.searchParams.get('name')

    if (!snapname) {
      return NextResponse.json({ error: "Snapshot name is required" }, { status: 400 })
    }

    const conn = await getConnection(connId)

    if (!conn) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 })
    }

    const apiPath = `/nodes/${encodeURIComponent(node)}/${type}/${vmid}/snapshot/${encodeURIComponent(snapname)}`
    
    const result = await pveFetch<string>(conn, apiPath, {
      method: 'DELETE',
    })

    return NextResponse.json({
      data: {
        success: true,
        upid: result,
        message: `Snapshot '${snapname}' deletion started`,
      }
    })
  } catch (e: any) {
    console.error("Snapshot delete error:", e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
