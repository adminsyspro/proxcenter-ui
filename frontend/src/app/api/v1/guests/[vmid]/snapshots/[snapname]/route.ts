import { NextResponse } from "next/server"

import { prisma } from "@/lib/db/prisma"
import { pveFetch } from "@/lib/proxmox/client"
import { decryptSecret } from "@/lib/crypto/secret"
import { checkPermission, buildVmResourceId, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

type Params = {
  vmid: string // Format: connId:type:node:vmid
  snapname: string
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
 * POST /api/v1/guests/[vmid]/snapshots/[snapname]
 * Rollback vers un snapshot
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<Params> }
) {
  try {
    const params = await ctx.params
    const { connId, type, node, vmid } = parseVmKey(params.vmid)
    const snapname = params.snapname

    // RBAC: Check vm.snapshot permission for rollback
    const resourceId = buildVmResourceId(connId, node, type, vmid)
    const denied = await checkPermission(PERMISSIONS.VM_SNAPSHOT, "vm", resourceId)

    if (denied) return denied

    const conn = await getConnection(connId)

    if (!conn) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 })
    }

    const apiPath = `/nodes/${encodeURIComponent(node)}/${type}/${vmid}/snapshot/${encodeURIComponent(snapname)}/rollback`
    
    const result = await pveFetch<string>(conn, apiPath, {
      method: 'POST',
    })

    return NextResponse.json({
      data: {
        success: true,
        upid: result,
        message: `Rollback to snapshot '${snapname}' started`,
      }
    })
  } catch (e: any) {
    console.error("Snapshot rollback error:", e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

/**
 * PUT /api/v1/guests/[vmid]/snapshots/[snapname]
 * Mettre à jour la description d'un snapshot
 * Body: { description: string }
 */
export async function PUT(
  req: Request,
  ctx: { params: Promise<Params> }
) {
  try {
    const params = await ctx.params
    const { connId, type, node, vmid } = parseVmKey(params.vmid)
    const snapname = params.snapname

    // RBAC: Check vm.snapshot permission
    const resourceId = buildVmResourceId(connId, node, type, vmid)
    const denied = await checkPermission(PERMISSIONS.VM_SNAPSHOT, "vm", resourceId)

    if (denied) return denied

    const body = await req.json()

    const { description } = body

    const conn = await getConnection(connId)

    if (!conn) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 })
    }

    const apiPath = `/nodes/${encodeURIComponent(node)}/${type}/${vmid}/snapshot/${encodeURIComponent(snapname)}/config`
    
    const formData = new URLSearchParams()

    formData.append('description', description || '')
    
    await pveFetch<any>(conn, apiPath, {
      method: 'PUT',
      body: formData.toString(),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    })

    return NextResponse.json({
      data: {
        success: true,
        message: `Snapshot '${snapname}' description updated`,
      }
    })
  } catch (e: any) {
    console.error("Snapshot update error:", e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
