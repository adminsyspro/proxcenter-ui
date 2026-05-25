import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"

import { authOptions } from "@/lib/auth/config"
import { requireSuperAdminCaller, setUserRequire2faFlag } from "@/lib/auth/totp-admin"

export const runtime = "nodejs"

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = await requireSuperAdminCaller()
  if (denied) return denied

  const session = await getServerSession(authOptions)
  const { id: targetId } = await ctx.params
  return setUserRequire2faFlag(targetId, false, {
    id: session?.user.id,
    email: session?.user.email,
  })
}
