// The answer to a tenant create or update that failed in the database: a slug
// already taken is the caller's to fix (409); anything else is logged and
// answered without the database error, which names internal paths.
import { NextResponse } from "next/server"

export function tenantWriteFailure(e: unknown, verb: "create" | "update"): NextResponse {
  const error = e as { code?: string; message?: string } | null
  if (error?.code === "P2002" || error?.message?.includes("UNIQUE constraint")) {
    return NextResponse.json({ error: "A tenant with this slug already exists" }, { status: 409 })
  }
  console.error(`[tenants] ${verb} failed:`, error?.message ?? e)
  return NextResponse.json({ error: "Server error" }, { status: 500 })
}
