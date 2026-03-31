import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, buildNodeResourceId, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

/**
 * GET /api/v1/connections/[id]/nodes/[node]/apt
 * Récupère la liste des mises à jour disponibles pour un node
 * 
 * Proxmox API: GET /nodes/{node}/apt/update
 * Retourne: [{ Package, Title, Description, OldVersion, Version, Origin, ... }, ...]
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string; node: string }> }
) {
  try {
    const { id, node } = await ctx.params

    // RBAC: Check node.view permission
    const resourceId = buildNodeResourceId(id, node)
    const denied = await checkPermission(PERMISSIONS.NODE_VIEW, "node", resourceId)

    if (denied) return denied

    const conn = await getConnectionById(id)

    // Proxmox: GET /nodes/{node}/apt/update
    // Note: Cette API retourne les mises à jour disponibles après un apt update
    // Note: Le nom du node doit correspondre exactement (sensible à la casse)
    let updates: any[] = []
    
    try {
      updates = await pveFetch<any[]>(
        conn,
        `/nodes/${encodeURIComponent(node)}/apt/update`,
        { method: "GET" }
      ) || []
    } catch (aptError: any) {
      // Si l'erreur est liée aux permissions ou à l'absence de liste de paquets,
      // retourner une liste vide plutôt qu'une erreur 500
      const errMsg = aptError?.message || String(aptError)
      if (errMsg.includes('no package') || errMsg.includes('apt update') || errMsg.includes('596')) {
        // 596 = Proxmox "apt update not run yet" — package lists are stale/empty
        // Tell the frontend to trigger an apt update first
        return NextResponse.json({
          data: [],
          count: 0,
          needsRefresh: true,
          warning: 'Package list not available. Run apt update first.'
        })
      }
      if (errMsg.includes('403') || errMsg.includes('Permission')) {
        return NextResponse.json({
          data: [],
          count: 0,
          warning: 'Insufficient permissions to check updates.'
        })
      }
      throw aptError
    }

    // Formater les données pour le frontend
    const formattedData = (updates || []).map((pkg: any) => ({
      package: pkg.Package || pkg.package || 'Unknown',
      title: pkg.Title || pkg.title || null,
      description: pkg.Description || pkg.description || null,
      currentVersion: pkg.OldVersion || pkg.oldversion || null,
      newVersion: pkg.Version || pkg.version || null,
      origin: pkg.Origin || pkg.origin || null,
      priority: pkg.Priority || pkg.priority || null,
      section: pkg.Section || pkg.section || null,
    }))

    return NextResponse.json({ 
      data: formattedData,
      count: formattedData.length 
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

/**
 * POST /api/v1/connections/[id]/nodes/[node]/apt
 * Lance un apt update sur le node (refresh de la liste des paquets)
 * 
 * Proxmox API: POST /nodes/{node}/apt/update
 */
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string; node: string }> }
) {
  try {
    const { id, node } = await ctx.params

    // RBAC: Check node.manage permission pour lancer un apt update
    const resourceId = buildNodeResourceId(id, node)
    const denied = await checkPermission(PERMISSIONS.NODE_MANAGE, "node", resourceId)

    if (denied) return denied

    const conn = await getConnectionById(id)

    // Proxmox: POST /nodes/{node}/apt/update
    // Lance un apt update et retourne un UPID de tâche
    const result = await pveFetch<any>(
      conn,
      `/nodes/${encodeURIComponent(node)}/apt/update`,
      { method: "POST" }
    )

    // Wait for the apt update task to complete (poll task status)
    const upid = typeof result === 'string' ? result : result?.data
    if (upid) {
      const maxWait = 30_000 // 30s max
      const interval = 2_000
      const start = Date.now()
      while (Date.now() - start < maxWait) {
        await new Promise(r => setTimeout(r, interval))
        try {
          const taskStatus = await pveFetch<any>(
            conn,
            `/nodes/${encodeURIComponent(node)}/tasks/${encodeURIComponent(upid)}/status`,
            { method: "GET" }
          )
          if (taskStatus?.status === 'stopped') break
        } catch {
          break
        }
      }
    }

    return NextResponse.json({ data: result })
  } catch (e: any) {
    const errMsg = e?.message || String(e)
    // PVE 403 = token/user lacks Sys.Modify on the node
    if (errMsg.includes('403') || errMsg.includes('Permission') || errMsg.includes('Sys.Modify')) {
      return NextResponse.json({
        error: 'permissionDenied',
        requiredPermission: 'Sys.Modify',
        message: 'The Proxmox API token does not have the Sys.Modify permission on this node, which is required to refresh package lists.'
      }, { status: 403 })
    }
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
