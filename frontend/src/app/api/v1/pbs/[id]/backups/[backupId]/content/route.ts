import { NextResponse } from "next/server"
import { cookies } from "next/headers"

import { demoResponse } from "@/lib/demo/demo-api"
import { pbsFetch } from "@/lib/proxmox/pbs-client"
import { getPbsConnectionById, getPbsConnectionByIdUnscoped } from "@/lib/connections/getConnection"
import { formatBytes } from "@/utils/format"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { getDateLocale } from "@/lib/i18n/date"
import { assertVdcPbsAccess } from "@/lib/vdc/scope"

export const runtime = "nodejs"

// GET /api/v1/pbs/[id]/backups/[backupId]/content
// backupId format: datastore/type/vmid/timestamp (URL encoded)
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string; backupId: string }> | { id: string; backupId: string } }
) {
  const demo = demoResponse(req)

  if (demo) return demo

  try {
    const params = await Promise.resolve(ctx.params)
    const id = (params as any)?.id
    const backupId = (params as any)?.backupId

    if (!id) return NextResponse.json({ error: "Missing params.id" }, { status: 400 })
    if (!backupId) return NextResponse.json({ error: "Missing params.backupId" }, { status: 400 })

    const denied = await checkPermission(PERMISSIONS.BACKUP_VIEW, "pbs", id)

    if (denied) return denied

    const access = await assertVdcPbsAccess(id)

    if (access instanceof Response) return access

    const cookieStore = await cookies()
    const dateLocale = getDateLocale(cookieStore.get('NEXT_LOCALE')?.value || 'en')

    // Decode the backupId composed by /pbs/[id]/backups:
    //   <datastore>/[<namespace path>/]<backup-type>/<backup-id>/<backup-time>
    //
    // Sub-namespaces contain `/` (e.g. tenant-foo/vdc-bar), so a positional
    // split would assign them to backup-type/backup-id and PBS would 400
    // with "value is not defined in the enumeration". Anchor on the END of
    // the path instead — the last three segments are always typed:
    // [..., type, vmid, time].
    const decodedBackupId = decodeURIComponent(backupId)
    const parts = decodedBackupId.split('/')

    if (parts.length < 4) {
      return NextResponse.json({ error: "Invalid backupId format. Expected: datastore/[namespace/]type/vmid/timestamp" }, { status: 400 })
    }

    const datastore = parts[0]
    const timestamp = parts[parts.length - 1]
    const vmid = parts[parts.length - 2]
    const backupType = parts[parts.length - 3]
    const namespaceFromId = parts.slice(1, parts.length - 3).join('/')

    const url = new URL(req.url)
    const filepath = url.searchParams.get('filepath') || '/' // Chemin à explorer
    const archiveName = url.searchParams.get('archive') // Nom de l'archive (ex: "root.pxar.didx")
    // The query param takes precedence (caller can pass it explicitly when
    // the id wouldn't carry the namespace), but we fall back to whatever
    // was embedded between datastore and backup-type. Always one or the
    // other — never both.
    const ns = url.searchParams.get('ns') || namespaceFromId

    if (access.kind === 'tenant' && !access.allowed.some(a => a.datastore === datastore && a.namespace === ns)) {
      return NextResponse.json({ error: 'Backup not accessible for this tenant' }, { status: 403 })
    }

    const conn = access.kind === 'admin'
      ? await getPbsConnectionById(id)
      : await getPbsConnectionByIdUnscoped(id)

    // Si pas d'archive spécifiée, lister les fichiers/archives du backup
    if (!archiveName) {
      // Récupérer les infos du snapshot pour avoir la liste des fichiers
      const snapshotParams = new URLSearchParams({
        'backup-type': backupType,
        'backup-id': vmid,
      })

      if (ns) snapshotParams.set('ns', ns)

      const snapshots = await pbsFetch<any[]>(
        conn,
        `/admin/datastore/${encodeURIComponent(datastore)}/snapshots?${snapshotParams}`
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
            namespace: ns,
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

      if (ns) catalogParams.set('ns', ns)

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
          mtimeFormatted: entry.mtime ? new Date(entry.mtime * 1000).toLocaleString(dateLocale) : '-',
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
            namespace: ns,
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
            namespace: ns,
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
