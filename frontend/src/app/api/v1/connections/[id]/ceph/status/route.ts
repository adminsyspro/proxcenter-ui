import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"

export const runtime = "nodejs"

// GET - Récupérer le status complet de Ceph
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> | { id: string } }) {
  try {
    const params = await Promise.resolve(ctx.params)
    const id = (params as any)?.id

    if (!id) return NextResponse.json({ error: "Missing params.id" }, { status: 400 })

    const conn = await getConnectionById(id)

    // Récupérer d'abord la liste des nodes pour trouver un node avec Ceph
    const nodes = await pveFetch<any[]>(conn, "/nodes")
    const firstNode = nodes[0]?.node

    if (!firstNode) {
      return NextResponse.json({ error: "No nodes found" }, { status: 404 })
    }

    // Essayer de récupérer le status Ceph depuis le premier node
    try {
      const status = await pveFetch<any>(conn, `/nodes/${encodeURIComponent(firstNode)}/ceph/status`)
      
      // Récupérer aussi la version Ceph
      let version = null
      try {
        version = status?.versions?.overall?.version || 
                  status?.version || 
                  null
      } catch {
        // Ignore version fetch errors
      }

      // Normaliser les données OSD (différentes structures selon les versions)
      const osdmap = status?.osdmap?.osdmap || status?.osdmap || {}
      
      // Normaliser les données MDS/fsmap - chercher dans toutes les structures possibles
      const fsmap = status?.fsmap || {}
      const mdsServers: any[] = []
      
      // 1. Chercher dans filesystems[].mdsmap.info (structure principale PVE 8+)
      if (fsmap?.filesystems) {
        for (const fs of fsmap.filesystems) {
          if (fs.mdsmap?.info) {
            for (const [key, mds] of Object.entries(fs.mdsmap.info as Record<string, any>)) {
              if (!mdsServers.find(m => m.name === mds.name)) {
                mdsServers.push({
                  name: mds.name,
                  state: mds.state || 'active',
                  addr: mds.addr,
                  rank: mds.rank,
                })
              }
            }
          }
          // Aussi vérifier dans standby_count_wanted et up:standby
          if (fs.mdsmap?.up) {
            for (const [key, gid] of Object.entries(fs.mdsmap.up as Record<string, any>)) {
              // up contient des références aux MDS actifs
            }
          }
        }
      }
      
      // 2. Chercher dans fsmap.standbys (MDS en standby)
      if (fsmap?.standbys) {
        for (const mds of fsmap.standbys) {
          if (!mdsServers.find(m => m.name === mds.name)) {
            mdsServers.push({
              name: mds.name,
              state: 'standby',
              addr: mds.addr,
              gid: mds.gid,
            })
          }
        }
      }

      // 3. Chercher dans fsmap.by_rank (structure alternative)
      if (fsmap?.by_rank && mdsServers.length === 0) {
        for (const mds of fsmap.by_rank) {
          mdsServers.push({
            name: mds.name,
            state: mds.status || 'active',
          })
        }
      }

      // 4. Essayer aussi de récupérer la liste des MDS depuis l'API dédiée
      try {
        const mdsData = await pveFetch<any[]>(conn, `/nodes/${encodeURIComponent(firstNode)}/ceph/mds`)
        if (mdsData && Array.isArray(mdsData)) {
          for (const mds of mdsData) {
            if (!mdsServers.find(m => m.name === mds.name)) {
              mdsServers.push({
                name: mds.name,
                state: mds.state || 'active',
                addr: mds.addr,
                host: mds.host,
              })
            }
          }
        }
      } catch {
        // L'API MDS peut ne pas exister
      }

      // Extraire les warnings/errors du health
      const healthChecks: any[] = []
      if (status?.health?.checks) {
        for (const [checkName, checkData] of Object.entries(status.health.checks as Record<string, any>)) {
          healthChecks.push({
            name: checkName,
            severity: checkData.severity,
            summary: checkData.summary?.message || checkData.message || checkName,
          })
        }
      }

      return NextResponse.json({
        data: {
          ...status,
          version,
          // Données normalisées pour faciliter l'affichage
          _normalized: {
            osd: {
              num_osds: osdmap.num_osds || 0,
              num_up_osds: osdmap.num_up_osds || 0,
              num_in_osds: osdmap.num_in_osds || 0,
            },
            mds: mdsServers,
            healthChecks,
          }
        }
      })
    } catch (e: any) {
      // Ceph n'est peut-être pas configuré
      if (e?.message?.includes('not found') || e?.message?.includes('500')) {
        return NextResponse.json({ 
          data: null,
          message: "Ceph not configured"
        })
      }
      throw e
    }
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
