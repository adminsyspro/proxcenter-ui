// src/lib/proxmox/pbsJobConfig.ts
import { NextResponse } from "next/server"

import { demoResponse } from "@/lib/demo/demo-api"
import { pbsFetch } from "@/lib/proxmox/pbs-client"
import { getPbsConnectionById } from "@/lib/connections/getConnection"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { PbsJobRequestError, type PbsJobSpec } from "@/lib/proxmox/pbsJobSpecs"

/**
 * Squelette commun aux routes d'un job PBS adresse par son id. Les quatre
 * families (sync, verify, prune, tape backup) partageaient mot pour mot le
 * mode demo, la lecture des params, le controle RBAC, l'ouverture de la
 * connexion, l'appel PBS et le journal d'erreur : ce chemin n'est desormais
 * ecrit et teste qu'une fois, chaque route n'apportant que son
 * [[PbsJobSpec]].
 */
export type PbsJobRouteContext = {
  params: Promise<{ id: string; jobId: string }>
}

export type PbsJobCollectionContext = {
  params: Promise<{ id: string }>
}

/** Message d'erreur reduit a une seule ligne avant d'entrer dans le journal. */
function logLine(e: unknown): string {
  return String((e as any)?.message || e).replace(/[\r\n]/g, "")
}

function itemPath(spec: PbsJobSpec, jobId: string): string {
  return `${spec.configPath}/${encodeURIComponent(jobId)}`
}

export async function createPbsJobConfig(
  req: Request,
  ctx: PbsJobCollectionContext,
  spec: PbsJobSpec
): Promise<Response> {
  const demo = demoResponse(req)
  if (demo) return demo

  try {
    const { id } = await ctx.params
    const body = await req.json()

    if (!id) {
      return NextResponse.json({ error: "Missing PBS connection ID" }, { status: 400 })
    }

    const denied = await checkPermission(PERMISSIONS.BACKUP_JOB_CREATE, "pbs", id)

    if (denied) return denied

    const conn = await getPbsConnectionById(id)

    const result = await pbsFetch<any>(conn, spec.configPath, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(spec.buildCreate(body)),
    })

    return NextResponse.json({ data: result, message: `${spec.label} created successfully` })
  } catch (e: any) {
    if (e instanceof PbsJobRequestError) {
      return NextResponse.json({ error: e.message }, { status: 400 })
    }

    console.error(`[${spec.logTag}] POST Error:`, logLine(e))

    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

export async function updatePbsJobConfig(
  req: Request,
  ctx: PbsJobRouteContext,
  spec: PbsJobSpec
): Promise<Response> {
  const demo = demoResponse(req)
  if (demo) return demo

  try {
    const { id, jobId } = await ctx.params
    const body = await req.json()

    if (!id || !jobId) {
      return NextResponse.json({ error: "Missing parameters" }, { status: 400 })
    }

    const denied = await checkPermission(PERMISSIONS.BACKUP_JOB_EDIT, "pbs", id)

    if (denied) return denied

    const conn = await getPbsConnectionById(id)

    const result = await pbsFetch<any>(conn, itemPath(spec, jobId), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(spec.buildUpdate(body)),
    })

    return NextResponse.json({ data: result, message: `${spec.label} updated successfully` })
  } catch (e: any) {
    console.error(`[${spec.logTag}] PUT Error:`, logLine(e))

    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

export async function deletePbsJobConfig(
  req: Request,
  ctx: PbsJobRouteContext,
  spec: PbsJobSpec
): Promise<Response> {
  const demo = demoResponse(req)
  if (demo) return demo

  try {
    const { id, jobId } = await ctx.params

    if (!id || !jobId) {
      return NextResponse.json({ error: "Missing parameters" }, { status: 400 })
    }

    const denied = await checkPermission(PERMISSIONS.BACKUP_JOB_DELETE, "pbs", id)

    if (denied) return denied

    const conn = await getPbsConnectionById(id)

    await pbsFetch<any>(conn, itemPath(spec, jobId), { method: "DELETE" })

    return NextResponse.json({ message: `${spec.label} deleted successfully` })
  } catch (e: any) {
    console.error(`[${spec.logTag}] DELETE Error:`, logLine(e))

    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
