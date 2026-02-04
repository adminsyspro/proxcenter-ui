import { NextResponse } from "next/server"
import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"

export const runtime = "nodejs"

// GET - Liste les jobs de réplication avec infos complémentaires
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string; node: string }> }
) {
  const { id, node } = await ctx.params
  const url = new URL(req.url)
  const guest = url.searchParams.get('guest')

  const conn = await getConnectionById(id)
  if (!conn) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 })
  }

  try {
    // Récupérer tous les jobs de réplication du nœud
    const jobs = await pveFetch<any[]>(
      conn,
      `/nodes/${encodeURIComponent(node)}/replication`
    ) || []

    // Filtrer par guest si spécifié
    const filteredJobs = guest 
      ? jobs.filter((j: any) => String(j.guest) === String(guest))
      : jobs

    // Récupérer la liste des nodes pour le target
    const nodes = await pveFetch<any[]>(conn, '/nodes', { method: "GET" }).catch(() => [])
    
    // Récupérer la liste des VMs/CTs pour le sélecteur
    const vms = await pveFetch<any[]>(
      conn,
      `/nodes/${encodeURIComponent(node)}/qemu`,
      { method: "GET" }
    ).catch(() => [])
    
    const cts = await pveFetch<any[]>(
      conn,
      `/nodes/${encodeURIComponent(node)}/lxc`,
      { method: "GET" }
    ).catch(() => [])

    // Formater les jobs
    const formattedJobs = filteredJobs.map((job: any) => ({
      id: job.id,
      type: job.type,
      guest: job.guest,
      target: job.target,
      schedule: job.schedule,
      rate: job.rate,
      comment: job.comment,
      enabled: job.disable !== 1,
      // Status info
      lastSync: job.last_sync,
      lastTry: job.last_try,
      nextSync: job.next_sync,
      duration: job.duration,
      failCount: job.fail_count,
      error: job.error,
      state: job.fail_count > 0 ? 'error' : (job.last_sync ? 'ok' : 'unknown'),
    }))

    return NextResponse.json({ 
      data: {
        jobs: formattedJobs,
        nodes: Array.isArray(nodes) ? nodes.map((n: any) => ({ 
          node: n.node, 
          status: n.status,
          online: n.status === 'online'
        })).filter((n: any) => n.node !== node) : [],
        guests: [
          ...((Array.isArray(vms) ? vms : []).map((vm: any) => ({ 
            vmid: vm.vmid, 
            name: vm.name, 
            type: 'qemu',
            status: vm.status
          }))),
          ...((Array.isArray(cts) ? cts : []).map((ct: any) => ({ 
            vmid: ct.vmid, 
            name: ct.name, 
            type: 'lxc',
            status: ct.status
          })))
        ].sort((a, b) => a.vmid - b.vmid)
      }
    })
  } catch (error: any) {
    console.error(`Error fetching replication jobs:`, error)
    return NextResponse.json({ 
      error: error.message || "Failed to fetch replication jobs",
      data: { jobs: [], nodes: [], guests: [] }
    }, { status: 500 })
  }
}

// POST - Créer un nouveau job de réplication
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string; node: string }> }
) {
  const { id } = await ctx.params

  const conn = await getConnectionById(id)
  if (!conn) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 })
  }

  try {
    const body = await req.json()
    const { guest, target, schedule, rate, comment, enabled } = body

    if (!guest || !target) {
      return NextResponse.json({ error: "guest and target are required" }, { status: 400 })
    }

    // Trouver un numéro de job disponible pour ce guest
    // Format de l'ID: vmid-jobnum (ex: 100-0, 100-1, etc.)
    const existingJobs = await pveFetch<any[]>(conn, '/cluster/replication').catch(() => [])
    let jobNum = 0
    if (Array.isArray(existingJobs)) {
      const guestJobs = existingJobs.filter((j: any) => String(j.guest) === String(guest))
      if (guestJobs.length > 0) {
        const usedNums = guestJobs.map((j: any) => {
          const parts = String(j.id).split('-')
          return parseInt(parts[1] || '0')
        })
        jobNum = Math.max(...usedNums) + 1
      }
    }

    // Construire les paramètres pour l'API Proxmox
    const params: Record<string, string> = {
      id: `${guest}-${jobNum}`,
      target,
      type: 'local',
    }

    if (schedule) params.schedule = schedule
    if (rate) params.rate = String(rate)
    if (comment) params.comment = comment
    if (enabled === false) params.disable = '1'

    // Créer le job de réplication via l'API cluster
    const result = await pveFetch(
      conn,
      `/cluster/replication`,
      {
        method: 'POST',
        body: new URLSearchParams(params),
      }
    )

    return NextResponse.json({ data: result, success: true })
  } catch (error: any) {
    console.error(`Error creating replication job:`, error)
    return NextResponse.json({ 
      error: error.message || "Failed to create replication job"
    }, { status: 500 })
  }
}

// PUT - Modifier un job de réplication existant
export async function PUT(
  req: Request,
  ctx: { params: Promise<{ id: string; node: string }> }
) {
  const { id } = await ctx.params

  const conn = await getConnectionById(id)
  if (!conn) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 })
  }

  try {
    const body = await req.json()
    const { jobId, schedule, rate, comment, enabled } = body

    if (!jobId) {
      return NextResponse.json({ error: "jobId is required" }, { status: 400 })
    }

    // Construire les paramètres
    const params: Record<string, string> = {}
    if (schedule !== undefined) params.schedule = schedule
    if (rate !== undefined) params.rate = String(rate)
    if (comment !== undefined) params.comment = comment
    if (enabled !== undefined) params.disable = enabled ? '0' : '1'

    // Modifier le job via l'API cluster
    await pveFetch(
      conn,
      `/cluster/replication/${encodeURIComponent(jobId)}`,
      {
        method: 'PUT',
        body: new URLSearchParams(params),
      }
    )

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error(`Error updating replication job:`, error)
    return NextResponse.json({ 
      error: error.message || "Failed to update replication job"
    }, { status: 500 })
  }
}

// DELETE - Supprimer un job de réplication
export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string; node: string }> }
) {
  const { id } = await ctx.params
  const url = new URL(req.url)
  const jobId = url.searchParams.get('jobId')

  if (!jobId) {
    return NextResponse.json({ error: "jobId is required" }, { status: 400 })
  }

  const conn = await getConnectionById(id)
  if (!conn) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 })
  }

  try {
    await pveFetch(
      conn,
      `/cluster/replication/${encodeURIComponent(jobId)}`,
      { method: 'DELETE' }
    )

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error(`Error deleting replication job:`, error)
    return NextResponse.json({ 
      error: error.message || "Failed to delete replication job"
    }, { status: 500 })
  }
}
