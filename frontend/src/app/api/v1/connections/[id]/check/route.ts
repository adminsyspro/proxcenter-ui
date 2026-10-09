import { NextResponse } from "next/server"

import { runConnectionCheck } from "@/lib/connections/check/runConnectionCheck"
import type { CheckContext } from "@/lib/connections/check/types"
import { getConnectionById } from "@/lib/connections/getConnection"
import { decryptSecret } from "@/lib/crypto/secret"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { getSessionPrisma } from "@/lib/tenant"

export const runtime = "nodejs"

/**
 * POST /api/v1/connections/[id]/check
 *
 * Read-only diagnostic of a Proxmox VE connection: API reachability of the
 * primary and fallback hosts, TLS certificate and pinned fingerprint, token
 * privileges, PVE version per node, clock skew, quorum, and one SSH attempt
 * per node when SSH is configured. Answers `{ items }`, each item carrying a
 * hint code the UI translates. Nothing is written to PVE.
 */
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const prisma = await getSessionPrisma()
    const params = await Promise.resolve(ctx.params)
    const id = (params as { id?: string })?.id

    if (!id) {
      return NextResponse.json({ error: "Missing params.id" }, { status: 400 })
    }

    // Same gate as test-ssh: the check reads the token's permissions and may
    // open SSH sessions, which is the manager's business, not the viewer's.
    const denied = await checkPermission(PERMISSIONS.CONNECTION_MANAGE, "connection", id)
    if (denied) return denied

    const row = await prisma.connection.findUnique({
      where: { id },
      select: {
        id: true,
        type: true,
        fingerprint: true,
        sshEnabled: true,
        sshPort: true,
        sshUser: true,
        sshAuthMethod: true,
        sshKeyEnc: true,
        sshPassEnc: true,
      },
    })

    if (!row) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 })
    }

    if (row.type !== "pve") {
      return NextResponse.json({ error: "Connection check is only available for Proxmox VE connections" }, { status: 400 })
    }

    const conn = await getConnectionById(id)

    const managedHosts = await prisma.managedHost.findMany({
      where: { connectionId: id },
      select: { node: true, ip: true, enabled: true, sshAddress: true, sshPort: true },
    })

    const ssh: CheckContext["ssh"] = {
      enabled: !!row.sshEnabled,
      user: row.sshUser || "root",
      port: row.sshPort || 22,
      overrides: managedHosts.map(h => ({ node: h.node, sshAddress: h.sshAddress ?? null, sshPort: h.sshPort ?? null })),
    }

    // Same precedence as the diagnostics route: a stored key means key auth
    // whatever sshAuthMethod says (legacy rows), a password only without a key.
    if (row.sshEnabled && row.sshKeyEnc) {
      try { ssh.key = decryptSecret(row.sshKeyEnc) } catch { /* reported as ssh.noCredentials */ }
      if (row.sshPassEnc) {
        try { ssh.passphrase = decryptSecret(row.sshPassEnc) } catch { /* key without passphrase */ }
      }
    } else if (row.sshEnabled && row.sshPassEnc) {
      try { ssh.password = decryptSecret(row.sshPassEnc) } catch { /* reported as ssh.noCredentials */ }
    }

    const context: CheckContext = {
      connectionId: id,
      conn: {
        id: conn.id,
        baseUrl: conn.baseUrl,
        apiToken: conn.apiToken,
        insecureDev: conn.insecureDev,
        behindProxy: conn.behindProxy,
      },
      fallbackHosts: managedHosts
        .filter(h => h.enabled && h.ip)
        .map(h => ({ node: h.node, ip: h.ip as string })),
      pinnedFingerprint: row.fingerprint || null,
      ssh,
    }

    const items = await runConnectionCheck(context)

    return NextResponse.json({ items })
  } catch (e: unknown) {
    console.error("[connection-check] Error:", e)

    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    )
  }
}
