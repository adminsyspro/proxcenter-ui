import { NextResponse } from "next/server"
import { pveFetch } from "@/lib/proxmox/client"
import { getConnectionById } from "@/lib/connections/getConnection"

export const runtime = "nodejs"

/**
 * GET /api/v1/connections/[id]/nodes/[node]/system
 * 
 * Récupère toutes les informations système pour un node :
 * - Network interfaces
 * - Certificates
 * - DNS configuration
 * - Hosts file
 * - Options
 * - Time configuration
 * 
 * Query params:
 * - section: 'all' | 'network' | 'certificates' | 'dns' | 'hosts' | 'options' | 'time'
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string; node: string }> }
) {
  try {
    const { id, node } = await ctx.params
    const url = new URL(req.url)
    const section = url.searchParams.get('section') || 'all'

    const conn = await getConnectionById(id)
    if (!conn) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 })
    }

    const result: any = {}

    // Helper pour fetch avec gestion d'erreur
    const fetchSafe = async <T>(path: string): Promise<T | null> => {
      try {
        return await pveFetch<T>(conn, path)
      } catch {
        return null
      }
    }

    // Network interfaces
    if (section === 'all' || section === 'network') {
      const network = await fetchSafe<any[]>(`/nodes/${encodeURIComponent(node)}/network`)
      result.network = Array.isArray(network) ? network.map((iface: any) => ({
        iface: iface.iface,
        type: iface.type, // bridge, bond, eth, vlan, OVSBridge, etc.
        active: iface.active,
        autostart: iface.autostart,
        method: iface.method, // static, dhcp, manual
        method6: iface.method6,
        address: iface.address,
        netmask: iface.netmask,
        gateway: iface.gateway,
        address6: iface.address6,
        netmask6: iface.netmask6,
        gateway6: iface.gateway6,
        cidr: iface.cidr,
        bridge_ports: iface.bridge_ports,
        bridge_stp: iface.bridge_stp,
        bridge_fd: iface.bridge_fd,
        bridge_vlan_aware: iface.bridge_vlan_aware,
        bond_mode: iface.bond_mode,
        bond_primary: iface.bond_primary,
        bond_xmit_hash_policy: iface.bond_xmit_hash_policy,
        slaves: iface.slaves,
        vlan_id: iface['vlan-id'],
        vlan_raw_device: iface['vlan-raw-device'],
        mtu: iface.mtu,
        comments: iface.comments,
        families: iface.families,
      })).sort((a: any, b: any) => {
        // Trier: bridges d'abord, puis bonds, puis physiques, puis vlans
        const order: Record<string, number> = { bridge: 0, OVSBridge: 1, bond: 2, eth: 3, vlan: 4 }
        return (order[a.type] || 5) - (order[b.type] || 5)
      }) : []
    }

    // Certificates
    if (section === 'all' || section === 'certificates') {
      const certs = await fetchSafe<any[]>(`/nodes/${encodeURIComponent(node)}/certificates/info`)
      result.certificates = Array.isArray(certs) ? certs.map((cert: any) => ({
        filename: cert.filename,
        fingerprint: cert.fingerprint,
        issuer: cert.issuer,
        subject: cert.subject,
        notBefore: cert.notbefore,
        notAfter: cert.notafter,
        san: cert.san, // Subject Alternative Names
        pem: cert.pem,
        publicKeyBits: cert['public-key-bits'],
        publicKeyType: cert['public-key-type'],
      })) : []
    }

    // DNS configuration
    if (section === 'all' || section === 'dns') {
      const dns = await fetchSafe<any>(`/nodes/${encodeURIComponent(node)}/dns`)
      result.dns = dns ? {
        search: dns.search,
        dns1: dns.dns1,
        dns2: dns.dns2,
        dns3: dns.dns3,
      } : null
    }

    // Hosts file
    if (section === 'all' || section === 'hosts') {
      const hosts = await fetchSafe<any>(`/nodes/${encodeURIComponent(node)}/hosts`)
      result.hosts = hosts ? {
        data: hosts.data,
        digest: hosts.digest,
      } : null
    }

    // Options (node config)
    if (section === 'all' || section === 'options') {
      const config = await fetchSafe<any>(`/nodes/${encodeURIComponent(node)}/config`)
      result.options = config ? {
        acme: config.acme,
        acmedomain0: config.acmedomain0,
        acmedomain1: config.acmedomain1,
        description: config.description,
        startall_onboot_delay: config['startall-onboot-delay'],
        wakeonlan: config.wakeonlan,
      } : null
    }

    // Time configuration
    if (section === 'all' || section === 'time') {
      const time = await fetchSafe<any>(`/nodes/${encodeURIComponent(node)}/time`)
      result.time = time ? {
        timezone: time.timezone,
        localtime: time.localtime,
        time: time.time, // Unix timestamp
      } : null
      
      // Liste des timezones disponibles
      // On ne les charge que si demandé spécifiquement pour éviter une grosse réponse
      if (section === 'time') {
        const timezones = await fetchSafe<string[]>(`/nodes/${encodeURIComponent(node)}/time/timezones`)
        result.timezones = Array.isArray(timezones) ? timezones : []
      }
    }

    return NextResponse.json({ data: result })
  } catch (e: any) {
    console.error("[system/node] Error:", e?.message)
    return NextResponse.json({ error: e?.message || "Failed to fetch system data" }, { status: 500 })
  }
}

/**
 * PUT /api/v1/connections/[id]/nodes/[node]/system
 * 
 * Met à jour les configurations système
 * Body: { section: 'dns' | 'hosts' | 'time' | 'options', data: {...} }
 */
export async function PUT(
  req: Request,
  ctx: { params: Promise<{ id: string; node: string }> }
) {
  try {
    const { id, node } = await ctx.params
    const body = await req.json()
    const { section, data } = body

    if (!section || !data) {
      return NextResponse.json({ error: "section and data are required" }, { status: 400 })
    }

    const conn = await getConnectionById(id)
    if (!conn) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 })
    }

    let endpoint = ''
    let params = new URLSearchParams()

    switch (section) {
      case 'dns':
        endpoint = `/nodes/${encodeURIComponent(node)}/dns`
        if (data.search) params.append('search', data.search)
        if (data.dns1) params.append('dns1', data.dns1)
        if (data.dns2) params.append('dns2', data.dns2)
        if (data.dns3) params.append('dns3', data.dns3)
        break

      case 'hosts':
        endpoint = `/nodes/${encodeURIComponent(node)}/hosts`
        if (data.data) params.append('data', data.data)
        if (data.digest) params.append('digest', data.digest)
        break

      case 'time':
        endpoint = `/nodes/${encodeURIComponent(node)}/time`
        if (data.timezone) params.append('timezone', data.timezone)
        break

      case 'options':
        endpoint = `/nodes/${encodeURIComponent(node)}/config`
        if (data.description !== undefined) params.append('description', data.description)
        if (data.wakeonlan !== undefined) params.append('wakeonlan', data.wakeonlan)
        if (data['startall-onboot-delay'] !== undefined) params.append('startall-onboot-delay', data['startall-onboot-delay'])
        break

      default:
        return NextResponse.json({ error: "Invalid section" }, { status: 400 })
    }

    await pveFetch(conn, endpoint, {
      method: 'PUT',
      body: params,
    })

    return NextResponse.json({ success: true })
  } catch (e: any) {
    console.error("[system/node] PUT Error:", e?.message)
    return NextResponse.json({ error: e?.message || "Failed to update system config" }, { status: 500 })
  }
}
