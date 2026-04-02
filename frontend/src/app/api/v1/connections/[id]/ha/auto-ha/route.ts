import { NextResponse } from "next/server"

import { getDb } from "@/lib/db/sqlite"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

const DEFAULTS = {
  enabled: false,
  state: "started",
  group: "",
  max_restart: 1,
  max_relocate: 1,
  comment: "Auto-HA",
}

function getSettings(connId: string) {
  const db = getDb()
  const row = db.prepare("SELECT value FROM settings WHERE key = ? AND tenant_id = ?").get(`auto_ha:${connId}`, "default") as any
  return { ...DEFAULTS, ...(row?.value ? JSON.parse(row.value) : {}) }
}

function saveSettings(connId: string, data: Record<string, any>) {
  const db = getDb()
  db.prepare(
    `INSERT OR REPLACE INTO settings (key, value, tenant_id, updated_at) VALUES (?, ?, 'default', datetime('now'))`
  ).run(`auto_ha:${connId}`, JSON.stringify(data))
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params
    const denied = await checkPermission(PERMISSIONS.NODE_VIEW)
    if (denied) return denied

    return NextResponse.json({ data: getSettings(id) })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params
    const denied = await checkPermission(PERMISSIONS.NODE_MANAGE)
    if (denied) return denied

    const body = await req.json()
    const current = getSettings(id)

    const updated = {
      enabled: typeof body.enabled === "boolean" ? body.enabled : current.enabled,
      state: ["started", "stopped", "enabled", "disabled"].includes(body.state) ? body.state : current.state,
      group: typeof body.group === "string" ? body.group : current.group,
      max_restart: typeof body.max_restart === "number" ? Math.max(0, Math.min(10, body.max_restart)) : current.max_restart,
      max_relocate: typeof body.max_relocate === "number" ? Math.max(0, Math.min(10, body.max_relocate)) : current.max_relocate,
      comment: typeof body.comment === "string" ? body.comment : current.comment,
    }

    saveSettings(id, updated)
    return NextResponse.json({ data: updated })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
