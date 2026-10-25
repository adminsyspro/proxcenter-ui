import { NextResponse } from 'next/server'

import { audit } from '@/lib/audit'
import { withAudit } from '@/lib/audit/withAudit'
import { applyActiveCertificate } from '@/lib/tls/bootstrap'
import { requireTlsAdmin } from '@/lib/tls/guard'
import { activateCertificate } from '@/lib/tls/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function handlePost(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { denied } = await requireTlsAdmin()

  if (denied) return denied

  try {
    const { id } = await params
    const activated = await activateCertificate(id)

    await applyActiveCertificate()
    await audit({
      action: 'tls.activate',
      category: 'security',
      resourceType: 'tls_certificate',
      resourceId: activated.id,
      resourceName: activated.commonName,
      status: 'success',
      details: { fingerprint: activated.fingerprint, source: activated.source },
    })

    return NextResponse.json({ certificate: activated })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Erreur serveur' }, { status: 400 })
  }
}

// The handler writes its own, richer audit row on every path it controls;
// the wrapper only catches what it cannot (an unexpected throw, a refusal).
export const POST = withAudit({ category: 'security', action: 'update', resourceType: 'tls_certificate', resourceParam: 'id' }, handlePost)
