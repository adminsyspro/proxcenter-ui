import { NextResponse } from "next/server"
import { cookies } from "next/headers"

import { request } from "undici"

import { getConnectionById } from "@/lib/connections/getConnection"
import { getInsecureAgent } from "@/lib/proxmox/client"
import { formatBytes } from "@/utils/format"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { getDateLocale } from "@/lib/i18n/date"

export const runtime = "nodejs"

/**
 * GET /api/v1/connections/{pveId}/file-restore
 *
 * Liste le contenu d'un backup vzdump via l'API file-restore de Proxmox.
 *
 * Query params:
 * - storage: Nom du storage dans PVE
 * - volume: Volume ID du backup (ex: "local:backup/vzdump-qemu-100-2024_01_15.vma.zst")
 * - filepath: Chemin à explorer (default: "/")
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const params = await Promise.resolve(ctx.params)
    const pveId = (params as any)?.id

    if (!pveId) {
      return NextResponse.json({ error: "Missing PVE connection id" }, { status: 400 })
    }

    const denied = await checkPermission(PERMISSIONS.BACKUP_VIEW, "connection", pveId)

    if (denied) return denied

    const cookieStore = await cookies()
    const dateLocale = getDateLocale(cookieStore.get('NEXT_LOCALE')?.value || 'en')

    const url = new URL(req.url)
    const storage = url.searchParams.get('storage')
    const volume = url.searchParams.get('volume')
    const filepath = url.searchParams.get('filepath') || '/'

    if (!storage || !volume) {
      return NextResponse.json({ error: "Missing required parameters: storage, volume" }, { status: 400 })
    }

    const conn = await getConnectionById(pveId)

    const dispatcher = conn.insecureDev
      ? getInsecureAgent()
      : undefined

    // Récupérer un node qui a accès au storage (important pour PBS avec encryption key)
    // D'abord, chercher les nodes ayant le storage via /cluster/resources
    const resourcesUrl = `${conn.baseUrl.replace(/\/$/, "")}/api2/json/cluster/resources`

    const resourcesRes = await request(resourcesUrl, {
      method: 'GET',
      headers: { Authorization: `PVEAPIToken=${conn.apiToken}` },
      dispatcher,
    })

    const resourcesJson = JSON.parse(await resourcesRes.body.text())
    const allResources = resourcesJson.data || []

    // Trouver les nodes qui ont ce storage
    const storageNodes = allResources
      .filter((r: any) => r.type === 'storage' && r.storage === storage && r.status === 'available')
      .map((r: any) => r.node)

    // Aussi récupérer tous les nodes online
    const onlineNodes = allResources
      .filter((r: any) => r.type === 'node' && r.status === 'online')
      .map((r: any) => r.node)

    // Préférer un node qui a le storage, sinon n'importe quel node online
    const nodeName = storageNodes.find((n: string) => onlineNodes.includes(n))
      || storageNodes[0]
      || onlineNodes[0]

    if (!nodeName) {
      return NextResponse.json({ error: "No available node found with storage access" }, { status: 500 })
    }

    // Construire le volume ID complet si nécessaire
    const volumeId = volume.includes(':') ? volume : `${storage}:${volume}`

    // Encoder le filepath en base64 comme attendu par l'API PVE
    const filepathBase64 = Buffer.from(filepath, 'utf-8').toString('base64')

    // Appeler l'API file-restore/list de Proxmox
    const listUrl = `${conn.baseUrl.replace(/\/$/, "")}/api2/json/nodes/${nodeName}/storage/${encodeURIComponent(storage)}/file-restore/list`

    const queryParams = new URLSearchParams({
      volume: volumeId,
      filepath: filepathBase64,
    })

    const pveRes = await request(`${listUrl}?${queryParams}`, {
      method: 'GET',
      headers: { Authorization: `PVEAPIToken=${conn.apiToken}` },
      dispatcher,
    })

    const responseText = await pveRes.body.text()

    if (pveRes.statusCode < 200 || pveRes.statusCode >= 300) {
      // Essayer de parser l'erreur JSON
      try {
        const errorJson = JSON.parse(responseText)


return NextResponse.json({
          error: errorJson.errors?.volume || errorJson.message || `PVE error: ${pveRes.statusCode}`,
          details: errorJson
        }, { status: pveRes.statusCode })
      } catch {
        return NextResponse.json({
          error: `PVE error: ${pveRes.statusCode}`,
          details: responseText
        }, { status: pveRes.statusCode })
      }
    }

    const pveJson = JSON.parse(responseText)
    const entries = pveJson.data || []

    // Transformer les entrées pour le frontend
    const files = entries.map((entry: any) => {
      const isDir = entry.type === 'd' || entry.type === 'v' // v = virtual directory (pour le root)
      const isFile = entry.type === 'f'
      const isSymlink = entry.type === 'l'
      const isHardlink = entry.type === 'h'
      const isVirtual = entry.type === 'v'

      // PVE peut retourner filepath en base64 pour les backups PBS
      // Préférer text (toujours lisible), sinon décoder filepath si c'est du base64
      let name = entry.text || entry.filepath || entry.filename || ''

      if (!entry.text && entry.filepath && /^[A-Za-z0-9+/]+=*$/.test(entry.filepath) && entry.filepath.length >= 8) {
        try {
          const decoded = Buffer.from(entry.filepath, 'base64').toString('utf-8')

          if (/^[\x20-\x7E]+$/.test(decoded)) {
            name = decoded.replace(/^\//, '')
          }
        } catch {}
      }

      return {
        name,
        type: isVirtual ? 'virtual' : isDir ? 'directory' : isSymlink ? 'symlink' : isHardlink ? 'hardlink' : 'file',
        size: entry.size || 0,
        sizeFormatted: formatBytes(entry.size || 0),
        mtime: entry.mtime,
        mtimeFormatted: entry.mtime ? new Date(entry.mtime * 1000).toLocaleString(dateLocale) : '-',
        leaf: entry.leaf,
        browsable: isDir || isVirtual,
      }
    })

    // Trier: dossiers d'abord, puis fichiers par nom
    files.sort((a: any, b: any) => {
      if ((a.type === 'directory' || a.type === 'virtual') && b.type !== 'directory' && b.type !== 'virtual') return -1
      if ((b.type === 'directory' || b.type === 'virtual') && a.type !== 'directory' && a.type !== 'virtual') return 1

      return (a.name || '').localeCompare(b.name || '')
    })

    return NextResponse.json({
      data: {
        path: filepath,
        storage,
        volume: volumeId,
        node: nodeName,
        files,
      }
    })

  } catch (e: any) {
    console.error("File-restore list error:", e)

    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
