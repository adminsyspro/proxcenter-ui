import { NextResponse } from "next/server"

import { pbsFetch } from "@/lib/proxmox/pbs-client"
import { getPbsConnectionById } from "@/lib/connections/getConnection"

export const runtime = "nodejs"

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))

  
return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> | { id: string } }) {
  try {
    const params = await Promise.resolve(ctx.params)
    const id = (params as any)?.id

    if (!id) return NextResponse.json({ error: "Missing params.id" }, { status: 400 })

    const url = new URL(req.url)
    const datastoreFilter = url.searchParams.get('datastore')
    const typeFilter = url.searchParams.get('type') // 'vm' | 'ct' | 'host'
    const page = parseInt(url.searchParams.get('page') || '1', 10)
    const pageSize = parseInt(url.searchParams.get('pageSize') || '50', 10)
    const search = url.searchParams.get('search')?.toLowerCase() || ''

    const conn = await getPbsConnectionById(id)

    // Récupérer la liste des datastores
    const datastores = await pbsFetch<any[]>(conn, "/admin/datastore")

    // PBS utilise "store" comme nom du datastore
    const targetDatastores = datastoreFilter
      ? datastores.filter(ds => (ds.store || ds.name) === datastoreFilter)
      : datastores

    // Récupérer les snapshots de chaque datastore EN PARALLÈLE
    // L'endpoint /snapshots sans paramètres retourne TOUS les snapshots du datastore
    const allBackups: any[] = []

    const datastorePromises = targetDatastores.map(async (ds) => {
      const storeName = ds.store || ds.name

      if (!storeName) return []

      try {
        // Récupérer tous les snapshots du datastore en une seule requête
        const snapshots = await pbsFetch<any[]>(
          conn, 
          `/admin/datastore/${encodeURIComponent(storeName)}/snapshots`
        )

        return (snapshots || []).map(snap => {
          const backupTime = snap['backup-time'] 
            ? new Date(snap['backup-time'] * 1000)
            : null

          // Extraire le nom de la VM depuis le comment ou backup-id
          // PBS stocke souvent le nom dans le format "VM Name (VMID)" ou juste dans comment
          const vmName = snap.comment || ''

          return {
            id: `${storeName}/${snap['backup-type']}/${snap['backup-id']}/${snap['backup-time']}`,
            datastore: storeName,
            backupType: snap['backup-type'],
            backupId: snap['backup-id'],
            vmName: vmName,
            backupTime: snap['backup-time'] || 0,
            backupTimeFormatted: backupTime?.toLocaleString('fr-FR') || '-',
            backupTimeIso: backupTime?.toISOString() || '',

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
        console.warn(`Failed to get snapshots for datastore ${storeName}:`, e)
        
return []
      }
    })

    const results = await Promise.all(datastorePromises)

    results.forEach(backups => allBackups.push(...backups))

    // Filtrer par type
    let filteredBackups = typeFilter
      ? allBackups.filter(b => b.backupType === typeFilter)
      : allBackups

    // Filtrer par recherche (ID, nom VM, datastore, commentaire)
    if (search) {
      filteredBackups = filteredBackups.filter(b =>
        b.backupId?.toLowerCase().includes(search) ||
        b.vmName?.toLowerCase().includes(search) ||
        b.datastore?.toLowerCase().includes(search) ||
        b.comment?.toLowerCase().includes(search)
      )
    }

    // Trier par date (plus récent en premier)
    filteredBackups.sort((a, b) => b.backupTime - a.backupTime)

    // Stats globales (avant pagination)
    const totalSize = filteredBackups.reduce((sum, b) => sum + (b.size || 0), 0)

    const stats = {
      total: filteredBackups.length,
      vmCount: filteredBackups.filter(b => b.backupType === 'vm').length,
      ctCount: filteredBackups.filter(b => b.backupType === 'ct').length,
      hostCount: filteredBackups.filter(b => b.backupType === 'host').length,
      totalSize,
      totalSizeFormatted: formatBytes(totalSize),
      verifiedCount: filteredBackups.filter(b => b.verified).length,
      protectedCount: filteredBackups.filter(b => b.protected).length,
    }

    // Pagination
    const totalPages = Math.ceil(filteredBackups.length / pageSize)
    const startIndex = (page - 1) * pageSize
    const paginatedBackups = filteredBackups.slice(startIndex, startIndex + pageSize)

    return NextResponse.json({
      data: {
        backups: paginatedBackups,
        stats,
        pagination: {
          page,
          pageSize,
          totalPages,
          totalItems: filteredBackups.length,
          hasNext: page < totalPages,
          hasPrev: page > 1,
        }
      }
    })
  } catch (e: any) {
    console.error("PBS backups error:", e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
