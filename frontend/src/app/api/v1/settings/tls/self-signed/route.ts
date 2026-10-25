import { NextResponse } from 'next/server'

import { audit } from '@/lib/audit'
import { withAudit } from '@/lib/audit/withAudit'
import { applyActiveCertificate } from '@/lib/tls/bootstrap'
import { requireTlsAdmin } from '@/lib/tls/guard'
import { defaultSelfSignedNames, generateSelfSigned } from '@/lib/tls/selfSigned'
import { saveCertificate } from '@/lib/tls/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function handlePost() {
  const { denied } = await requireTlsAdmin()

  if (denied) return denied

  try {
    const { commonName, sanNames } = defaultSelfSignedNames()
    const { certPem, keyPem } = await generateSelfSigned({ commonName, sanNames })
    const saved = await saveCertificate({ source: 'self_signed', certPem, keyPem, activate: true })

    await applyActiveCertificate()
    await audit({
      action: 'tls.selfsign',
      category: 'security',
      resourceType: 'tls_certificate',
      resourceId: saved.id,
      resourceName: saved.commonName,
      status: 'success',
      details: { sanNames: saved.sanNames, fingerprint: saved.fingerprint },
    })

    return NextResponse.json({ certificate: saved })
  } catch (error: any) {
    console.error('Erreur POST settings/tls/self-signed:', error)

    return NextResponse.json({ error: error?.message || 'Erreur serveur' }, { status: 500 })
  }
}

// The handler writes its own, richer audit row on every path it controls;
// the wrapper only catches what it cannot (an unexpected throw, a refusal).
export const POST = withAudit({ category: 'security', action: 'create', resourceType: 'tls_certificate' }, handlePost)
