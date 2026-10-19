// src/lib/backups/restoreDrills/evidence.ts
//
// The evidence file of a drill: the orchestrator's evidence record (no guest
// config, masked log) rendered to one PDF by the WeasyPrint sidecar, labels
// in the reader's language. orchestratorFetch hides the status code of a
// refusal, hence the raw fetch of ./orchestratorFetch. When the renderer is
// out of reach the route answers like the compliance report does; it never
// falls back to JSON.

import { NextResponse } from 'next/server'

import { sanitizeFilename } from '@/lib/compliance/report/escapeHtml'
import { prisma } from '@/lib/db/prisma'
import { defaultLocale, locales, type Locale } from '@/i18n/config'
import { resolveReportBranding } from '@/lib/reporting/reportBranding'
import { renderPdf } from '@/lib/reporting/weasyprintClient'

import { drillEvidenceHtml, type DrillEvidence, type Translate } from './evidencePdf'
import { fetchDrillResource, parseJsonBody, relayedError } from './orchestratorFetch'

function readerLocale(locale: string | undefined): Locale {
  return locale && (locales as readonly string[]).includes(locale) ? (locale as Locale) : defaultLocale
}

/** A translator over one locale's messages, `{name}` placeholders filled in. */
export async function evidenceTranslator(locale: string | undefined): Promise<Translate> {
  const lang = readerLocale(locale)
  const messages = (await import(`@/messages/${lang}.json`)).default as Record<string, any>
  return (key, values) => {
    const raw = key.split('.').reduce<any>((node, part) => (node && typeof node === 'object' ? node[part] : undefined), messages)
    if (typeof raw !== 'string') return key
    return raw.replace(/\{(\w+)\}/g, (match, name: string) => (values && name in values ? String(values[name]) : match))
  }
}

async function fetchEvidence(id: string): Promise<{ evidence: DrillEvidence } | { response: Response }> {
  const fetched = await fetchDrillResource(id, 'evidence')
  if ('response' in fetched) return fetched
  const { res } = fetched

  const text = await res.text().catch(() => '')
  if (!res.ok) return { response: relayedError(res.status, text) }
  const parsed = parseJsonBody(text)
  if (!parsed?.drill?.id) {
    return { response: NextResponse.json({ error: 'Invalid evidence from the orchestrator' }, { status: 502 }) }
  }
  return { evidence: parsed as DrillEvidence }
}

async function clusterName(connectionId: string): Promise<string> {
  try {
    const conn = await prisma.connection.findUnique({ where: { id: connectionId }, select: { name: true } })
    return conn?.name || connectionId
  } catch {
    return connectionId
  }
}

export async function renderDrillEvidencePdf(id: string, locale: string | undefined): Promise<Response> {
  const fetched = await fetchEvidence(id)
  if ('response' in fetched) return fetched.response
  const { evidence } = fetched

  const [t, branding, cluster] = await Promise.all([
    evidenceTranslator(locale),
    resolveReportBranding(),
    clusterName(evidence.drill.connection_id),
  ])
  const generatedAt = new Date().toISOString()
  const html = drillEvidenceHtml(evidence, { clusterName: cluster, generatedAt, locale: readerLocale(locale), branding }, t)

  const out = await renderPdf(html)
  if (!out.ok || !out.pdf) {
    return NextResponse.json({ error: out.error || 'PDF generation failed' }, { status: 503 })
  }

  const source = evidence.drill.source
  const name = sanitizeFilename(`restore-drill-${source?.vm_name || source?.backup_id || 'vm'}-${id.slice(0, 8)}-${generatedAt.slice(0, 10)}`)
  return new NextResponse(new Uint8Array(out.pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="${name}.pdf"`,
    },
  })
}
