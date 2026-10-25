import { NextResponse } from 'next/server'

import { requireTlsAdmin } from '@/lib/tls/guard'
import { listCertificates } from '@/lib/tls/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const { denied } = await requireTlsAdmin()

  if (denied) return denied

  return NextResponse.json({ certificates: await listCertificates() })
}
