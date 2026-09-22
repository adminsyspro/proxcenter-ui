import { NextResponse } from "next/server"

import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"
import { resolveManagementIp } from "@/lib/proxmox/resolveManagementIp"
import { corosyncLinksOf } from "@/lib/proxmox/corosyncLinks"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

type CorosyncNodeConfig = { votes: number | null; links: string[]; fingerprint: string }

// GET - Récupérer les informations de join du cluster
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> | { id: string } }) {
  try {
    const params = await Promise.resolve(ctx.params)
    const id = (params as any)?.id

    if (!id) return NextResponse.json({ error: "Missing params.id" }, { status: 400 })

    const denied = await checkPermission(PERMISSIONS.CONNECTION_VIEW, "connection", id)
    if (denied) return denied

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

      // Récupérer les nodes du cluster. `ip` here is the address corosync
      // resolves the node name to (link 0), not the one the API answers on.
      nodes = status.filter((x) => x?.type === "node").map(n => ({
        name: n.name,
        id: n.nodeid,
        corosyncIp: n.ip || null,
        online: n.online === 1,
        local: n.local === 1,
        maintenance: false,
      }))

      clusterStatus = {
        version: clusterRow?.version,
        quorate: clusterRow?.quorate === 1,
        nodes: clusterRow?.nodes,
      }
    } catch {
      // Standalone node
    }

    // corosync.conf, per node: quorum votes and the link addresses. Only a
    // cluster has one; a standalone node has no corosync at all.
    const corosyncConfig = new Map<string, CorosyncNodeConfig>()
    if (isCluster) {
      try {
        const configNodes = await pveFetch<any[]>(conn, "/cluster/config/nodes")
        for (const entry of configNodes || []) {
          const name = entry?.name || entry?.node
          if (!name) continue
          const votes = Number(entry.quorum_votes)
          corosyncConfig.set(name, {
            votes: Number.isFinite(votes) ? votes : null,
            links: corosyncLinksOf(entry),
            fingerprint: typeof entry.pve_fp === 'string' ? entry.pve_fp : '',
          })
        }
      } catch {
        // Non-critical: the table falls back to the corosync IP of /cluster/status
      }
    }

    // Enrich nodes with their management IP (roadmap#29: kept apart from the
    // corosync addresses, a cluster routinely runs them on separate networks)
    // and maintenance status.
    if (nodes.length > 0) {
      // Fetch hastate for maintenance detection
      let nodeHastateMap = new Map<string, string>()
      try {
        const resources = await pveFetch<any[]>(conn, '/cluster/resources?type=node')
        for (const r of resources || []) {
          if (r?.node && r?.hastate) nodeHastateMap.set(r.node, r.hastate)
        }
      } catch {}

      // Fetch management IPs from network interfaces in parallel
      const enriched = await Promise.all(nodes.map(async (node: any) => {
        const hastate = nodeHastateMap.get(node.name)
        const maintenance = hastate === 'maintenance'

        // The management IP comes from the node's own interfaces (gateway,
        // then vmbr0). Left null when it cannot be read: the UI must say so
        // rather than show the corosync address under a management label.
        let managementIp: string | null = null
        try {
          const networks = await pveFetch<any[]>(conn, `/nodes/${encodeURIComponent(node.name)}/network`)
          managementIp = resolveManagementIp(networks) || null
        } catch {}

        const cfg = corosyncConfig.get(node.name)
        const corosyncLinks = cfg?.links.length
          ? cfg.links
          : (isCluster && node.corosyncIp ? [node.corosyncIp] : [])

        return {
          ...node,
          // Legacy field, the address ProxCenter reaches the node on.
          ip: managementIp || node.corosyncIp || null,
          managementIp,
          corosyncLinks,
          votes: cfg?.votes ?? null,
          maintenance,
        }
      }))

      nodes = enriched
    }

    // Si c'est un cluster, récupérer les informations de join
    let joinInfo: any = null
    if (isCluster) {
      try {
        // L'API /cluster/config/join retourne les informations de join
        const join = await pveFetch<any>(conn, "/cluster/config/join")

        // The join information describes ONE node: the one a new member will
        // contact (PVE calls it preferred_node, it is the node that answered
        // this call). Its API address, its fingerprint and its corosync links
        // must all come from that same nodelist entry.
        const localNode = nodes.find(n => n.local)
        const nodelist: any[] = Array.isArray(join?.nodelist) ? join.nodelist : []
        const target =
          nodelist.find((n: any) => n?.name && n.name === join?.preferred_node)
          || nodelist.find((n: any) => n?.name && n.name === localNode?.name)
          || nodelist[0]
          || null

        const ipAddress: string = target?.pve_addr || localNode?.managementIp || localNode?.ip || ''

        let fingerprint = ''
        if (typeof join?.fingerprint === 'string' && join.fingerprint) {
          fingerprint = join.fingerprint
        } else if (target?.pve_fp) {
          fingerprint = target.pve_fp
        } else if (target?.name && corosyncConfig.get(target.name)?.fingerprint) {
          fingerprint = corosyncConfig.get(target.name)!.fingerprint
        }

        // Corosync links of that node, keyed by link number as PVE's own join
        // dialog encodes them. Never the management address: when the
        // nodelist carries no link, fall back to the corosync IP of
        // /cluster/status, and only then to the API address.
        const linkAddrs = corosyncLinksOf(target)
        const peerLinks: Record<string, string> = {}
        linkAddrs.forEach((addr, i) => { peerLinks[String(i)] = addr })
        const ringAddr = linkAddrs.length > 0
          ? linkAddrs
          : [localNode?.corosyncIp || ipAddress].filter(Boolean)

        // Construire l'objet join information complet
        const joinData = {
          ipAddress,
          fingerprint,
          peerLinks,
          ring_addr: ringAddr,
          totem: join?.totem || {}
        }
        
        // Encoder en base64 pour le join information
        const joinInfoEncoded = Buffer.from(JSON.stringify(joinData)).toString('base64')
        
        joinInfo = {
          ipAddress,
          fingerprint,
          corosyncLinks: linkAddrs,
          encoded: joinInfoEncoded,
          // Données brutes pour debug
          raw: join
        }
      } catch (e) {
        // Failed to get join info, non-critical
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
      // Failed to get network interfaces, non-critical
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

    const denied = await checkPermission(PERMISSIONS.CONNECTION_MANAGE, "connection", id)
    if (denied) return denied

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
