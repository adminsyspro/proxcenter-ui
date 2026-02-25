import NextAuth from "next-auth"

import { getAuthOptions } from "@/lib/auth/config"

const handler = (...args: any[]) => NextAuth(getAuthOptions())(...args)

export { handler as GET, handler as POST }
