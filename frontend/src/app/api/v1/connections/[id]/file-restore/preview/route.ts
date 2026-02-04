import { NextResponse } from "next/server"

import { Agent, request } from "undici"

import { getConnectionById } from "@/lib/connections/getConnection"

export const runtime = "nodejs"

// Extensions supportées pour la prévisualisation
const TEXT_EXTENSIONS = [
  '.txt', '.log', '.conf', '.cfg', '.ini', '.yaml', '.yml', '.json', '.xml',
  '.sh', '.bash', '.zsh', '.fish',
  '.py', '.js', '.ts', '.jsx', '.tsx', '.css', '.scss', '.html', '.htm',
  '.md', '.rst', '.csv', '.env', '.gitignore', '.dockerignore',
  '.php', '.rb', '.go', '.rs', '.java', '.c', '.cpp', '.h', '.hpp',
  '.sql', '.toml', '.properties', '.service', '.timer', '.socket',
  '.cron', '.crontab', '.htaccess', '.nginx', '.apache',
]

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.ico', '.bmp']

// Taille max pour la prévisualisation (500 KB)
const MAX_PREVIEW_SIZE = 500 * 1024

/**
 * GET /api/v1/connections/{pveId}/file-restore/preview
 * 
 * Prévisualise un fichier depuis un backup.
 * Retourne le contenu texte ou une image en base64.
 * 
 * Query params:
 * - storage: Nom du storage PBS dans PVE
 * - volume: Volume ID du backup
 * - filepath: Chemin du fichier à prévisualiser
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
      return NextResponse.json({ error: "Missing required parameters" }, { status: 400 })
    }

    // Déterminer le type de fichier
    const filename = filepath.split('/').pop() || ''
    const ext = ('.' + filename.split('.').pop()?.toLowerCase()) || ''
    
    const isText = TEXT_EXTENSIONS.includes(ext) || filename.startsWith('.')
    const isImage = IMAGE_EXTENSIONS.includes(ext)

    if (!isText && !isImage) {
      return NextResponse.json({ 
        error: "File type not supported for preview",
        supportedText: TEXT_EXTENSIONS.slice(0, 10).join(', ') + '...',
        supportedImages: IMAGE_EXTENSIONS.join(', '),
      }, { status: 400 })
    }

    const conn = await getConnectionById(pveId)

    // Récupérer un node disponible
    const nodesUrl = `${conn.baseUrl.replace(/\/$/, "")}/api2/json/nodes`

    const dispatcher = conn.insecureDev
      ? new Agent({ connect: { rejectUnauthorized: false } })
      : undefined

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
    const filepathBase64 = Buffer.from(filepath, 'utf-8').toString('base64')
    const volumeId = volume.includes(':') ? volume : `${storage}:${volume}`

    // Télécharger le fichier
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

      
return NextResponse.json({ 
        error: `PVE error: ${pveRes.statusCode}`,
        details: errorText 
      }, { status: pveRes.statusCode })
    }

    // Lire le contenu
    const chunks: Buffer[] = []
    let totalSize = 0

    for await (const chunk of pveRes.body) {
      totalSize += chunk.length

      if (totalSize > MAX_PREVIEW_SIZE) {
        // Fichier trop gros, retourner un aperçu partiel pour le texte
        if (isText) {
          chunks.push(chunk)
          break
        } else {
          return NextResponse.json({ 
            error: "File too large for preview",
            size: totalSize,
            maxSize: MAX_PREVIEW_SIZE,
          }, { status: 413 })
        }
      }

      chunks.push(chunk)
    }

    const buffer = Buffer.concat(chunks)

    if (isText) {
      // Détecter l'encodage et convertir en texte
      let content = buffer.toString('utf-8')
      
      // Vérifier si c'est du texte valide
      const isBinary = content.includes('\x00') || 
        (buffer.length > 100 && content.replace(/[\x00-\x1F\x7F-\x9F]/g, '').length < buffer.length * 0.7)
      
      if (isBinary) {
        return NextResponse.json({ 
          error: "File appears to be binary, not text",
        }, { status: 400 })
      }

      const truncated = totalSize > MAX_PREVIEW_SIZE

      return NextResponse.json({
        data: {
          type: 'text',
          filename,
          extension: ext,
          content,
          size: totalSize,
          truncated,
          truncatedAt: truncated ? MAX_PREVIEW_SIZE : null,
        }
      })
    } else if (isImage) {
      // Retourner l'image en base64
      const base64 = buffer.toString('base64')

      const mimeType = ext === '.svg' ? 'image/svg+xml' :
                       ext === '.png' ? 'image/png' :
                       ext === '.gif' ? 'image/gif' :
                       ext === '.webp' ? 'image/webp' :
                       ext === '.ico' ? 'image/x-icon' :
                       ext === '.bmp' ? 'image/bmp' :
                       'image/jpeg'

      return NextResponse.json({
        data: {
          type: 'image',
          filename,
          extension: ext,
          mimeType,
          base64,
          dataUrl: `data:${mimeType};base64,${base64}`,
          size: buffer.length,
        }
      })
    }

    return NextResponse.json({ error: "Unknown file type" }, { status: 400 })
  } catch (e: any) {
    console.error("Preview error:", e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
