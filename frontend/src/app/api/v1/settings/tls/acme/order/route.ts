// src/app/api/v1/settings/tls/acme/order/route.ts
//
// The manual "order now" button. It runs the very same work as the hourly
// reconciler, under the very same lease, so a click can neither race another
// click nor overlap a renewal already in flight on this or another replica.

import { NextResponse } from 'next/server'

import { withAudit } from '@/lib/audit/withAudit'
import { requireTlsAdmin } from '@/lib/tls/guard'
import { withRenewLease } from '@/lib/tls/lease'
import { isOrderRunning, runAcmeOrder } from '@/lib/tls/renew'
import { loadTlsSettings } from '@/lib/tls/settings'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function handlePost() {
  const { denied } = await requireTlsAdmin()

  if (denied) return denied

  const settings = await loadTlsSettings()

  // A `pending` row alone is not proof that anything is running: an order
  // interrupted by a restart leaves one behind for ever, the reconciler will
  // not retry while the active certificate is still self-signed, and every
  // later click answered 409. Past the lease ceiling the row is stale and the
  // order is reclaimable; the lease below is what actually keeps two orders
  // apart.
  if (isOrderRunning(settings.order)) {
    return NextResponse.json({ error: 'an order is already running' }, { status: 409 })
  }

  if (settings.acme.domains.length === 0) {
    return NextResponse.json({ error: 'no domain configured' }, { status: 400 })
  }

  // The route waits for the CLAIM, which is one statement, and never for the
  // order, which routinely runs past the 60 s nginx cuts API routes at. The UI
  // polls GET /api/v1/settings/tls and reads `settings.order`.
  let settle: (outcome: 'claimed' | 'busy' | 'error') => void = () => {}
  const claim = new Promise<'claimed' | 'busy' | 'error'>(resolve => { settle = resolve })

  void withRenewLease(async lease => {
    settle('claimed')
    await runAcmeOrder('manual', { assertStillEntitled: lease.assertHeld })
  })
    .then(claimed => {
      // False means a neighbour holds the lease: its order is the one running,
      // and this click has nothing to add.
      if (!claimed) settle('busy')
    })
    .catch(err => {
      console.error('[tls] manual order failed:', err)
      settle('error')
    })

  const outcome = await claim

  if (outcome === 'busy') {
    return NextResponse.json({ error: 'an order is already running' }, { status: 409 })
  }

  if (outcome === 'error') {
    return NextResponse.json({ error: 'could not start the order' }, { status: 500 })
  }

  return NextResponse.json({ accepted: true }, { status: 202 })
}

// The handler writes its own, richer audit row on every path it controls;
// the wrapper only catches what it cannot (an unexpected throw, a refusal).
export const POST = withAudit({ category: 'security', action: 'create', resourceType: 'tls_certificate' }, handlePost)
