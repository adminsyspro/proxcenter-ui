import { NextResponse } from "next/server"

import { pbsFetch } from "@/lib/proxmox/pbs-client"
import { getPbsConnectionById } from "@/lib/connections/getConnection"
import { formatBytes } from "@/utils/format"

export const runtime = "nodejs"

// GET /api/v1/pbs/[id]/backups/[backupId]/content
// backupId format: datastore/type/vmid/timestamp (URL encoded)
export async function GET(
  req: Request, 
  ctx: { params: Promise<{ id: string; backupId: string }> | { id: string; backupId: string } }
) {
  try {
    const params = await Promise.resolve(ctx.params)
    const id = (params as any)?.id
    const backupId = (params as any)?.backupId
    
    if (!id) return NextResponse.json({ error: "Missing params.id" }, { status: 400 })
    if (!backupId) return NextResponse.json({ error: "Missing params.backupId" }, { status: 400 })

    // Décoder le backupId: datastore/type/vmid/timestamp
    const decodedBackupId = decodeURIComponent(backupId)
    const parts = decodedBackupId.split('/')
    
    if (parts.length < 4) {
      return NextResponse.json({ error: "Invalid backupId format. Expected: datastore/type/vmid/timestamp" }, { status: 400 })
    }

    const [datastore, backupType, vmid, timestamp] = parts

    const url = new URL(req.url)
    const filepath = url.searchParams.get('filepath') || '/' // Chemin à explorer
    const archiveName = url.searchParams.get('archive') // Nom de l'archive (ex: "root.pxar.didx")

    const conn = await getPbsConnectionById(id)

    // Si pas d'archive spécifiée, lister les fichiers/archives du backup
    if (!archiveName) {
      // Récupérer les infos du snapshot pour avoir la liste des fichiers
      const snapshots = await pbsFetch<any[]>(
        conn,
        `/admin/datastore/${encodeURIComponent(datastore)}/snapshots?backup-type=${encodeURIComponent(backupType)}&backup-id=${encodeURIComponent(vmid)}`
      )

      const snapshot = snapshots?.find(s => String(s['backup-time']) === timestamp)
      
      if (!snapshot) {
        return NextResponse.json({ error: "Snapshot not found" }, { status: 404 })
      }

      // Retourner la liste des archives/fichiers du backup
      const files = (snapshot.files || []).map((file: any) => {
        const filename = typeof file === 'string' ? file : file.filename
        const isArchive = filename?.endsWith('.pxar.didx') || filename?.endsWith('.img.fidx')
        const isPxar = filename?.endsWith('.pxar.didx')
        
        return {
          name: filename,
          type: isArchive ? 'archive' : 'file',
          browsable: isPxar, // Seuls les .pxar peuvent être parcourus
          size: typeof file === 'object' ? file.size : 0,
          sizeFormatted: typeof file === 'object' ? formatBytes(file.size || 0) : '-',
        }
      })

      return NextResponse.json({
        data: {
          path: '/',
          files,
          snapshot: {
            datastore,
            backupType,
            backupId: vmid,
            backupTime: timestamp,
          }
        }
      })
    }

    // Si une archive est spécifiée, explorer son contenu via le catalog
    // L'API PBS pour explorer le contenu d'une archive pxar
    try {
      const catalogPath = `/admin/datastore/${encodeURIComponent(datastore)}/catalog`
      
      const catalogParams = new URLSearchParams({
        'backup-type': backupType,
        'backup-id': vmid,
        'backup-time': timestamp,
        'filepath': archiveName + filepath, // ex: "root.pxar.didx/etc"
      })

      const catalog = await pbsFetch<any[]>(conn, `${catalogPath}?${catalogParams}`)

      // Transformer les entrées du catalogue
      const entries = (catalog || []).map((entry: any) => {
        const isDir = entry.type === 'd' || entry.leaf === false
        const isFile = entry.type === 'f' || entry.leaf === true
        const isSymlink = entry.type === 'l'
        const isHardlink = entry.type === 'h'

        return {
          name: entry.filename || entry.text || entry.name,
          type: isDir ? 'directory' : isSymlink ? 'symlink' : isHardlink ? 'hardlink' : 'file',
          size: entry.size || 0,
          sizeFormatted: formatBytes(entry.size || 0),
          mtime: entry.mtime,
          mtimeFormatted: entry.mtime ? new Date(entry.mtime * 1000).toLocaleString('fr-FR') : '-',
          leaf: entry.leaf,
        }
      })

      // Trier: dossiers d'abord, puis fichiers par nom
      entries.sort((a: any, b: any) => {
        if (a.type === 'directory' && b.type !== 'directory') return -1
        if (a.type !== 'directory' && b.type === 'directory') return 1
        
return (a.name || '').localeCompare(b.name || '')
      })

      return NextResponse.json({
        data: {
          path: filepath,
          archive: archiveName,
          files: entries,
          snapshot: {
            datastore,
            backupType,
            backupId: vmid,
            backupTime: timestamp,
          }
        }
      })
    } catch (catalogError: any) {
      console.error("Catalog error:", catalogError)
      
return NextResponse.json({ 
        error: `Cannot browse archive: ${catalogError.message}`,
        data: {
          path: filepath,
          archive: archiveName,
          files: [],
          snapshot: {
            datastore,
            backupType,
            backupId: vmid,
            backupTime: timestamp,
          }
        }
      }, { status: 200 }) // Retourner 200 avec liste vide plutôt qu'une erreur
    }

  } catch (e: any) {
    console.error("PBS backup content error:", e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
