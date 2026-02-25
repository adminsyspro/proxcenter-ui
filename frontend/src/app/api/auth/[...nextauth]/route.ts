import { NextRequest } from "next/server"
import NextAuth from "next-auth"

import { getAuthOptions } from "@/lib/auth/config"

function handler(req: NextRequest, ctx: { params: Promise<{ nextauth: string[] }> }) {
  return NextAuth(getAuthOptions())(req as any, ctx as any)
}

export { handler as GET, handler as POST }
