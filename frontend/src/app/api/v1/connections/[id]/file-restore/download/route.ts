import { NextResponse } from "next/server"

import { Agent, request } from "undici"

import { getConnectionById } from "@/lib/connections/getConnection"

export const runtime = "nodejs"

/**
 * GET /api/v1/connections/{pveId}/file-restore/download
 *
 * Télécharge un fichier ou dossier depuis un backup vzdump via l'API file-restore de Proxmox.
 *
 * Query params:
 * - storage: Nom du storage dans PVE
 * - volume: Volume ID du backup
 * - filepath: Chemin du fichier/dossier à télécharger
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
    const filepath = url.searchParams.get('filepath')

    if (!storage || !volume || !filepath) {
      return NextResponse.json({ error: "Missing required parameters: storage, volume, filepath" }, { status: 400 })
    }

    const conn = await getConnectionById(pveId)

    const dispatcher = conn.insecureDev
      ? new Agent({ connect: { rejectUnauthorized: false } })
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

    // Encoder le filepath en base64 comme attendu par l'API PVE
    const filepathBase64 = Buffer.from(filepath, 'utf-8').toString('base64')

    // Appeler l'API file-restore/download de Proxmox
    const downloadUrl = `${conn.baseUrl.replace(/\/$/, "")}/api2/json/nodes/${nodeName}/storage/${encodeURIComponent(storage)}/file-restore/download`

    const queryParams = new URLSearchParams({
      volume: volumeId,
      filepath: filepathBase64,
    })

    const pveRes = await request(`${downloadUrl}?${queryParams}`, {
      method: 'GET',
      headers: { Authorization: `PVEAPIToken=${conn.apiToken}` },
      dispatcher,
    })

    if (pveRes.statusCode < 200 || pveRes.statusCode >= 300) {
      const errorText = await pveRes.body.text()

      // Essayer de parser l'erreur JSON
      try {
        const errorJson = JSON.parse(errorText)

        return NextResponse.json({
          error: errorJson.errors?.volume || errorJson.message || `PVE error: ${pveRes.statusCode}`,
          details: errorJson
        }, { status: pveRes.statusCode })
      } catch {
        return NextResponse.json({
          error: `PVE error: ${pveRes.statusCode}`,
          details: errorText
        }, { status: pveRes.statusCode })
      }
    }

    // Déterminer le nom du fichier pour le Content-Disposition
    const filename = filepath.split('/').pop() || 'download'

    // Vérifier si c'est un dossier (sera téléchargé comme .tar.zst)
    const contentType = pveRes.headers['content-type'] || 'application/octet-stream'
    const isArchive = contentType.includes('zstd') || contentType.includes('tar') || contentType.includes('application/octet-stream')

    // Nom du fichier téléchargé
    let downloadFilename = filename
    if (isArchive && !filename.includes('.')) {
      downloadFilename = `${filename}.tar.zst`
    }

    // Collecter le body en chunks
    const chunks: Uint8Array[] = []

    for await (const chunk of pveRes.body) {
      chunks.push(chunk)
    }

    const buffer = Buffer.concat(chunks)

    // Créer la réponse avec les headers appropriés
    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${encodeURIComponent(downloadFilename)}"`,
        'Content-Length': String(buffer.length),
      },
    })

  } catch (e: any) {
    console.error("File-restore download error:", e)

    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
