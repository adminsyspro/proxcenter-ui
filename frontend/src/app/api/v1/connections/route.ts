// src/app/api/v1/connections/route.ts
import { NextResponse } from "next/server"

import { getSessionPrisma } from "@/lib/tenant"
import { encryptSecret } from "@/lib/crypto/secret"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { createConnectionSchema } from "@/lib/schemas"
import { pbsFetch } from "@/lib/proxmox/pbs-client"
import { pveFetch } from "@/lib/proxmox/client"
import { orchestratorFetch } from "@/lib/orchestrator/client"

export const runtime = "nodejs"

// Liste des connexions (sans jamais renvoyer le token ni les secrets SSH)
// ?type=pve|pbs pour filtrer par type
// ?hasCeph=true pour filtrer les connexions avec Ceph
export async function GET(req: Request) {
  try {
    // RBAC: Check connection.view permission
    const denied = await checkPermission(PERMISSIONS.CONNECTION_VIEW)

    if (denied) return denied

    const url = new URL(req.url)
    const typeFilter = url.searchParams.get('type') // 'pve' | 'pbs' | null
    const hasCephFilter = url.searchParams.get('hasCeph') // 'true' | null

    const where: any = {}

    if (typeFilter) where.type = typeFilter
    if (hasCephFilter === 'true') where.hasCeph = true

    const prisma = await getSessionPrisma()
    const connections = await prisma.connection.findMany({
      where: Object.keys(where).length > 0 ? where : undefined,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        type: true,
        baseUrl: true,
        behindProxy: true,
        insecureTLS: true,
        hasCeph: true,
        latitude: true,
        longitude: true,
        locationLabel: true,
        // SSH fields (sans les secrets)
        sshEnabled: true,
        sshPort: true,
        sshUser: true,
        sshAuthMethod: true,
        sshUseSudo: true,
        // Inclure les champs chiffrés pour vérifier si configuré (ne pas renvoyer au client)
        sshKeyEnc: true,
        sshPassEnc: true,
        createdAt: true,
        updatedAt: true,
        hosts: {
          select: { id: true, node: true, ip: true, enabled: true },
          orderBy: { node: 'asc' },
        },
      },
    })

    // Calculer sshConfigured en mémoire sans N+1 queries
    const connectionsWithSSHStatus = connections.map((conn) => {
      const { sshKeyEnc, sshPassEnc, ...rest } = conn

      return {
        ...rest,
        sshConfigured: !!(sshKeyEnc || sshPassEnc),
        sshKeyConfigured: !!sshKeyEnc,
        sshPassConfigured: !!sshPassEnc,
      }
    })

    return NextResponse.json({ data: connectionsWithSSHStatus })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

// Création d'une connexion
export async function POST(req: Request) {
  try {
    // RBAC: Check connection.manage permission
    const denied = await checkPermission(PERMISSIONS.CONNECTION_MANAGE)

    if (denied) return denied

    const rawBody = await req.json().catch(() => null)

    if (!rawBody) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })

    const parseResult = createConnectionSchema.safeParse(rawBody)

    if (!parseResult.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parseResult.error.flatten() },
        { status: 400 }
      )
    }

    const {
      name, type, baseUrl, behindProxy, insecureTLS, hasCeph, apiToken,
      subType, vmwareUser, vmwarePassword, vmwareDatacenter,
      latitude, longitude, locationLabel,
      sshEnabled, sshPort, sshUser, sshAuthMethod,
      sshKey, sshPassphrase, sshPassword, sshUseSudo,
    } = parseResult.data

    // Préparer les données
    const data: any = {
      name,
      type,
      baseUrl,
      behindProxy,
      insecureTLS,
      hasCeph: false,
      latitude: latitude ?? null,
      longitude: longitude ?? null,
      locationLabel: locationLabel ?? null,
    }

    if (type === 'vmware' || type === 'xcpng' || type === 'hyperv' || type === 'nutanix') {
      // VMware/XCP-ng/Hyper-V/Nutanix: store "user:password" in apiTokenEnc
      const defaultUser = type === 'xcpng' ? 'admin@admin.net' : type === 'hyperv' ? 'Administrator' : type === 'nutanix' ? 'admin' : 'root'
      data.apiTokenEnc = encryptSecret(`${vmwareUser || defaultUser}:${vmwarePassword || ''}`)
      if (type === 'vmware') {
        data.subType = subType || 'esxi'
        data.vmwareDatacenter = vmwareDatacenter || null
      }
      if (type === 'xcpng' || type === 'hyperv' || type === 'nutanix') {
        data.sshEnabled = false
      }
    } else {
      data.apiTokenEnc = encryptSecret(apiToken || '')
    }

    // SSH config (PVE + VMware)
    if (type !== 'xcpng' && type !== 'hyperv' && type !== 'nutanix') {
      data.sshEnabled = sshEnabled
      data.sshPort = sshPort
      data.sshUser = sshUser
      data.sshAuthMethod = sshEnabled ? sshAuthMethod : null
      data.sshUseSudo = sshEnabled ? sshUseSudo : false

      // Chiffrer les secrets SSH si fournis
      if (sshEnabled && sshAuthMethod === 'key' && sshKey) {
        data.sshKeyEnc = encryptSecret(sshKey)
        if (sshPassphrase) {
          data.sshPassEnc = encryptSecret(sshPassphrase)
        }
      } else if (sshEnabled && sshAuthMethod === 'password' && sshPassword) {
        data.sshPassEnc = encryptSecret(sshPassword)
      }
    }

    // Validate PVE credentials before saving + auto-detect Ceph
    if (type === 'pve') {
      try {
        await pveFetch({ baseUrl, apiToken, insecureDev: insecureTLS }, "/version")
      } catch (e: any) {
        return NextResponse.json(
          { error: `PVE authentication failed: ${e?.message || 'Unable to connect'}` },
          { status: 400 }
        )
      }

      // Auto-detect Ceph: probe the first online node
      try {
        const nodes = await pveFetch<any[]>({ baseUrl, apiToken, insecureDev: insecureTLS }, "/nodes")
        const onlineNode = nodes?.find((n: any) => n.status === 'online') || nodes?.[0]

        if (onlineNode) {
          const cephStatus = await pveFetch<any>(
            { baseUrl, apiToken, insecureDev: insecureTLS },
            `/nodes/${encodeURIComponent(onlineNode.node)}/ceph/status`
          ).catch((e: any) => {
            console.log(`[ceph-detect] Ceph probe failed on ${onlineNode.node}: ${e?.message || 'unknown error'}`)
            return null
          })

          data.hasCeph = !!(cephStatus?.health)
          console.log(`[ceph-detect] Ceph detection result: ${data.hasCeph} (node: ${onlineNode.node})`)
        } else {
          console.log('[ceph-detect] No online node found for Ceph probe')
        }
      } catch (e: any) {
        // If probe fails, leave hasCeph as false
        console.log(`[ceph-detect] Ceph detection failed: ${e?.message || 'unknown error'}`)
        data.hasCeph = false
      }
    }

    // Validate PBS credentials before saving
    if (type === 'pbs') {
      try {
        await pbsFetch({ baseUrl, apiToken, insecureDev: insecureTLS }, "/version")
      } catch (e: any) {
        return NextResponse.json(
          { error: `PBS authentication failed: ${e?.message || 'Unable to connect'}` },
          { status: 400 }
        )
      }
    }

    // Validate VMware ESXi connectivity
    if (type === 'vmware') {
      try {
        const esxiUrl = baseUrl.replace(/\/$/, '')
        const fetchOpts: any = {
          signal: AbortSignal.timeout(10000),
        }
        // ESXi almost always uses self-signed certs — use undici Agent to bypass TLS
        if (insecureTLS) {
          fetchOpts.dispatcher = new (await import('undici')).Agent({ connect: { rejectUnauthorized: false } })
        }
        // Try /sdk/vimServiceVersions.xml first, fallback to / — accept any response (even 4xx) as proof of reachability
        const res = await fetch(`${esxiUrl}/sdk/vimServiceVersions.xml`, fetchOpts).catch(() => null)
          || await fetch(`${esxiUrl}/`, { ...fetchOpts, signal: AbortSignal.timeout(10000) }).catch(() => null)
        if (!res) {
          throw new Error('Unable to connect to ESXi host')
        }
      } catch (e: any) {
        return NextResponse.json(
          { error: `ESXi connection failed: ${e?.message || 'Unable to connect'}. Verify the host IP/hostname and network connectivity.` },
          { status: 400 }
        )
      }
    }

    // Validate XCP-ng (XO) connectivity
    if (type === 'xcpng') {
      try {
        const xoUrl = baseUrl.replace(/\/$/, '')
        const xoAuth = Buffer.from(`${vmwareUser || 'admin@admin.net'}:${vmwarePassword || ''}`).toString('base64')
        const fetchOpts: any = {
          headers: { 'Authorization': `Basic ${xoAuth}`, 'Accept': 'application/json' },
          signal: AbortSignal.timeout(15000),
        }
        if (insecureTLS) {
          fetchOpts.dispatcher = new (await import('undici')).Agent({ connect: { rejectUnauthorized: false } })
        }
        const res = await fetch(`${xoUrl}/rest/v0/hosts`, fetchOpts).catch((err: any) => {
          console.error(`[xcpng] Connection to ${xoUrl}/rest/v0/hosts failed:`, err?.message || err)
          return null
        })
        if (!res) {
          throw new Error('Unable to connect to XO server')
        }
        console.log(`[xcpng] XO responded with status ${res.status}`)
        if (res.status === 401) {
          throw new Error('Invalid credentials')
        }
        if (!res.ok) {
          throw new Error(`XO returned HTTP ${res.status}`)
        }
      } catch (e: any) {
        return NextResponse.json(
          { error: `XCP-ng XO connection failed: ${e?.message || 'Unable to connect'}. Verify the XO URL and credentials.` },
          { status: 400 }
        )
      }
    }

    const prisma = await getSessionPrisma()
    const created = await prisma.connection.create({
      data,
      select: {
        id: true,
        name: true,
        type: true,
        baseUrl: true,
        behindProxy: true,
        insecureTLS: true,
        hasCeph: true,
        latitude: true,
        longitude: true,
        locationLabel: true,
        sshEnabled: true,
        sshPort: true,
        sshUser: true,
        sshAuthMethod: true,
        sshUseSudo: true,
        createdAt: true,
        updatedAt: true,
      },
    })

    // Audit
    const { audit } = await import("@/lib/audit")

    await audit({
      action: "create",
      category: "connections",
      resourceType: "connection",
      resourceId: created.id,
      resourceName: name,
      details: { 
        type, 
        baseUrl, 
        insecureTLS, 
        hasCeph,
        sshEnabled,
        sshPort: sshEnabled ? sshPort : undefined,
        sshUser: sshEnabled ? sshUser : undefined,
        sshAuthMethod: sshEnabled ? sshAuthMethod : undefined,
      },
      status: "success",
    })

    // Notify orchestrator to reload connections immediately
    if (type === 'pve') {
      orchestratorFetch('/connections/reload', { method: 'POST' }).catch(() => {})
    }

    return NextResponse.json({
      data: {
        ...created,
        sshConfigured: sshEnabled && !!(sshKey || sshPassword)
      }
    }, { status: 201 })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
