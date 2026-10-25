// src/app/api/v1/settings/tls/acme/dns-test/route.ts
//
// The "test" button of the DNS-01 form: reads the zone of every configured
// domain with the stored credentials, writes nothing, spends nothing at the CA.

import { NextResponse } from 'next/server'

import { checkDnsAccess } from '@/lib/tls/dns/solver'
import { requireTlsAdmin } from '@/lib/tls/guard'
import { loadTlsSettings } from '@/lib/tls/settings'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST() {
  const { denied } = await requireTlsAdmin()

  if (denied) return denied

  try {
    const settings = await loadTlsSettings()

    if (settings.acme.domains.length === 0) {
      return NextResponse.json({ error: 'no domain configured' }, { status: 400 })
    }

    return NextResponse.json(await checkDnsAccess(settings, settings.acme.domains))
  } catch (error: any) {
    console.error('Erreur POST settings/tls/acme/dns-test:', error)

    return NextResponse.json({ error: error?.message || 'Erreur serveur' }, { status: 500 })
  }
}
