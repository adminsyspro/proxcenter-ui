// src/app/api/v1/connections/route.ts
import { NextResponse } from "next/server"

import { prisma } from "@/lib/db/prisma"
import { encryptSecret } from "@/lib/crypto/secret"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { createConnectionSchema } from "@/lib/schemas"
import { pbsFetch } from "@/lib/proxmox/pbs-client"

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

    const connections = await prisma.connection.findMany({
      where: Object.keys(where).length > 0 ? where : undefined,
      orderBy: { createdAt: "desc" },
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
        // Inclure les champs chiffrés pour vérifier si configuré (ne pas renvoyer au client)
        sshKeyEnc: true,
        sshPassEnc: true,
        createdAt: true,
        updatedAt: true,
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
      name, type, baseUrl, uiUrl, insecureTLS, hasCeph, apiToken,
      latitude, longitude, locationLabel,
      sshEnabled, sshPort, sshUser, sshAuthMethod,
      sshKey, sshPassphrase, sshPassword,
    } = parseResult.data

    // Préparer les données
    const data: any = {
      name,
      type,
      baseUrl,
      uiUrl,
      insecureTLS,
      hasCeph: type === 'pve' ? hasCeph : false, // Ceph uniquement pour PVE
      latitude: latitude ?? null,
      longitude: longitude ?? null,
      locationLabel: locationLabel ?? null,
      apiTokenEnc: encryptSecret(apiToken),
      sshEnabled,
      sshPort,
      sshUser,
      sshAuthMethod: sshEnabled ? sshAuthMethod : null,
    }

    // Chiffrer les secrets SSH si fournis
    if (sshEnabled && sshAuthMethod === 'key' && sshKey) {
      data.sshKeyEnc = encryptSecret(sshKey)
      // La passphrase est optionnelle pour les clés
      if (sshPassphrase) {
        data.sshPassEnc = encryptSecret(sshPassphrase)
      }
    } else if (sshEnabled && sshAuthMethod === 'password' && sshPassword) {
      data.sshPassEnc = encryptSecret(sshPassword)
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

    const created = await prisma.connection.create({
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
