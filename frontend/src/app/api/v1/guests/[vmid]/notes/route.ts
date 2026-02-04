import { NextResponse } from "next/server"

import { prisma } from "@/lib/db/prisma"
import { pveFetch } from "@/lib/proxmox/client"
import { decryptSecret } from "@/lib/crypto/secret"

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
 * GET /api/v1/guests/[vmid]/notes
 * Récupère les notes (description) d'une VM depuis Proxmox
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<Params> }
) {
  try {
    const params = await ctx.params
    const { connId, type, node, vmid } = parseVmKey(params.vmid)

    const conn = await getConnection(connId)

    if (!conn) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 })
    }

    const apiPath = `/nodes/${encodeURIComponent(node)}/${type}/${vmid}/config`
    const config = await pveFetch<any>(conn, apiPath)

    const description = config?.description || ''

    return NextResponse.json({
      data: {
        content: description,
      }
    })
  } catch (e: any) {
    console.error("Get notes error:", e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

/**
 * PUT /api/v1/guests/[vmid]/notes
 * Met à jour les notes (description) d'une VM dans Proxmox
 * Body: { content: string }
 */
export async function PUT(
  req: Request,
  ctx: { params: Promise<Params> }
) {
  try {
    const params = await ctx.params
    const { connId, type, node, vmid } = parseVmKey(params.vmid)
    const body = await req.json()

    const { content } = body

    if (typeof content !== 'string') {
      return NextResponse.json({ error: "Content must be a string" }, { status: 400 })
    }

    const conn = await getConnection(connId)

    if (!conn) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 })
    }

    const apiPath = `/nodes/${encodeURIComponent(node)}/${type}/${vmid}/config`
    
    const formData = new URLSearchParams()

    formData.append('description', content)
    
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
        content,
      }
    })
  } catch (e: any) {
    console.error("Update notes error:", e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
