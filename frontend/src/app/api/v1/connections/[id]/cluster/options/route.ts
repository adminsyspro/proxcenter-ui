import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"

export const runtime = "nodejs"

// GET - Récupérer les options du datacenter (inclut les notes/description)
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> | { id: string } }) {
  try {
    const params = await Promise.resolve(ctx.params)
    const id = (params as any)?.id

    if (!id) return NextResponse.json({ error: "Missing params.id" }, { status: 400 })

    const conn = await getConnectionById(id)

    // Récupérer les options du datacenter
    const options = await pveFetch<any>(conn, "/cluster/options")

    return NextResponse.json({
      data: options || {}
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

// PUT - Mettre à jour les options du datacenter (notes/description)
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> | { id: string } }) {
  try {
    const params = await Promise.resolve(ctx.params)
    const id = (params as any)?.id

    if (!id) return NextResponse.json({ error: "Missing params.id" }, { status: 400 })

    const body = await req.json()
    const conn = await getConnectionById(id)

    // Construire les paramètres à envoyer
    const updateParams = new URLSearchParams()
    
    if (body.description !== undefined) {
      updateParams.set('description', body.description)
    }

    // Mettre à jour les options via PUT
    await pveFetch<any>(conn, "/cluster/options", {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: updateParams.toString(),
    })

    return NextResponse.json({
      data: { success: true }
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
