import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { haSidGuest, sessionGuestVisibility, type GuestVisibility } from "@/lib/vdc/guestGuard"

export const runtime = "nodejs"

/** Whether an HA service id (vm:100, ct:101) names a guest the session may see. */
function visibleSid(visible: GuestVisibility, sid: unknown): boolean {
  const guest = haSidGuest(sid)
  return guest !== null && visible.has(guest.type, guest.vmid)
}

/** A rule is shown when every guest it binds (`resources`, a sid list) is visible. */
function visibleRule(visible: GuestVisibility, rule: any): boolean {
  return String(rule?.resources ?? "").split(",").map(s => s.trim()).filter(Boolean).every(sid => visibleSid(visible, sid))
}

// GET /api/v1/connections/{id}/ha
// Récupère les ressources HA, les groupes HA (PVE 8) ou les règles d'affinité (PVE 9)
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await ctx.params

    // Vérifier la permission de voir la connexion
    const permError = await checkPermission(PERMISSIONS.CONNECTION_VIEW, "connection", id)

    if (permError) return permError

    const conn = await getConnectionById(id)

    // A vDC session only sees the HA rows of the guests in its pools: the
    // services, their live status and the rules that bind them. Groups name
    // nodes, not guests, and stay as they are.
    const scoped = await sessionGuestVisibility({ connectionId: id, conn })
    if (!scoped.ok) return scoped.response
    const visible = scoped.visibility

    // Récupérer les ressources HA, les groupes et les règles en parallèle
    const [resourcesResult, groupsResult, rulesResult, versionResult, statusResult] = await Promise.allSettled([
      pveFetch<any[]>(conn, '/cluster/ha/resources'),
      pveFetch<any[]>(conn, '/cluster/ha/groups'),
      pveFetch<any[]>(conn, '/cluster/ha/rules'), // PVE 9+ uniquement
      pveFetch<any>(conn, '/version'),
      pveFetch<any[]>(conn, '/cluster/ha/status/current'),
    ])

    const resources = (resourcesResult.status === 'fulfilled' ? resourcesResult.value || [] : [])
      .filter((r: any) => visible.all || visibleSid(visible, r?.sid))
    const groups = groupsResult.status === 'fulfilled' ? groupsResult.value || [] : []

    // Vérifier si les règles sont supportées (PVE 9+)
    const rulesSupported = rulesResult.status === 'fulfilled'
    const rules = (rulesSupported ? rulesResult.value || [] : [])
      .filter((rule: any) => visible.all || visibleRule(visible, rule))
    
    // Extraire la version de PVE
    let pveVersion = '8.0.0'

    if (versionResult.status === 'fulfilled' && versionResult.value) {
      pveVersion = versionResult.value.version || versionResult.value.release || '8.0.0'
    }
    
    // Déterminer la version majeure (8 ou 9)
    const majorVersion = Number.parseInt(pveVersion.split('.')[0], 10) || 8

    // Status rows: quorum, master and lrm rows carry no sid and stay; service rows are masked.
    const status = (statusResult.status === 'fulfilled' ? statusResult.value || [] : [])
      .filter((row: any) => visible.all || row?.sid === undefined || visibleSid(visible, row.sid))

    return NextResponse.json({
      data: {
        resources,
        groups,
        rules,
        status,
        pveVersion,
        majorVersion,
        rulesSupported, // true si PVE 9+
      }
    })
  } catch (e: any) {
    console.error('Error fetching HA:', e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
