// src/app/api/v1/templates/deployments/[id]/route.ts
import { NextResponse } from "next/server"

import { getSessionPrisma } from "@/lib/tenant"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { withAudit } from "@/lib/audit/withAudit"
import { withPublicApiGuard } from "@/lib/api-tokens/routeGuard"
import type { Principal } from "@/lib/auth/principal"
import { withoutCloudInitSecrets } from "@/lib/templates/blueprintSecrets"

export const runtime = "nodejs"

async function handleGet(_req: Request, ctx: { params: Promise<{ id: string }> | { id: string }; principal?: Principal }) {
  try {
    const prisma = await getSessionPrisma()
    const params = await Promise.resolve(ctx.params)
    const id = (params as any)?.id
    if (!id) return NextResponse.json({ error: "Missing params.id" }, { status: 400 })

    const denied = await checkPermission(PERMISSIONS.VM_VIEW)
    if (denied) return denied

    // The scoped client only returns the caller's own tenant rows. A token
    // restricted to connections only follows deployments on them, and gets
    // the progress alone: the stored config is the wizard's retry input.
    const principal = ctx.principal
    const deployment = await prisma.deployment.findUnique({ where: { id } })
    const outside = principal?.kind === "token" && principal.connectionIds !== null && !principal.connectionIds.includes(deployment?.connectionId ?? "")
    if (!deployment || outside) return NextResponse.json({ error: "Deployment not found" }, { status: 404 })

    if (principal?.kind === "token") {
      const { config: _config, ...progress } = deployment
      return NextResponse.json({ data: progress })
    }
    const config = deployment.config && typeof deployment.config === "object" && !Array.isArray(deployment.config)
      ? withoutCloudInitSecrets(deployment.config as { cloudInit?: unknown })
      : deployment.config
    return NextResponse.json({ data: { ...deployment, config } })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

async function handleDelete(_req: Request, ctx: { params: Promise<{ id: string }> | { id: string } }) {
  try {
    const prisma = await getSessionPrisma()
    const params = await Promise.resolve(ctx.params)
    const id = (params as any)?.id
    if (!id) return NextResponse.json({ error: "Missing params.id" }, { status: 400 })

    const denied = await checkPermission(PERMISSIONS.VM_CREATE)
    if (denied) return denied

    await prisma.deployment.delete({ where: { id } }).catch(() => {})

    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

export const DELETE = withAudit({ category: "templates", resourceType: "deployment", resourceParam: "id" }, handleDelete)

export const GET = withPublicApiGuard("template-deployment-get", handleGet)
