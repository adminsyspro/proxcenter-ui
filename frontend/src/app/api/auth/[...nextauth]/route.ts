import { NextRequest } from "next/server"

import NextAuth from "next-auth"

import { getAuthOptions } from "@/lib/auth/config"

async function handler(req: NextRequest, ctx: { params: Promise<{ nextauth: string[] }> }) {
  const opts = await getAuthOptions()


return NextAuth(opts)(req as any, ctx as any)
}

export { handler as GET, handler as POST }
