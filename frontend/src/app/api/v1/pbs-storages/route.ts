import { NextResponse } from "next/server"

import { prisma } from "@/lib/db/prisma"
import { pveFetch } from "@/lib/proxmox/client"
import { decryptSecret } from "@/lib/crypto/secret"

export const runtime = "nodejs"

/**
 * GET /api/v1/pbs-storages
 * 
 * Retourne la liste des storages PBS configurés sur les PVE, avec le mapping
 * vers les connexions PBS de ProxCenter.
 * 
 * Cela permet de savoir quel PVE peut accéder à quel PBS, et avec quel nom de storage.
 * 
 * Réponse:
 * {
 *   data: [
 *     {
 *       pveId: "pve-1",
 *       pveName: "Cluster Principal",
 *       storageName: "pbs-backups",    // Nom du storage dans PVE
 *       pbsServer: "192.168.1.10:8007", // Serveur PBS configuré
 *       pbsDatastore: "vm-backups",    // Datastore sur le PBS
 *       pbsFingerprint: "...",
 *       pbsId: "pbs-1",                // ID de la connexion PBS dans ProxCenter (si trouvé)
 *       pbsName: "PBS Principal",      // Nom de la connexion PBS (si trouvé)
 *       nodes: ["pve1", "pve2"],       // Nodes PVE où ce storage est disponible
 *     }
 *   ]
 * }
 */
export async function GET() {
  try {
    // Récupérer toutes les connexions PVE et PBS
    const connections = await prisma.connection.findMany({
      select: {
        id: true,
        name: true,
        type: true,
        baseUrl: true,
        insecureTLS: true,
        apiTokenEnc: true,
      }
    })

    const pveConnections = connections.filter(c => c.type === 'pve')
    const pbsConnections = connections.filter(c => c.type === 'pbs')

    // Créer un map des PBS par URL pour le matching
    const pbsByUrl = new Map<string, { id: string, name: string }>()

    for (const pbs of pbsConnections) {
      // Normaliser l'URL pour le matching (sans protocole, sans trailing slash)
      const normalizedUrl = normalizeUrl(pbs.baseUrl)

      pbsByUrl.set(normalizedUrl, { id: pbs.id, name: pbs.name })
    }

    const result: any[] = []

    // Pour chaque PVE, récupérer les storages de type PBS
    await Promise.all(pveConnections.map(async (pve) => {
      if (!pve.apiTokenEnc || !pve.baseUrl) return

      const conn = {
        id: pve.id,
        name: pve.name,
        baseUrl: pve.baseUrl,
        apiToken: decryptSecret(pve.apiTokenEnc),
        insecureDev: !!pve.insecureTLS,
      }

      try {
        // Récupérer la config des storages
        const storages = await pveFetch<any[]>(conn, "/storage")

        // Filtrer les storages PBS
        const pbsStorages = (storages || []).filter(s => s.type === 'pbs')

        for (const storage of pbsStorages) {
          // Récupérer les nodes où ce storage est actif
          let nodes: string[] = []

          try {
            const resources = await pveFetch<any[]>(conn, "/cluster/resources")

            nodes = resources
              .filter(r => r.type === 'storage' && r.storage === storage.storage)
              .map(r => r.node)
              .filter(Boolean)
          } catch {
            // Ignorer les erreurs de récupération des nodes
          }

          // Essayer de matcher avec une connexion PBS de ProxCenter
          const pbsServer = storage.server || ''
          const normalizedPbsUrl = normalizeUrl(`https://${pbsServer}`)
          const matchedPbs = pbsByUrl.get(normalizedPbsUrl)

          result.push({
            pveId: pve.id,
            pveName: pve.name,
            storageName: storage.storage,
            pbsServer: storage.server || null,
            pbsDatastore: storage.datastore || null,
            pbsFingerprint: storage.fingerprint || null,
            pbsUsername: storage.username || null,

            // Matching avec ProxCenter
            pbsId: matchedPbs?.id || null,
            pbsName: matchedPbs?.name || null,

            // Infos additionnelles
            nodes: nodes.length > 0 ? nodes : null,
            content: storage.content ? String(storage.content).split(',') : [],
            enabled: storage.disable !== 1,
          })
        }
      } catch (e) {
        console.warn(`Failed to get storages from PVE ${pve.name}:`, e)
      }
    }))

    return NextResponse.json({ data: result })
  } catch (e: any) {
    console.error("PBS storages mapping error:", e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

/**
 * Normalise une URL pour le matching (retire le protocole, le port par défaut, le trailing slash)
 */
function normalizeUrl(url: string): string {
  if (!url) return ''
  
  return url
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '')
    .toLowerCase()
}
