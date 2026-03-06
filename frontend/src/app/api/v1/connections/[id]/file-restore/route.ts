import { NextResponse } from "next/server"

import { request } from "undici"

import { getConnectionById } from "@/lib/connections/getConnection"
import { getInsecureAgent } from "@/lib/proxmox/client"
import { formatBytes } from "@/utils/format"

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

    // Récupérer un node disponible
    const nodesUrl = `${conn.baseUrl.replace(/\/$/, "")}/api2/json/nodes`

    const nodesRes = await request(nodesUrl, {
      method: 'GET',
      headers: { Authorization: `PVEAPIToken=${conn.apiToken}` },
      dispatcher,
    })

    const nodesJson = JSON.parse(await nodesRes.body.text())
    const nodes = nodesJson.data || []
    const onlineNode = nodes.find((n: any) => n.status === 'online') || nodes[0]

    if (!onlineNode) {
      return NextResponse.json({ error: "No available node found" }, { status: 500 })
    }

    const nodeName = onlineNode.node

    // Construire le volume ID complet si nécessaire
    const volumeId = volume.includes(':') ? volume : `${storage}:${volume}`

    // Vérifier si le chemin cible une image disque brute (non explorable)
    // Le premier segment peut être en clair (drive-scsi0.img.fidx) ou en base64
    const firstSegment = filepath.split('/').filter(Boolean)[0] || ''
    let decodedSegment = firstSegment
    // Tenter un décodage base64 si ça ressemble à du base64
    if (/^[A-Za-z0-9+/]+=*$/.test(firstSegment) && firstSegment.length >= 8) {
      try {
        const d = Buffer.from(firstSegment, 'base64').toString('utf-8')
        if (/^[\x20-\x7E]+$/.test(d)) decodedSegment = d.replace(/^\//, '')
      } catch {}
    }
    const isRawDisk = (s: string) =>
      s.endsWith('.img.fidx') || s.endsWith('.raw.fidx') ||
      s.endsWith('.img.didx') || s.endsWith('.raw.didx') ||
      (/^drive-/i.test(s) && !s.includes('.pxar'))

    if (isRawDisk(firstSegment) || isRawDisk(decodedSegment)) {
      return NextResponse.json({
        error: "Raw disk images (.img.fidx) cannot be browsed via file-restore. Only filesystem archives (.pxar) are supported.",
        code: "RAW_DISK_NOT_BROWSABLE"
      }, { status: 400 })
    }

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
        mtimeFormatted: entry.mtime ? new Date(entry.mtime * 1000).toLocaleString('fr-FR') : '-',
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
