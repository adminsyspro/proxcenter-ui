// src/app/api/v1/connections/[id]/route.ts
import { NextResponse } from "next/server"

import { prisma } from "@/lib/db/prisma"
import { encryptSecret } from "@/lib/crypto/secret"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

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

    const body = await req.json().catch(() => null)

    if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })

    const data: any = {}

    // Champs de base
    if (body.name !== undefined) data.name = String(body.name).trim()

    if (body.type !== undefined) {
      const type = String(body.type).trim()

      if (!['pve', 'pbs'].includes(type)) {
        return NextResponse.json({ error: "type must be 'pve' or 'pbs'" }, { status: 400 })
      }

      data.type = type
    }

    if (body.baseUrl !== undefined) data.baseUrl = String(body.baseUrl).trim()
    if (body.uiUrl !== undefined) data.uiUrl = body.uiUrl ? String(body.uiUrl).trim() : null
    if (body.insecureTLS !== undefined) data.insecureTLS = !!body.insecureTLS
    if (body.hasCeph !== undefined) data.hasCeph = !!body.hasCeph

    if (body.apiToken !== undefined && String(body.apiToken).trim()) {
      data.apiTokenEnc = encryptSecret(String(body.apiToken).trim())
    }

    // Champs SSH
    if (body.sshEnabled !== undefined) {
      data.sshEnabled = !!body.sshEnabled
      
      // Si on désactive SSH, nettoyer les credentials
      if (!body.sshEnabled) {
        data.sshAuthMethod = null
        data.sshKeyEnc = null
        data.sshPassEnc = null
      }
    }

    if (body.sshPort !== undefined) {
      const port = parseInt(String(body.sshPort), 10)

      if (port < 1 || port > 65535) {
        return NextResponse.json({ error: "sshPort must be between 1 and 65535" }, { status: 400 })
      }

      data.sshPort = port
    }

    if (body.sshUser !== undefined) {
      data.sshUser = String(body.sshUser).trim() || 'root'
    }

    if (body.sshAuthMethod !== undefined) {
      const method = body.sshAuthMethod ? String(body.sshAuthMethod).trim() : null

      if (method && !['key', 'password'].includes(method)) {
        return NextResponse.json({ error: "sshAuthMethod must be 'key' or 'password'" }, { status: 400 })
      }

      data.sshAuthMethod = method
    }

    // Mise à jour de la clé SSH
    if (body.sshKey !== undefined) {
      if (body.sshKey) {
        data.sshKeyEnc = encryptSecret(String(body.sshKey).trim())
      } else {
        data.sshKeyEnc = null
      }
    }

    // Mise à jour de la passphrase ou du mot de passe SSH
    if (body.sshPassphrase !== undefined || body.sshPassword !== undefined) {
      const secret = body.sshPassphrase || body.sshPassword

      if (secret) {
        data.sshPassEnc = encryptSecret(String(secret).trim())
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

    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
