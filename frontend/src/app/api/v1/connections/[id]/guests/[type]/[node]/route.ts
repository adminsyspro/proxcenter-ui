import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"

export const runtime = "nodejs"

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

    const conn = await getConnectionById(id)
    const body = await req.json()

    // Valider les champs requis
    if (!body.vmid) {
      return NextResponse.json({ error: "vmid is required" }, { status: 400 })
    }

    // Construire l'URL Proxmox
    const endpoint = `/nodes/${encodeURIComponent(node)}/${type}`

    // Appeler l'API Proxmox pour créer la VM/LXC
    const result = await pveFetch<any>(conn, endpoint, {
      method: "POST",
      body: JSON.stringify(body),
      headers: {
        'Content-Type': 'application/json'
      }
    })

    return NextResponse.json({ 
      data: result,
      message: `${type === 'qemu' ? 'VM' : 'Container'} creation started`
    })
  } catch (e: any) {
    console.error('Error creating guest:', e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
