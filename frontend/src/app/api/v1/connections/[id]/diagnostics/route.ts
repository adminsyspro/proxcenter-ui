// src/app/api/v1/connections/[id]/diagnostics/route.ts
//
// GET handler for connection diagnostics.
// Read-only: runs health checks, returns a DiagnosticReport. No mutations.

import { NextResponse } from "next/server"

import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { getCurrentTenantId } from "@/lib/tenant"
import { getTenantInfrastructureScope } from "@/lib/tenant/infraScope"
import { getConnectionById, getPbsConnectionById } from "@/lib/connections/getConnection"
import { runConnectionDiagnostics, type DiagnosticMeta } from "@/lib/diagnostics/connectionDiagnostics"
import { prisma } from "@/lib/db/prisma"
import { decryptSecret } from "@/lib/crypto/secret"
import { getNodeIp } from "@/lib/ssh/node-ip"

export const runtime = "nodejs"

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> | { id: string } },
) {
  try {
    const params = await Promise.resolve(ctx.params)
    const id = (params as any)?.id

    if (!id) {
      return NextResponse.json({ error: "Missing params.id" }, { status: 400 })
    }

    // Look up the connection type first so we can route to the correct permission
    // resource. PBS connections must be gated on BACKUP_VIEW/"pbs", not
    // CONNECTION_VIEW/"connection", to align with the rest of the /pbs/[id] routes.
    const typeMeta = await prisma.connection.findUnique({
      where: { id },
      select: { type: true, tenantId: true },
    })

    // RBAC BEFORE revealing existence, so an unauthenticated/unauthorized caller
    // always gets 401/403 (never a 404) and cannot enumerate connection ids.
    // PBS connections require backup.view on "pbs"; others require connection.view
    // on "connection". For an unknown/nonexistent id, fall back to connection.view
    // so the no-access path is indistinguishable from the not-found path.
    const isPbs = typeMeta?.type === "pbs"
    const denied = isPbs
      ? await checkPermission(PERMISSIONS.BACKUP_VIEW, "pbs", id)
      : await checkPermission(PERMISSIONS.CONNECTION_VIEW, "connection", id)
    if (denied) return denied

    if (!typeMeta) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 })
    }

    // Determine whether the caller also holds connection.manage. The SSH check
    // has a side effect (host-key TOFU pinning) and must only run for managers.
    // We do NOT return the denial here -- a view-only caller gets a 200 with the
    // SSH check skipped rather than a 403.
    const canManage =
      (await checkPermission(PERMISSIONS.CONNECTION_MANAGE, "connection", id)) === null

    // Load the full connection row (global lookup so the provider can open any connection).
    const raw = await prisma.connection.findUnique({
      where: { id },
      select: {
        id: true,
        type: true,
        name: true,
        baseUrl: true,
        hasCeph: true,
        sshEnabled: true,
        sshPort: true,
        sshUser: true,
        sshAuthMethod: true,
        sshKeyEnc: true,
        sshPassEnc: true,
        tenantId: true,
      },
    })

    if (!raw) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 })
    }

    // Whole-cluster access gate: diagnostics report cluster-wide health (storage,
    // nodes, Ceph, PBS). Provider may diagnose any connection; an MSP tenant may
    // diagnose connections it owns; iaas/vDC tenants are blocked because they only
    // hold an abstracted vDC slice and must not see cluster-wide health.
    // This mirrors the canMigrateConnections gate in infraScope.
    const tenantId = await getCurrentTenantId()
    const infra = await getTenantInfrastructureScope(tenantId)
    const allowed =
      infra.kind === "provider" ||
      (infra.kind === "msp" && infra.connectionIds.has(id))
    if (!allowed) {
      return NextResponse.json(
        { error: "Diagnostics are available to the provider or the owning MSP tenant" },
        { status: 403 },
      )
    }

    const connType = raw.type ?? "pve"

    // Build the DiagnosticMeta object with SSH credentials when SSH is enabled.
    const meta: DiagnosticMeta = {
      connectionId: id,
      type: connType,
      hasCeph: raw.hasCeph,
      sshEnabled: raw.sshEnabled,
      sshPort: raw.sshPort ?? 22,
      sshUser: raw.sshUser ?? "root",
      baseUrl: raw.baseUrl ?? undefined,
      canManage,
    }

    // SSH credential derivation: mirror the precedence used by test-ssh and the
    // SSH exec helpers. When sshKeyEnc is present, treat it as key auth regardless
    // of whether sshAuthMethod is explicitly set to 'key' (legacy rows can have a
    // populated sshKeyEnc with sshAuthMethod null). Only fall back to password auth
    // when there is no sshKeyEnc.
    if (raw.sshEnabled && raw.sshKeyEnc) {
      try { meta.sshKey = decryptSecret(raw.sshKeyEnc) } catch { /* proceed without */ }
      if (raw.sshPassEnc) {
        try { meta.sshPassphrase = decryptSecret(raw.sshPassEnc) } catch { /* ignore */ }
      }
    } else if (raw.sshEnabled && raw.sshPassEnc) {
      try { meta.sshPassword = decryptSecret(raw.sshPassEnc) } catch { /* proceed without */ }
    }

    // Load client configs using the row's tenantId so that the provider can open
    // an MSP-owned connection (NOC troubleshooting). Mirrors the inventory
    // cross-tenant pattern.
    let pveConn: import("@/lib/proxmox/client").ProxmoxClientOptions | undefined
    let pbsConn: import("@/lib/proxmox/pbs-client").PbsClientOptions | undefined

    if (connType === "pbs") {
      pbsConn = await getPbsConnectionById(id, raw.tenantId)
    } else if (connType === "pve") {
      pveConn = await getConnectionById(id, raw.tenantId)

      // Resolve SSH host for the first online node (best-effort).
      if (raw.sshEnabled && pveConn) {
        try {
          const { pveFetch } = await import("@/lib/proxmox/client")
          const nodes = await pveFetch<any[]>(pveConn, "/nodes")
          const firstOnline = (nodes ?? []).find((n: any) => n.status === "online") ?? nodes?.[0]
          if (firstOnline?.node) {
            meta.sshHost = await getNodeIp(pveConn, firstOnline.node as string)
          }
        } catch {
          // SSH host resolution is best-effort; the ssh check will skip if missing.
        }
      }
    }
    // For external types (vmware, xcpng, etc.) we pass neither pveConn nor pbsConn.

    const report = await runConnectionDiagnostics(meta, pveConn, pbsConn)

    return NextResponse.json(report)
  } catch (e: any) {
    console.error("[diagnostics] unexpected error:", e)
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
