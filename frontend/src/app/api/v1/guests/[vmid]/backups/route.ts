import { NextResponse } from "next/server"

import { prisma } from "@/lib/db/prisma"
import { pbsFetch } from "@/lib/proxmox/pbs-client"
import { decryptSecret } from "@/lib/crypto/secret"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))

  
return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

/**
 * GET /api/v1/guests/[vmid]/backups
 * 
 * Récupère toutes les sauvegardes d'une VM depuis tous les PBS configurés.
 * 
 * Query params:
 * - type: 'vm' | 'ct' (optionnel, pour filtrer par type)
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ vmid: string }> | { vmid: string } }
) {
  try {
    const params = await Promise.resolve(ctx.params)
    const vmid = (params as any)?.vmid

    if (!vmid) {
      return NextResponse.json({ error: "Missing vmid parameter" }, { status: 400 })
    }

    // RBAC: Check backup.view permission
    const denied = await checkPermission(PERMISSIONS.BACKUP_VIEW)

    if (denied) return denied

    const url = new URL(req.url)
    const typeFilter = url.searchParams.get('type') // 'vm' | 'ct'

    // Récupérer toutes les connexions PBS
    const pbsConnections = await prisma.connection.findMany({
      where: { type: 'pbs' },
      select: {
        id: true,
        name: true,
        baseUrl: true,
        insecureTLS: true,
        apiTokenEnc: true,
      }
    })

    if (pbsConnections.length === 0) {
      return NextResponse.json({
        data: {
          backups: [],
          stats: { total: 0, totalSize: 0, totalSizeFormatted: '0 B' },
          message: "Aucun serveur PBS configuré"
        }
      })
    }

    const allBackups: any[] = []

    // Interroger chaque PBS en parallèle
    const pbsPromises = pbsConnections.map(async (pbs) => {
      if (!pbs.apiTokenEnc || !pbs.baseUrl) return []

      const conn = {
        id: pbs.id,
        name: pbs.name,
        baseUrl: pbs.baseUrl,
        apiToken: decryptSecret(pbs.apiTokenEnc),
        insecureDev: !!pbs.insecureTLS,
      }

      try {
        // Récupérer la liste des datastores
        const datastores = await pbsFetch<any[]>(conn, "/admin/datastore")

        // Pour chaque datastore, chercher les backups de cette VM
        const datastorePromises = (datastores || []).map(async (ds) => {
          const storeName = ds.store || ds.name

          if (!storeName) return []

          try {
            // Récupérer tous les snapshots et filtrer par backup-id (vmid)
            const snapshots = await pbsFetch<any[]>(
              conn,
              `/admin/datastore/${encodeURIComponent(storeName)}/snapshots`
            )

            return (snapshots || [])
              .filter(snap => {
                // Le backup-id correspond au VMID
                const backupId = String(snap['backup-id'] || '')
                const matchVmid = backupId === String(vmid)
                
                // Filtrer par type si spécifié
                const matchType = !typeFilter || snap['backup-type'] === typeFilter
                
                return matchVmid && matchType
              })
              .map(snap => {
                const backupTime = snap['backup-time']
                  ? new Date(snap['backup-time'] * 1000)
                  : null

                // Construire le volume ID au format PVE
                // Format attendu par PVE: "backup/type/vmid/YYYY-MM-DDTHH:MM:SSZ"
                // PVE attend le timestamp en format ISO 8601, pas en Unix timestamp
                const backupTimeIso = backupTime?.toISOString().replace(/\.\d{3}Z$/, 'Z') || ''
                const backupPath = `backup/${snap['backup-type']}/${snap['backup-id']}/${backupTimeIso}`

                return {
                  id: `${storeName}/${snap['backup-type']}/${snap['backup-id']}/${snap['backup-time']}`,

                  // Infos PBS
                  pbsId: pbs.id,
                  pbsName: pbs.name,
                  pbsUrl: pbs.baseUrl,

                  // Infos datastore
                  datastore: storeName,

                  // Path pour construire le volid PVE (sans le storage prefix)
                  backupPath,

                  // Infos backup
                  backupType: snap['backup-type'],
                  backupId: snap['backup-id'],
                  vmName: snap.comment || '',
                  backupTime: snap['backup-time'] || 0,
                  backupTimeFormatted: backupTime?.toLocaleString('fr-FR') || '-',
                  backupTimeIso: backupTimeIso,

                  // Taille
                  size: snap.size || 0,
                  sizeFormatted: formatBytes(snap.size || 0),

                  // Fichiers
                  files: snap.files || [],
                  fileCount: snap.files?.length || 0,

                  // Vérification
                  verification: snap.verification || null,
                  verified: snap.verification?.state === 'ok',
                  verifiedAt: snap.verification?.upid
                    ? new Date((snap.verification['last-run'] || 0) * 1000).toLocaleString('fr-FR')
                    : null,

                  // Protection
                  protected: snap.protected || false,

                  // Owner
                  owner: snap.owner || '',
                  comment: snap.comment || '',
                }
              })
          } catch (e) {
            console.warn(`Failed to get snapshots for ${pbs.name}/${storeName}:`, e)
            
return []
          }
        })

        const results = await Promise.all(datastorePromises)

        
return results.flat()
      } catch (e) {
        console.warn(`Failed to query PBS ${pbs.name}:`, e)
        
return []
      }
    })

    const results = await Promise.all(pbsPromises)

    results.forEach(backups => allBackups.push(...backups))

    // Trier par date (plus récent en premier)
    allBackups.sort((a, b) => b.backupTime - a.backupTime)

    // Stats
    const totalSize = allBackups.reduce((sum, b) => sum + (b.size || 0), 0)

    const stats = {
      total: allBackups.length,
      totalSize,
      totalSizeFormatted: formatBytes(totalSize),
      verifiedCount: allBackups.filter(b => b.verified).length,
      protectedCount: allBackups.filter(b => b.protected).length,
      oldestBackup: allBackups.length > 0 ? allBackups[allBackups.length - 1].backupTimeFormatted : null,
      newestBackup: allBackups.length > 0 ? allBackups[0].backupTimeFormatted : null,
    }

    return NextResponse.json({
      data: {
        vmid,
        backups: allBackups,
        stats,
      }
    })
  } catch (e: any) {
    console.error("Guest backups error:", e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
