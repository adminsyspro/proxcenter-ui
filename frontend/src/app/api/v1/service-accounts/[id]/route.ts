// /api/v1/service-accounts/{id} (issue #1404): read, rename, describe,
// enable or disable, delete. Disabling stops its tokens at once; deleting
// removes them with its roles. A token never changes its own account.
import { NextResponse } from "next/server"

import { withPublicApiGuard } from "@/lib/api-tokens/routeGuard"
import { withAudit } from "@/lib/audit/withAudit"
import { deleteServiceAccount, updateServiceAccount } from "@/lib/service-accounts"
import {
  errorResponse, identityReader, identityWriter, notFound, reachableServiceAccount, selfChangeRefusal,
} from "@/lib/service-accounts/access"

export const runtime = "nodejs"

type Ctx = { params: Promise<{ id: string }> }

async function handleGet(_req: Request, ctx: Ctx) {
  const caller = await identityReader()
  if (caller.denied) return caller.denied
  const { id } = await ctx.params
  const account = await reachableServiceAccount(caller, id)
  return account ? NextResponse.json({ data: account }) : notFound()
}

async function handlePatch(req: Request, ctx: Ctx) {
  const caller = await identityWriter()
  if (caller.denied) return caller.denied
  const { id } = await ctx.params
  if (!(await reachableServiceAccount(caller, id))) return notFound()
  const self = selfChangeRefusal(caller, id)
  if (self) return self
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  try {
    return NextResponse.json({ data: await updateServiceAccount(id, body) })
  } catch (e) {
    return errorResponse(e, "update")
  }
}

async function handleDelete(_req: Request, ctx: Ctx) {
  const caller = await identityWriter()
  if (caller.denied) return caller.denied
  const { id } = await ctx.params
  if (!(await reachableServiceAccount(caller, id))) return notFound()
  const self = selfChangeRefusal(caller, id)
  if (self) return self
  try {
    await deleteServiceAccount(id)
    return NextResponse.json({ data: { id, deleted: true } })
  } catch (e) {
    return errorResponse(e, "delete")
  }
}

export const GET = withPublicApiGuard("service-account-get", handleGet)
export const PATCH = withAudit({ category: "api_tokens", resourceType: "service_account", resourceParam: "id" }, withPublicApiGuard("service-account-update", handlePatch))
export const DELETE = withAudit({ category: "api_tokens", resourceType: "service_account", resourceParam: "id" }, withPublicApiGuard("service-account-delete", handleDelete))
