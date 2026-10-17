import { NextResponse } from "next/server"

import { getSetting, setSetting } from "@/lib/db/settings"
import type { Principal } from "@/lib/auth/principal"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { withPublicApiGuard } from "@/lib/api-tokens/routeGuard"

export const runtime = "nodejs"

const DEFAULTS = {
  enabled: false,
  state: "started",
  group: "",
  max_restart: 1,
  max_relocate: 1,
  comment: "Auto-HA",
}

type AutoHaSettings = typeof DEFAULTS

async function loadSettings(connId: string): Promise<AutoHaSettings> {
  const stored = await getSetting<Partial<AutoHaSettings>>(`auto_ha:${connId}`)
  return { ...DEFAULTS, ...(stored ?? {}) }
}

async function getHandler(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params
    const denied = await checkPermission(PERMISSIONS.NODE_VIEW)
    if (denied) return denied

    return NextResponse.json({ data: await loadSettings(id) })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

async function putHandler(req: Request, ctx: { params: Promise<{ id: string }>; principal?: Principal }) {
  try {
    const { id } = await ctx.params
    // An API token is judged on this connection. A session keeps the
    // resource-less check: the Auto-HA card is offered to node-scoped
    // node.manage holders, who never match a connection-scoped check.
    const denied = ctx.principal?.kind === "token"
      ? await checkPermission(PERMISSIONS.NODE_MANAGE, "connection", id)
      : await checkPermission(PERMISSIONS.NODE_MANAGE)
    if (denied) return denied

    const body = await req.json()
    const current = await loadSettings(id)

    const updated: AutoHaSettings = {
      enabled: typeof body.enabled === "boolean" ? body.enabled : current.enabled,
      state: ["started", "stopped", "enabled", "disabled"].includes(body.state) ? body.state : current.state,
      group: typeof body.group === "string" ? body.group : current.group,
      max_restart: typeof body.max_restart === "number" ? Math.max(0, Math.min(10, body.max_restart)) : current.max_restart,
      max_relocate: typeof body.max_relocate === "number" ? Math.max(0, Math.min(10, body.max_relocate)) : current.max_relocate,
      comment: typeof body.comment === "string" ? body.comment : current.comment,
    }

    await setSetting(`auto_ha:${id}`, "default", updated)
    return NextResponse.json({ data: updated })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

export const GET = withPublicApiGuard("ha-auto-get", getHandler)
export const PUT = withPublicApiGuard("ha-auto-update", putHandler)
