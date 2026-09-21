import { NextResponse } from "next/server"

import { orchestratorFetch } from "@/lib/orchestrator"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { listPinnedHostKeys } from "@/lib/ssh/host-key-store"

export const runtime = "nodejs"

/** One row as the Go orchestrator serves it (snake_case, bare host, no port). */
interface OrchestratorHostKeyRow {
  host?: string
  key_type?: string
  pinned_at?: string
}

interface OrchestratorHostKeys {
  hosts?: OrchestratorHostKeyRow[] | null
}

/** One merged row: a single bare host, whatever store(s) pinned it. */
export interface MergedHostKey {
  host: string
  keyTypes: string[]
  pinnedAt: string
  sources: string[]
}

/**
 * Strip the ":port" suffix the frontend store appends so a row lines up with
 * the orchestrator's bare-host key. Only a trailing numeric group is removed:
 * rows written before the store was keyed by port carry the bare host and must
 * survive untouched.
 */
export function bareHost(host: string): string {
  const h = host.trim().toLowerCase()
  // Only an unambiguous "host:port" is stripped. An IPv6 literal carries
  // several colons and its last group can look exactly like a port, so a
  // blind strip would turn fe80::1 into "fe80:" and the re-trust action
  // would then clear nothing. Such a row stays listed under its own name.
  if ((h.match(/:/g)?.length ?? 0) !== 1) return h
  return h.replace(/:\d{1,5}$/, "")
}

interface Accumulator {
  keyTypes: Set<string>
  /** Epoch ms of the earliest pin seen for this host, across both stores. */
  pinnedAt: number
  sources: Set<string>
}

function accumulate(
  rows: Map<string, Accumulator>,
  host: string,
  keyType: string,
  pinnedAt: Date | string | null | undefined,
  source: string
): void {
  const key = bareHost(host)
  if (!key) return

  let entry = rows.get(key)
  if (!entry) {
    entry = { keyTypes: new Set<string>(), pinnedAt: Number.POSITIVE_INFINITY, sources: new Set<string>() }
    rows.set(key, entry)
  }

  if (keyType) entry.keyTypes.add(keyType)
  entry.sources.add(source)

  const ts = pinnedAt instanceof Date ? pinnedAt.getTime() : Date.parse(String(pinnedAt ?? ""))
  if (Number.isFinite(ts) && ts < entry.pinnedAt) entry.pinnedAt = ts
}

// GET /api/v1/ssh/host-keys
//
// Lists every pinned SSH host key, merging the two TOFU stores ProxCenter
// keeps: the Go orchestrator's `ssh_known_hosts` (bare host, no port) and the
// frontend ssh2 store `ssh_host_keys` (keyed "host:port"). One row per bare
// host so the settings screen can offer a single "re-trust" action that clears
// both (#979).
//
// The two stores legitimately hold DIFFERENT key types for one host: the Go
// client and ssh2 negotiate different algorithms against the same daemon. That
// is not a mismatch, so every type seen is listed.
//
// The orchestrator is optional: it may be down, and a Community deployment has
// none at all. Its absence degrades the list (frontend rows only) rather than
// failing the route, and is reported as `orchestratorUnavailable` so the UI can
// say the orchestrator pin could not be read.
export async function GET() {
  try {
    const denied = await checkPermission(PERMISSIONS.CONNECTION_VIEW)
    if (denied) return denied

    const rows = new Map<string, Accumulator>()

    let orchestratorUnavailable = false
    try {
      const data = await orchestratorFetch<OrchestratorHostKeys>("/ssh/host-keys")
      for (const row of data?.hosts ?? []) {
        if (!row?.host) continue
        accumulate(rows, row.host, row.key_type || "", row.pinned_at, "orchestrator")
      }
    } catch (error: any) {
      orchestratorUnavailable = true
      if (error?.code !== "ORCHESTRATOR_UNAVAILABLE") {
        console.error(
          "Failed to list orchestrator SSH host keys:",
          String(error?.message || "").replace(/[\r\n]/g, "")
        )
      }
    }

    for (const row of await listPinnedHostKeys()) {
      if (!row?.host) continue
      accumulate(rows, row.host, row.keyType || "", row.firstSeenAt, "frontend")
    }

    const hosts: MergedHostKey[] = Array.from(rows.entries())
      .map(([host, entry]) => ({
        host,
        keyTypes: Array.from(entry.keyTypes).sort((a, b) => a.localeCompare(b)),
        pinnedAt: Number.isFinite(entry.pinnedAt) ? new Date(entry.pinnedAt).toISOString() : "",
        sources: Array.from(entry.sources).sort((a, b) => a.localeCompare(b)),
      }))
      .sort((a, b) => a.host.localeCompare(b.host))

    return NextResponse.json({ hosts, orchestratorUnavailable })
  } catch (error: any) {
    console.error(
      "Failed to list SSH host keys:",
      String(error?.message || "").replace(/[\r\n]/g, "")
    )
    return NextResponse.json(
      { error: error?.message || "Failed to list SSH host keys" },
      { status: 500 }
    )
  }
}
