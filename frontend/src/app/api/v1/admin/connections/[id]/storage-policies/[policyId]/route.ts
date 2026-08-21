// PUT/DELETE /api/v1/admin/connections/{id}/storage-policies/{policyId}:
// provider-only storage-policy update and deletion.
//
// updateStoragePolicy/deleteStoragePolicy throw a raw Prisma P2025 on an
// unknown policyId. We check existence AND connection ownership up front
// (findPolicyForConnection) so an unknown id, or one belonging to another
// connection, gets a clean 404 instead of a 500. This also closes a
// cross-connection policy edit via a forged URL (../{otherConnId}/...).
import { NextResponse } from "next/server"

import { prisma } from "@/lib/db/prisma"
import { getConnectionById } from "@/lib/connections/getConnection"
import {
  updateStoragePolicy,
  deleteStoragePolicy,
  normalizeStoragePolicyInput,
  validateStoragePolicyInput,
  assertPolicyStorageValid,
  clearScopeCacheForPolicy,
} from "@/lib/vdc/storagePolicies"
import { mapCreateVdcError } from "@/lib/vdc/httpErrors"
import { audit } from "@/lib/audit"

import { storagePolicyProviderGuard } from "../guard"

export const runtime = "nodejs"

type RouteContext = { params: Promise<{ id: string; policyId: string }> | { id: string; policyId: string } }

async function findPolicyForConnection(
  connectionId: string,
  policyId: string
): Promise<{ name: string } | null> {
  const row = await prisma.storagePolicy.findUnique({
    where: { id: policyId },
    select: { connectionId: true, name: true },
  })
  if (!row || row.connectionId !== connectionId) return null
  return { name: row.name }
}

export async function PUT(req: Request, ctx: RouteContext) {
  try {
    const { id, policyId } = (await Promise.resolve(ctx.params)) as { id: string; policyId: string }
    const denied = await storagePolicyProviderGuard()
    if (denied) return denied

    const existing = await findPolicyForConnection(id, policyId)
    if (!existing) return NextResponse.json({ error: "Storage policy not found" }, { status: 404 })

    const body = await req.json()
    const input = normalizeStoragePolicyInput(body)
    validateStoragePolicyInput(input)
    const conn = await getConnectionById(id)
    await assertPolicyStorageValid(conn, input.storageId)

    const policy = await updateStoragePolicy(policyId, input)
    await clearScopeCacheForPolicy(policyId)

    await audit({
      action: "update",
      category: "settings",
      resourceType: "storage-policy",
      resourceId: policy.id,
      resourceName: policy.name,
      details: { connectionId: id, storageId: policy.storageId },
      status: "success",
    })
    return NextResponse.json({ data: policy })
  } catch (e: any) {
    const { status, message } = mapCreateVdcError(e)
    return NextResponse.json({ error: message }, { status })
  }
}

export async function DELETE(_req: Request, ctx: RouteContext) {
  try {
    const { id, policyId } = (await Promise.resolve(ctx.params)) as { id: string; policyId: string }
    const denied = await storagePolicyProviderGuard()
    if (denied) return denied

    const existing = await findPolicyForConnection(id, policyId)
    if (!existing) return NextResponse.json({ error: "Storage policy not found" }, { status: 404 })

    await deleteStoragePolicy(policyId)

    await audit({
      action: "delete",
      category: "settings",
      resourceType: "storage-policy",
      resourceId: policyId,
      resourceName: existing.name,
      details: { connectionId: id },
      status: "success",
    })
    return NextResponse.json({ success: true })
  } catch (e: any) {
    const { status, message } = mapCreateVdcError(e)
    return NextResponse.json({ error: message }, { status })
  }
}
