// src/app/api/acme/challenge/[token]/route.ts
//
// Public, unauthenticated by design: this is what the CA fetches to validate
// an HTTP-01 challenge. next.config.mjs rewrites the canonical
// /.well-known/acme-challenge/:token onto this route, because the Next router
// ignores directories whose name starts with a dot.

import { takeChallenge } from '@/lib/tls/challengeStore'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params

  const keyAuth = await takeChallenge(token)

  if (!keyAuth) return new Response('Not found', { status: 404 })

  return new Response(keyAuth, {
    status: 200,
    headers: {
      // RFC 8555 asks for this exact type, and a cached answer would fail the
      // next order for the same domain.
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}
