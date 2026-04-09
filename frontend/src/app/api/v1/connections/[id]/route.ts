// src/app/api/v1/connections/[id]/route.ts
import { NextResponse } from "next/server"

import { getSessionPrisma } from "@/lib/tenant"
import { encryptSecret, decryptSecret } from "@/lib/crypto/secret"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { invalidateConnectionCache } from "@/lib/connections/getConnection"
import { invalidateInventoryCache } from "@/lib/cache/inventoryCache"
import { updateConnectionSchema } from "@/lib/schemas"
import { orchestratorFetch } from "@/lib/orchestrator/client"
import { pveFetch } from "@/lib/proxmox/client"
import { discoverNodeIps } from "@/lib/proxmox/discoverNodeIps"

export const runtime = "nodejs"

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> | { id: string } }) {
  try {
    const prisma = await getSessionPrisma()
    const params = await Promise.resolve(ctx.params)
    const id = (params as any)?.id

    if (!id) return NextResponse.json({ error: "Missing params.id" }, { status: 400 })

    // RBAC: Check connection.view permission
    const denied = await checkPermission(PERMISSIONS.CONNECTION_VIEW, "connection", id)

    if (denied) return denied

    const connection = await prisma.connection.findUnique({
      where: { id },
    })

    if (!connection) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 })
    }

    // Retourner sans les secrets mais avec un indicateur
    // Read tags via raw SQL (in case Prisma client doesn't know the column yet)
    let tags: string | null = null
    try {
      const rows = await prisma.$queryRawUnsafe<any[]>('SELECT tags FROM "Connection" WHERE id = ?', id)
      tags = rows?.[0]?.tags ?? null
    } catch {}

    const { sshKeyEnc, sshPassEnc, apiTokenEnc, ...rest } = connection as any

    return NextResponse.json({
      data: {
        ...rest,
        tags,
        sshKeyConfigured: !!sshKeyEnc,
        sshPassConfigured: !!sshPassEnc,
        sshConfigured: !!(sshKeyEnc || sshPassEnc)
      }
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> | { id: string } }) {
  try {
    const prisma = await getSessionPrisma()
    const params = await Promise.resolve(ctx.params)
    const id = (params as any)?.id

    if (!id) return NextResponse.json({ error: "Missing params.id" }, { status: 400 })

    // RBAC: Check connection.manage permission
    const denied = await checkPermission(PERMISSIONS.CONNECTION_MANAGE, "connection", id)

    if (denied) return denied

    const rawBody = await req.json().catch(() => null)

    if (!rawBody) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })

    const parseResult = updateConnectionSchema.safeParse(rawBody)

    if (!parseResult.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parseResult.error.flatten() },
        { status: 400 }
      )
    }

    const body = parseResult.data
    const data: any = {}

    // Champs de base
    if (body.name !== undefined) data.name = body.name
    if (body.type !== undefined) data.type = body.type
    if (body.baseUrl !== undefined) data.baseUrl = body.baseUrl
    if (body.behindProxy !== undefined) data.behindProxy = !!body.behindProxy
    if (body.insecureTLS !== undefined) data.insecureTLS = body.insecureTLS
    if (body.latitude !== undefined) data.latitude = body.latitude
    if (body.longitude !== undefined) data.longitude = body.longitude
    if (body.locationLabel !== undefined) data.locationLabel = body.locationLabel || null
    // Tags are handled separately via raw SQL to avoid Prisma client cache issues
    const tagsUpdate = body.tags !== undefined ? body.tags || null : undefined

    if (body.subType !== undefined) data.subType = body.subType
    if (body.vmwareDatacenter !== undefined) data.vmwareDatacenter = body.vmwareDatacenter || null

    if (body.apiToken !== undefined && body.apiToken) {
      data.apiTokenEnc = encryptSecret(body.apiToken)
    }

    // VMware credentials
    if (body.vmwareUser !== undefined || body.vmwarePassword !== undefined) {
      // Need current credentials to merge
      const current = await prisma.connection.findUnique({
        where: { id },
        select: { apiTokenEnc: true },
      })
      let currentUser = 'root'
      let currentPass = ''
      if (current?.apiTokenEnc) {
        try {
          const creds = decryptSecret(current.apiTokenEnc)
          const colonIdx = creds.indexOf(':')
          if (colonIdx > 0) {
            currentUser = creds.substring(0, colonIdx)
            currentPass = creds.substring(colonIdx + 1)
          }
        } catch { /* ignore */ }
      }
      const newUser = body.vmwareUser || currentUser
      const newPass = body.vmwarePassword || currentPass
      data.apiTokenEnc = encryptSecret(`${newUser}:${newPass}`)
    }

    // Champs SSH
    if (body.sshEnabled !== undefined) {
      data.sshEnabled = body.sshEnabled

      // Si on désactive SSH, nettoyer les credentials
      if (!body.sshEnabled) {
        data.sshAuthMethod = null
        data.sshKeyEnc = null
        data.sshPassEnc = null
      }
    }

    if (body.sshPort !== undefined) data.sshPort = body.sshPort
    if (body.sshUser !== undefined) data.sshUser = body.sshUser || 'root'
    if (body.sshUseSudo !== undefined) data.sshUseSudo = body.sshUseSudo
    if (body.sshAuthMethod !== undefined) {
      data.sshAuthMethod = body.sshAuthMethod || null

      // Clear old credentials when switching auth method
      if (body.sshAuthMethod === 'password') {
        data.sshKeyEnc = null
      } else if (body.sshAuthMethod === 'key') {
        // Only clear password if no passphrase provided (password field reused for passphrase)
        if (!body.sshPassphrase) {
          data.sshPassEnc = null
        }
      }
    }

    // Mise à jour de la clé SSH
    if (body.sshKey !== undefined) {
      if (body.sshKey) {
        data.sshKeyEnc = encryptSecret(body.sshKey)
      } else {
        data.sshKeyEnc = null
      }
    }

    // Mise à jour de la passphrase ou du mot de passe SSH
    if (body.sshPassphrase !== undefined || body.sshPassword !== undefined) {
      const secret = body.sshPassphrase || body.sshPassword

      if (secret) {
        data.sshPassEnc = encryptSecret(secret)
      } else {
        data.sshPassEnc = null
      }
    }

    // Re-detect Ceph when connection details change (baseUrl, apiToken, insecureTLS)
    if (data.baseUrl !== undefined || data.apiTokenEnc !== undefined || data.insecureTLS !== undefined) {
      const existing = await prisma.connection.findUnique({
        where: { id },
        select: { type: true, baseUrl: true, apiTokenEnc: true, insecureTLS: true },
      })

      if (existing?.type === 'pve') {
        const baseUrl = data.baseUrl || existing.baseUrl
        const apiToken = data.apiTokenEnc ? decryptSecret(data.apiTokenEnc) : decryptSecret(existing.apiTokenEnc!)
        const insecureTLS = data.insecureTLS ?? existing.insecureTLS

        try {
          const nodes = await pveFetch<any[]>({ baseUrl, apiToken, insecureDev: insecureTLS }, "/nodes")
          const onlineNode = nodes?.find((n: any) => n.status === 'online') || nodes?.[0]

          if (onlineNode) {
            const cephStatus = await pveFetch<any>(
              { baseUrl, apiToken, insecureDev: insecureTLS },
              `/nodes/${encodeURIComponent(onlineNode.node)}/ceph/status`
            ).catch(() => null)

            data.hasCeph = !!(cephStatus?.health)
          }
        } catch {
          // If probe fails, don't change hasCeph
        }

        // Re-discover node IPs for failover (non-blocking)
        discoverNodeIps(
          { baseUrl, apiToken, insecureDev: insecureTLS, id },
          id
        ).catch(() => {})
      }
    }

    const updated = await prisma.connection.update({
      where: { id },
      data,
    })

    // Update tags via raw SQL (avoids Prisma client cache issues with new columns)
    if (tagsUpdate !== undefined) {
      await prisma.$executeRawUnsafe('UPDATE "Connection" SET tags = ? WHERE id = ?', tagsUpdate, id)
    }

    // Invalidate caches after update
    invalidateConnectionCache(id)
    invalidateInventoryCache()

    // Audit
    const { audit } = await import("@/lib/audit")
    const changes: Record<string, any> = { ...data }

    // Ne pas logger les secrets
    if (changes.apiTokenEnc) {
      changes.apiTokenChanged = true
      delete changes.apiTokenEnc
    }

    if (changes.sshKeyEnc) {
      changes.sshKeyChanged = true
      delete changes.sshKeyEnc
    }

    if (changes.sshPassEnc) {
      changes.sshPassChanged = true
      delete changes.sshPassEnc
    }
    
    await audit({
      action: "update",
      category: "connections",
      resourceType: "connection",
      resourceId: id,
      resourceName: updated.name,
      details: changes,
      status: "success",
    })

    // Notify orchestrator to reload connections immediately
    orchestratorFetch('/connections/reload', { method: 'POST' }).catch(() => {})

    // Read tags from raw SQL (in case Prisma client doesn't know the column yet)
    let tags: string | null = null
    try {
      const rows = await prisma.$queryRawUnsafe<any[]>('SELECT tags FROM "Connection" WHERE id = ?', id)
      tags = rows?.[0]?.tags ?? null
    } catch {}

    // Retourner sans les secrets
    const { sshKeyEnc, sshPassEnc, apiTokenEnc, ...rest } = updated as any

    return NextResponse.json({
      data: {
        ...rest,
        tags,
        sshKeyConfigured: !!sshKeyEnc,
        sshPassConfigured: !!sshPassEnc,
        sshConfigured: !!(sshKeyEnc || sshPassEnc)
      }
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> | { id: string } }) {
  try {
    const prisma = await getSessionPrisma()
    const params = await Promise.resolve(ctx.params)
    const id = (params as any)?.id

    if (!id) return NextResponse.json({ error: "Missing params.id" }, { status: 400 })

    // RBAC: Check connection.manage permission
    const denied = await checkPermission(PERMISSIONS.CONNECTION_MANAGE, "connection", id)

    if (denied) return denied

    // Récupérer le nom avant suppression pour l'audit
    const connection = await prisma.connection.findUnique({
      where: { id },
      select: { name: true, type: true, baseUrl: true },
    })

    // Option: supprime aussi les hosts gérés liés
    await prisma.managedHost.deleteMany({ where: { connectionId: id } }).catch(() => {})

    await prisma.connection.delete({ where: { id } })

    // Invalidate caches after deletion
    invalidateConnectionCache(id)
    invalidateInventoryCache()

    // Audit
    const { audit } = await import("@/lib/audit")

    await audit({
      action: "delete",
      category: "connections",
      resourceType: "connection",
      resourceId: id,
      resourceName: connection?.name,
      details: { type: connection?.type, baseUrl: connection?.baseUrl },
      status: "success",
    })

    // Notify orchestrator to reload connections immediately
    orchestratorFetch('/connections/reload', { method: 'POST' }).catch(() => {})

    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
