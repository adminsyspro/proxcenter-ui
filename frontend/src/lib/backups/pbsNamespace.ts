// src/lib/backups/pbsNamespace.ts
// The PBS namespace of a vzdump job is NOT a job option: PVE has no namespace
// parameter on /cluster/backup (nor in prune-backups, which rejects `ns`). It
// is the `namespace` property of the PBS storage entry in storage.cfg
// (PVE/Storage/PBSPlugin.pm), so a job writes into the namespace of the
// storage it targets. These helpers read it from there and refuse a request
// asking for a namespace its storage does not carry.

import { NextResponse } from 'next/server'

import { pveFetch } from '@/lib/proxmox/client'

export const NAMESPACE_MISMATCH_CODE = 'namespace_storage_mismatch'

/** '' for the root namespace; surrounding slashes and blanks dropped. */
export function normalizeNamespace(ns: unknown): string {
  if (typeof ns !== 'string') return ''
  const value = ns.trim()
  // Index scan rather than a /^\/+|\/+$/ regex: the input comes from the
  // request body and the alternation backtracks on long runs of '/'.
  let start = 0
  let end = value.length
  while (start < end && value[start] === '/') start++
  while (end > start && value[end - 1] === '/') end--
  return value.slice(start, end)
}

/** Namespace of a storage entry from /storage, '' when none (root, or not PBS). */
export function storageNamespace(storage: unknown): string {
  return storage && typeof storage === 'object' ? normalizeNamespace((storage as Record<string, unknown>).namespace) : ''
}

/**
 * A namespace in the request body is only accepted when it is the one of the
 * target storage; empty is always fine (nothing to honour). Returns the 400 to
 * send, or null. The namespace itself is never forwarded to PVE.
 */
export async function namespaceMismatchResponse(conn: any, storageId: unknown, bodyNamespace: unknown): Promise<NextResponse | null> {
  const wanted = normalizeNamespace(bodyNamespace)
  if (!wanted || typeof storageId !== 'string' || !storageId) return null

  let actual = ''
  try {
    actual = storageNamespace(await pveFetch<any>(conn, `/storage/${encodeURIComponent(storageId)}`))
  } catch {
    // Unknown storage: PVE refuses the job itself with a clearer message.
    return null
  }
  if (actual === wanted) return null

  return NextResponse.json(
    {
      error: `The PBS namespace is set on the storage, not on the job: storage "${storageId}" writes to ${actual ? `namespace "${actual}"` : 'the root namespace'}, not "${wanted}". Pick a storage bound to that namespace.`,
      code: NAMESPACE_MISMATCH_CODE,
      storage: storageId,
      storageNamespace: actual,
      namespace: wanted,
    },
    { status: 400 },
  )
}
