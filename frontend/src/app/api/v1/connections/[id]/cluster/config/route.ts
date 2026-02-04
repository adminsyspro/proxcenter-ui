import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"

export const runtime = "nodejs"

// GET - Récupérer les informations de join du cluster
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> | { id: string } }) {
  try {
    const params = await Promise.resolve(ctx.params)
    const id = (params as any)?.id

    if (!id) return NextResponse.json({ error: "Missing params.id" }, { status: 400 })

    const conn = await getConnectionById(id)

    // Récupérer le status du cluster
    let clusterStatus: any = null
    let isCluster = false
    let clusterName = ''
    let nodes: any[] = []

    try {
      const status = await pveFetch<any[]>(conn, "/cluster/status")
      
      const clusterRow = status.find((x) => x?.type === "cluster")
      if (clusterRow) {
        isCluster = true
        clusterName = clusterRow.name || ''
      }

      // Récupérer les nodes du cluster
      nodes = status.filter((x) => x?.type === "node").map(n => ({
        name: n.name,
        id: n.nodeid,
        ip: n.ip,
        online: n.online === 1,
        local: n.local === 1,
      }))

      clusterStatus = {
        version: clusterRow?.version,
        quorate: clusterRow?.quorate === 1,
        nodes: clusterRow?.nodes,
      }
    } catch {
      // Standalone node
    }

    // Si c'est un cluster, récupérer les informations de join
    let joinInfo: any = null
    if (isCluster) {
      try {
        // L'API /cluster/config/join retourne les informations de join
        const join = await pveFetch<any>(conn, "/cluster/config/join")
        
        // Construire l'IP Address depuis le premier node local
        const localNode = nodes.find(n => n.local)
        const ipAddress = localNode?.ip || ''
        
        // Le fingerprint peut être à différents endroits selon la version de PVE
        // Essayer plusieurs chemins possibles
        let fingerprint = ''
        if (join?.fingerprint) {
          fingerprint = join.fingerprint
        } else if (join?.totem?.config_version && join?.nodelist?.[0]?.pve_fp) {
          // PVE 8+ peut avoir le fingerprint dans nodelist
          fingerprint = join.nodelist[0].pve_fp
        }
        
        // Si toujours pas de fingerprint, essayer de le récupérer depuis /cluster/config/nodes
        if (!fingerprint) {
          try {
            const configNodes = await pveFetch<any[]>(conn, "/cluster/config/nodes")
            const localConfigNode = configNodes?.find((n: any) => n.name === localNode?.name)
            if (localConfigNode?.pve_fp) {
              fingerprint = localConfigNode.pve_fp
            }
          } catch (e) {
            console.log("[cluster-config] Failed to get nodes config:", e)
          }
        }
        
        // Construire les peerLinks depuis la nodelist
        const peerLinks: Record<string, string> = {}
        const ringAddr: string[] = []
        
        if (join?.nodelist && Array.isArray(join.nodelist)) {
          join.nodelist.forEach((node: any, idx: number) => {
            // ring0_addr pour les anciens clusters
            if (node.ring0_addr) {
              peerLinks[String(idx)] = node.ring0_addr
              ringAddr.push(node.ring0_addr)
            }
            // pve_addr0, pve_addr1, etc. pour les nouveaux clusters
            for (let i = 0; i <= 7; i++) {
              const linkKey = `pve_addr${i}`
              if (node[linkKey]) {
                if (!peerLinks[String(i)]) {
                  peerLinks[String(i)] = node[linkKey]
                }
                if (!ringAddr.includes(node[linkKey])) {
                  ringAddr.push(node[linkKey])
                }
              }
            }
          })
        }
        
        // Construire l'objet join information complet
        const joinData = {
          ipAddress,
          fingerprint,
          peerLinks,
          ring_addr: ringAddr.length > 0 ? ringAddr : [ipAddress],
          totem: join?.totem || {}
        }
        
        // Encoder en base64 pour le join information
        const joinInfoEncoded = Buffer.from(JSON.stringify(joinData)).toString('base64')
        
        joinInfo = {
          ipAddress,
          fingerprint,
          encoded: joinInfoEncoded,
          // Données brutes pour debug
          raw: join
        }
      } catch (e) {
        console.log("[cluster-config] Failed to get join info:", e)
      }
    }

    // Récupérer les interfaces réseau du node pour la création de cluster
    let networks: any[] = []
    try {
      const nodesList = await pveFetch<any[]>(conn, "/nodes")
      const firstNode = nodesList[0]?.node
      if (firstNode) {
        const net = await pveFetch<any[]>(conn, `/nodes/${encodeURIComponent(firstNode)}/network`)
        networks = (net || [])
          .filter(n => n.active && (n.type === 'bridge' || n.type === 'eth' || n.type === 'bond' || n.type === 'vlan') && n.address)
          .map(n => ({
            iface: n.iface,
            address: n.address,
            cidr: n.cidr || `${n.address}/${n.netmask || '24'}`,
            type: n.type,
            active: n.active,
            comments: n.comments || '',
          }))
      }
    } catch (e) {
      console.log("[cluster-config] Failed to get network interfaces:", e)
    }

    return NextResponse.json({
      data: {
        isCluster,
        clusterName,
        clusterStatus,
        nodes,
        joinInfo,
        networks,
      }
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

// POST - Créer un cluster ou joindre un cluster
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> | { id: string } }) {
  try {
    const params = await Promise.resolve(ctx.params)
    const id = (params as any)?.id

    if (!id) return NextResponse.json({ error: "Missing params.id" }, { status: 400 })

    const body = await req.json()
    const { action } = body

    const conn = await getConnectionById(id)

    if (action === 'create') {
      // Créer un nouveau cluster
      const { clusterName, links } = body

      if (!clusterName) {
        return NextResponse.json({ error: "Cluster name is required" }, { status: 400 })
      }

      // Construire les paramètres pour la création du cluster
      const createParams: Record<string, string> = {
        clustername: clusterName,
      }

      // Ajouter les links (réseaux du cluster)
      if (links && Array.isArray(links)) {
        links.forEach((link: { linkNumber: number; address: string }, index: number) => {
          createParams[`link${link.linkNumber}`] = link.address
        })
      }

      const result = await pveFetch<any>(conn, "/cluster/config", {
        method: 'POST',
        body: new URLSearchParams(createParams),
      })

      return NextResponse.json({
        data: {
          success: true,
          upid: result,
        }
      })

    } else if (action === 'join') {
      // Joindre un cluster existant
      const { joinInfo, password, links } = body

      if (!joinInfo) {
        return NextResponse.json({ error: "Join information is required" }, { status: 400 })
      }

      if (!password) {
        return NextResponse.json({ error: "Password is required" }, { status: 400 })
      }

      // Construire les paramètres pour le join
      const joinParams: Record<string, string> = {
        hostname: joinInfo.hostname || '',
        fingerprint: joinInfo.fingerprint || '',
        password: password,
      }

      // Si c'est une chaîne encodée, on l'utilise directement
      if (typeof joinInfo === 'string') {
        // Décoder le join info si nécessaire
        joinParams.information = joinInfo
      } else if (joinInfo.information) {
        joinParams.information = joinInfo.information
      }

      // Ajouter les links si spécifiés
      if (links && Array.isArray(links)) {
        links.forEach((link: { linkNumber: number; address: string }) => {
          joinParams[`link${link.linkNumber}`] = link.address
        })
      }

      const result = await pveFetch<any>(conn, "/cluster/config/join", {
        method: 'POST',
        body: new URLSearchParams(joinParams),
      })

      return NextResponse.json({
        data: {
          success: true,
          upid: result,
        }
      })

    } else {
      return NextResponse.json({ error: "Invalid action. Use 'create' or 'join'" }, { status: 400 })
    }

  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
