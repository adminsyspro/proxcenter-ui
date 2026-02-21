// src/app/api/v1/connections/[id]/route.ts
import { NextResponse } from "next/server"

import { prisma } from "@/lib/db/prisma"
import { encryptSecret } from "@/lib/crypto/secret"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { invalidateConnectionCache } from "@/lib/connections/getConnection"
import { invalidateInventoryCache } from "@/lib/cache/inventoryCache"
import { updateConnectionSchema } from "@/lib/schemas"
import { orchestratorFetch } from "@/lib/orchestrator/client"

export const runtime = "nodejs"

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> | { id: string } }) {
  try {
    const params = await Promise.resolve(ctx.params)
    const id = (params as any)?.id

    if (!id) return NextResponse.json({ error: "Missing params.id" }, { status: 400 })

    // RBAC: Check connection.view permission
    const denied = await checkPermission(PERMISSIONS.CONNECTION_VIEW, "connection", id)

    if (denied) return denied

    const connection = await prisma.connection.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        type: true,
        baseUrl: true,
        uiUrl: true,
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
        // Pour vérifier si configuré
        sshKeyEnc: true,
        sshPassEnc: true,
        createdAt: true,
        updatedAt: true,
      },
    })

    if (!connection) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 })
    }

    // Retourner sans les secrets mais avec un indicateur
    const { sshKeyEnc, sshPassEnc, ...rest } = connection

    return NextResponse.json({ 
      data: {
        ...rest,
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
    if (body.uiUrl !== undefined) data.uiUrl = body.uiUrl || null
    if (body.insecureTLS !== undefined) data.insecureTLS = body.insecureTLS
    if (body.hasCeph !== undefined) data.hasCeph = body.hasCeph
    if (body.latitude !== undefined) data.latitude = body.latitude
    if (body.longitude !== undefined) data.longitude = body.longitude
    if (body.locationLabel !== undefined) data.locationLabel = body.locationLabel || null

    if (body.apiToken !== undefined && body.apiToken) {
      data.apiTokenEnc = encryptSecret(body.apiToken)
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
    if (body.sshAuthMethod !== undefined) data.sshAuthMethod = body.sshAuthMethod || null

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

    const updated = await prisma.connection.update({
      where: { id },
      data,
      select: {
        id: true,
        name: true,
        type: true,
        baseUrl: true,
        uiUrl: true,
        insecureTLS: true,
        hasCeph: true,
        latitude: true,
        longitude: true,
        locationLabel: true,
        sshEnabled: true,
        sshPort: true,
        sshUser: true,
        sshAuthMethod: true,
        sshKeyEnc: true,
        sshPassEnc: true,
        createdAt: true,
        updatedAt: true,
      },
    })

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

    // Retourner sans les secrets
    const { sshKeyEnc, sshPassEnc, ...rest } = updated

    return NextResponse.json({
      data: {
        ...rest,
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
