// src/app/api/v1/settings/syslog/route.ts
//
// Provider-level syslog / SIEM destinations of the audit log (issue #184).
// GET returns the saved destinations with the live counters of their senders;
// PUT replaces the whole list. Destinations hold no secret (a CA certificate
// is public), so nothing is redacted on the way out.

import { NextResponse } from 'next/server'
import { nanoid } from 'nanoid'
import { z } from 'zod'

import { audit } from '@/lib/audit'
import { getSyslogStatus, loadSyslogConfig, saveSyslogConfig } from '@/lib/syslog/forwarder'
import { requireSyslogAdmin } from '@/lib/syslog/guard'
import { MAX_SYSLOG_DESTINATIONS, syslogDestinationSchema, type SyslogConfig, type SyslogDestination } from '@/lib/syslog/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const putSchema = z.object({
  destinations: z
    .array(syslogDestinationSchema.extend({ id: z.string().trim().max(64).optional() }))
    .max(MAX_SYSLOG_DESTINATIONS),
})

function payload(config: SyslogConfig) {
  return {
    destinations: config.destinations,
    status: getSyslogStatus(),
    limits: { maxDestinations: MAX_SYSLOG_DESTINATIONS },
  }
}

/** What the audit row records about a destination: everything but the CA bundle. */
function summarize(destinations: SyslogDestination[]) {
  return destinations.map(d => ({
    id: d.id,
    name: d.name,
    enabled: d.enabled,
    host: d.host,
    port: d.port,
    transport: d.transport,
    format: d.format,
    framing: d.framing,
    facility: d.facility,
    categories: d.categories,
    tlsVerify: d.tls.verify,
  }))
}

export async function GET() {
  const { denied } = await requireSyslogAdmin()
  if (denied) return denied

  try {
    const config = await loadSyslogConfig(true)
    return NextResponse.json(payload(config))
  } catch (error: any) {
    console.error('Erreur GET settings/syslog:', error)
    return NextResponse.json({ error: error?.message || 'Erreur serveur' }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  const guard = await requireSyslogAdmin()
  if (guard.denied) return guard.denied

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = putSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Invalid destinations',
        issues: parsed.error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message })),
      },
      { status: 400 },
    )
  }

  const seen = new Set<string>()
  const destinations: SyslogDestination[] = parsed.data.destinations.map(d => {
    let id = d.id || nanoid()
    while (seen.has(id)) id = nanoid()
    seen.add(id)
    return { ...d, id }
  })

  try {
    const before = await loadSyslogConfig(true)
    const saved = await saveSyslogConfig({ version: 1, destinations })

    await audit({
      action: 'update',
      category: 'settings',
      resourceType: 'syslog_destinations',
      resourceId: 'syslog_destinations',
      resourceName: 'Syslog destinations',
      details: { before: summarize(before.destinations), after: summarize(saved.destinations) },
    })

    return NextResponse.json(payload(saved))
  } catch (error: any) {
    console.error('Erreur PUT settings/syslog:', error)
    return NextResponse.json({ error: error?.message || 'Erreur serveur' }, { status: 500 })
  }
}
