// src/lib/backups/restoreDrills/screenshot.ts
//
// The console screenshot of a drill's temporary VM, relayed as PNG bytes.
// Information only: it is never part of the verdict.

import { NextResponse } from 'next/server'

import { fetchDrillResource, relayedError } from './orchestratorFetch'

const TIMEOUT_MS = 15_000

export async function proxyDrillScreenshot(id: string): Promise<Response> {
  const fetched = await fetchDrillResource(id, 'screenshot', TIMEOUT_MS)
  if ('response' in fetched) return fetched.response
  const { res } = fetched

  if (res.status === 404) return NextResponse.json({ error: 'Screenshot not found' }, { status: 404 })
  if (!res.ok) return relayedError(res.status, await res.text().catch(() => ''))

  const png = new Uint8Array(await res.arrayBuffer())
  return new NextResponse(png, {
    status: 200,
    headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=300' },
  })
}
