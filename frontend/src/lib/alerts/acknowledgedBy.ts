// src/lib/alerts/acknowledgedBy.ts
//
// Who acknowledged an alert: the session's user, never a name taken from the
// request body (roadmap#223). The alerts page sends the user's name and the
// notification bell its e-mail: either one is kept as sent, so both keep
// showing what they showed; anything else becomes the session's name.

import { getServerSession } from "next-auth"

import { authOptions } from "@/lib/auth/config"

export async function sessionAcknowledger(claimed?: unknown): Promise<string> {
  const session = await getServerSession(authOptions)
  const user = session?.user as { name?: string | null; email?: string | null } | undefined
  const own = [user?.name, user?.email].filter((v): v is string => typeof v === "string" && v !== "")

  if (typeof claimed === "string" && own.includes(claimed)) return claimed

  return own[0] ?? "unknown"
}
