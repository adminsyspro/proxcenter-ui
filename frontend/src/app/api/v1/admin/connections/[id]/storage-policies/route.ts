// GET/POST /api/v1/admin/connections/{id}/storage-policies: provider-only
// storage-policy listing and creation. POST validates the input shape, then
// PVE-probes the storage (assertPolicyStorageValid, spec §8.1: unlike
// primaryStorage, a policy's storage IS checked against the cluster) before
// persisting. mapCreateVdcError maps the domain-lib error-message contracts
// (uniqueness/in-use to 409, the "Storage policy" prefix to 400).
import { NextResponse } from "next/server"

import { getConnectionById } from "@/lib/connections/getConnection"
import {
  listStoragePolicies,
  createStoragePolicy,
  normalizeStoragePolicyInput,
  validateStoragePolicyInput,
  assertPolicyStorageValid,
} from "@/lib/vdc/storagePolicies"
import { mapCreateVdcError } from "@/lib/vdc/httpErrors"
import { audit } from "@/lib/audit"

import { storagePolicyProviderGuard } from "./guard"

export const runtime = "nodejs"

type RouteContext = { params: Promise<{ id: string }> | { id: string } }

export async function GET(_req: Request, ctx: RouteContext) {
  try {
    const { id } = (await Promise.resolve(ctx.params)) as { id: string }
    const denied = await storagePolicyProviderGuard()
    if (denied) return denied
    return NextResponse.json({ data: await listStoragePolicies(id) })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

export async function POST(req: Request, ctx: RouteContext) {
  try {
    const { id } = (await Promise.resolve(ctx.params)) as { id: string }
    const denied = await storagePolicyProviderGuard()
    if (denied) return denied

    const body = await req.json()
    const input = normalizeStoragePolicyInput(body)
    validateStoragePolicyInput(input)
    const conn = await getConnectionById(id)
    await assertPolicyStorageValid(conn, input.storageId)

    const policy = await createStoragePolicy(id, input)

    await audit({
      action: "create",
      category: "settings",
      resourceType: "storage-policy",
      resourceId: policy.id,
      resourceName: policy.name,
      details: { connectionId: id, storageId: policy.storageId },
      status: "success",
    })
    return NextResponse.json({ data: policy }, { status: 201 })
  } catch (e: any) {
    const { status, message } = mapCreateVdcError(e)
    return NextResponse.json({ error: message }, { status })
  }
}
