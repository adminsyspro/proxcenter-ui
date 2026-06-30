// src/app/api/v1/connections/route.ts
import { NextResponse } from "next/server"
import type { Prisma } from "@prisma/client"

import { getSessionPrisma, getCurrentTenantId, DEFAULT_TENANT_ID } from "@/lib/tenant"
import { prisma as globalPrisma } from "@/lib/db/prisma"
import { getTenantInfrastructureScope } from "@/lib/tenant/infraScope"
import { encryptSecret } from "@/lib/crypto/secret"
import { checkPermission, PERMISSIONS, getRBACContext, getRbacInfraScope, filterVisibleConnections } from "@/lib/rbac"
import { createConnectionSchema } from "@/lib/schemas"
import { pbsFetch } from "@/lib/proxmox/pbs-client"
import { pveFetch } from "@/lib/proxmox/client"
import { orchestratorFetch } from "@/lib/orchestrator/client"
import { discoverNodeIps } from "@/lib/proxmox/discoverNodeIps"
import { captureFingerprint } from "@/lib/proxmox/pbsFingerprint"

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

    // Tenant scope: provider sees all; iaas sees its vDC-referenced connections;
    // msp sees the connections it directly owns (Connection.tenant_id).
    const tenantId = await getCurrentTenantId()
    const infra = await getTenantInfrastructureScope(tenantId)

    // RBAC infra-scope: resolve once before the query so post-fetch filtering
    // is O(1). Null means unrestricted (admin or global-scope grant).
    const rbacCtx = await getRBACContext()
    const rbacScope = rbacCtx && !rbacCtx.isAdmin
      ? await getRbacInfraScope(rbacCtx.userId, rbacCtx.tenantId)
      : null

    let prisma: typeof globalPrisma | Awaited<ReturnType<typeof getSessionPrisma>>
    if (infra.kind === "provider") {
      prisma = globalPrisma
    } else if (infra.kind === "msp") {
      prisma = await getSessionPrisma()
    } else {
      prisma = globalPrisma
      const pveIds = [...infra.vdcScope.connectionIds]
      const pbsIds = [...infra.vdcScope.pbsConnectionIds]
      where.id = {
        in: typeFilter === "pbs" ? pbsIds : typeFilter === "pve" ? pveIds : [...pveIds, ...pbsIds],
      }
    }

    // `prisma` is a union type (global | session); passing it directly to the
    // deeply-overloaded findMany generic trips TS2589. The concrete row type
    // is declared here so downstream mapping is fully typed without relying on
    // Prisma's generic inference across the union.
    interface ConnectionRow {
      id: string
      name: string
      type: string
      tenantId: string | null
      baseUrl: string
      behindProxy: boolean
      insecureTLS: boolean
      hasCeph: boolean
      latitude: number | null
      longitude: number | null
      locationLabel: string | null
      country: string | null
      fingerprint: string | null
      sshEnabled: boolean
      sshPort: number
      sshUser: string
      sshAuthMethod: string | null
      sshUseSudo: boolean
      sshKeyEnc: string | null
      sshPassEnc: string | null
      createdAt: Date
      updatedAt: Date
      hosts: { id: string; node: string; ip: string | null; enabled: boolean }[]
    }

    // Delegate to globalPrisma for the type signature (both clients share the
    // same schema); the union assignability check itself hits TS2589, so we
    // suppress it here. The cast is safe: both union members are PrismaClient
    // instances with identical connection model signatures.
    // @ts-expect-error TS2589: union assignability exceeds TS instantiation depth
    const typedPrisma: typeof globalPrisma = prisma
    const connections: ConnectionRow[] = await typedPrisma.connection.findMany({
      where: Object.keys(where).length > 0 ? where : undefined,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        type: true,
        tenantId: true,
        baseUrl: true,
        behindProxy: true,
        insecureTLS: true,
        hasCeph: true,
        latitude: true,
        longitude: true,
        locationLabel: true,
        country: true,
        fingerprint: true,
        sshEnabled: true,
        sshPort: true,
        sshUser: true,
        sshAuthMethod: true,
        sshUseSudo: true,
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

    // RBAC post-query filter: applied in memory after the prisma query so the
    // provider branch where clause is not touched (preserves existing behaviour
    // for admin/null scope). filterVisibleConnections is a no-op when rbacScope
    // is null (admin or unrestricted user).
    const visibleConnections = filterVisibleConnections(connections, rbacScope)

    // Calculer sshConfigured en mémoire sans N+1 queries
    const connectionsWithSSHStatus = visibleConnections.map((conn) => {
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
      subType, vmwareUser, vmwarePassword, vmwareDatacenter, hypervShareName,
      latitude, longitude, locationLabel, country,
      sshEnabled, sshPort, sshUser, sshAuthMethod,
      sshKey, sshPassphrase, sshPassword, sshUseSudo,
      ownerTenantId,
    } = parseResult.data

    // Create-with-owner (provider-only): the NOC can create a connection
    // directly owned by an MSP client tenant instead of creating it in the
    // pool and reassigning afterwards. Anyone else may only create for
    // themselves (the session tenant).
    const sessionTenantId = await getCurrentTenantId()
    let ownerTenant = sessionTenantId

    if (ownerTenantId && ownerTenantId !== sessionTenantId) {
      const infra = await getTenantInfrastructureScope(sessionTenantId)
      if (infra.kind !== 'provider') {
        return NextResponse.json(
          { error: "Only the provider can create a connection for another tenant" },
          { status: 403 }
        )
      }
      if (type !== 'pve' && type !== 'pbs') {
        return NextResponse.json(
          { error: "Only PVE and PBS connections can be owned by an MSP tenant" },
          { status: 400 }
        )
      }
      const target = await globalPrisma.tenant.findUnique({
        where: { id: ownerTenantId },
        select: { operatingModel: true, enabled: true },
      })
      if (!target) {
        return NextResponse.json({ error: `Unknown tenant: ${ownerTenantId}` }, { status: 400 })
      }
      if (target.operatingModel !== 'msp') {
        return NextResponse.json(
          { error: "The owner tenant must be an MSP tenant (or omit ownerTenantId for the provider pool)" },
          { status: 400 }
        )
      }
      // Mirrors the owner-reassign endpoint: no new connections for a tenant
      // that cannot log in or operate.
      if (!target.enabled) {
        return NextResponse.json(
          { error: `Tenant ${ownerTenantId} is disabled` },
          { status: 400 }
        )
      }
      ownerTenant = ownerTenantId
    }

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
      country: country ?? null,
    }

    if (type === 'vmware' || type === 'xcpng' || type === 'hyperv' || type === 'nutanix') {
      // VMware/XCP-ng/Hyper-V/Nutanix: store "user:password" in apiTokenEnc
      const defaultUser = type === 'xcpng' ? 'admin@admin.net' : type === 'hyperv' ? 'Administrator' : type === 'nutanix' ? 'admin' : 'root'
      data.apiTokenEnc = encryptSecret(`${vmwareUser || defaultUser}:${vmwarePassword || ''}`)
      if (type === 'vmware') {
        data.subType = subType || 'esxi'
        data.vmwareDatacenter = vmwareDatacenter || null
      }
      if (type === 'hyperv') {
        data.hypervShareName = hypervShareName || 'VMs'
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

    // Best-effort PBS TLS fingerprint capture at create time. Without it,
    // the vDC binding selector hides the connection in auto-mode (which
    // needs the fingerprint to authenticate the API calls that
    // provision the namespace, sub-token and ACL on PBS). If the host
    // is unreachable or the cert probe fails, the connection is still
    // saved with fingerprint=null and the user can re-capture later via
    // ConnectionDialog → "Capture fingerprint".
    if (type === 'pbs') {
      try {
        data.fingerprint = await captureFingerprint(baseUrl)
      } catch (e: any) {
        console.warn(`[connections] PBS fingerprint capture failed for ${baseUrl}: ${e?.message ?? e}`)
      }
    }

    // v1.5: create the connection and (for provider-owned PVE) its
    // provider_connections row atomically. The pool-sync trigger is DEFERRABLE
    // INITIALLY DEFERRED and validates at COMMIT, so both rows must land in one
    // transaction. Use the GLOBAL client (provider_connections has no tenant_id
    // column) and set tenant_id explicitly instead of relying on the
    // tenant-scoped client's injection. An MSP-owned connection gets NO pool
    // row (the connection_tenant_model_check trigger validates the owner).
    const tenantId = ownerTenant
    const created = await globalPrisma.$transaction(async (tx) => {
      const conn = await tx.connection.create({
        data: { ...data, tenantId },
        select: {
          id: true, name: true, type: true, baseUrl: true, behindProxy: true,
          insecureTLS: true, hasCeph: true, latitude: true, longitude: true,
          locationLabel: true, country: true, sshEnabled: true, sshPort: true,
          sshUser: true, sshAuthMethod: true, sshUseSudo: true, createdAt: true,
          updatedAt: true,
        },
      })
      if (conn.type === 'pve' && tenantId === DEFAULT_TENANT_ID) {
        await tx.providerConnection.create({ data: { connectionId: conn.id } })
      }
      return conn
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

    // Discover node IPs for failover (non-blocking, after connection is saved)
    if (type === 'pve') {
      discoverNodeIps(
        { baseUrl, apiToken, insecureDev: insecureTLS, id: created.id },
        created.id
      ).catch(() => {})
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
