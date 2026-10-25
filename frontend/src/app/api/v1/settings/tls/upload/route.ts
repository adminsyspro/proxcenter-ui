// src/app/api/v1/settings/tls/upload/route.ts
//
// Import of an existing PEM. Every rejection carries the PemError code so the
// form can highlight the field at fault rather than saying "invalid". This
// catches PemError generically (instanceof), so it maps every code the
// current pem.ts can raise -- not_a_certificate, key_mismatch,
// passphrase_protected, unreadable_key, expired, broken_chain and
// private_key_in_certificate -- without needing a per-code branch that would
// silently miss a future addition.

import { NextResponse } from 'next/server'
import { z } from 'zod'

import { audit } from '@/lib/audit'
import { withAudit } from '@/lib/audit/withAudit'
import { applyActiveCertificate } from '@/lib/tls/bootstrap'
import { requireTlsAdmin } from '@/lib/tls/guard'
import { PemError } from '@/lib/tls/pem'
import { saveCertificate } from '@/lib/tls/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const schema = z.object({
  certPem: z.string().min(1).max(100_000),
  chainPem: z.string().max(500_000).nullable().optional(),
  keyPem: z.string().min(1).max(100_000),
})

async function handlePost(request: Request) {
  const { denied } = await requireTlsAdmin()

  if (denied) return denied

  try {
    const parsed = schema.safeParse(await request.json())

    if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })

    const saved = await saveCertificate({
      source: 'uploaded',
      certPem: parsed.data.certPem,
      chainPem: parsed.data.chainPem ?? null,
      keyPem: parsed.data.keyPem,
      activate: true,
    })

    await applyActiveCertificate()

    await audit({
      action: 'tls.import',
      category: 'security',
      resourceType: 'tls_certificate',
      resourceId: saved.id,
      resourceName: saved.commonName,
      status: 'success',
      details: { sanNames: saved.sanNames, fingerprint: saved.fingerprint, notAfter: saved.notAfter },
    })

    // The response carries metadata only: the key that just came in never
    // travels back out.
    return NextResponse.json({ certificate: saved })
  } catch (error: any) {
    if (error instanceof PemError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 400 })
    }

    console.error('Erreur POST settings/tls/upload:', error)

    return NextResponse.json({ error: error?.message || 'Erreur serveur' }, { status: 500 })
  }
}

// The handler writes its own, richer audit row on every path it controls;
// the wrapper only catches what it cannot (an unexpected throw, a refusal).
export const POST = withAudit({ category: 'security', action: 'create', resourceType: 'tls_certificate' }, handlePost)
