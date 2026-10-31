// src/lib/incidents/reportPdf.ts
//
// The report of one incident as it is shared: key facts, the alerts by start
// time, the public journal and the post-mortem, rendered to PDF by the
// WeasyPrint sidecar. Internal notes never leave the register. Every value is
// escaped; timestamps are printed in UTC so the report reads the same
// wherever it is opened.

import { NextResponse } from 'next/server'

import { evidenceTranslator } from '@/lib/backups/restoreDrills/evidence'
import { utc, type Translate } from '@/lib/backups/restoreDrills/evidencePdf'
import { escapeHtml, sanitizeFilename } from '@/lib/compliance/report/escapeHtml'
import { defaultLocale, locales } from '@/i18n/config'
import { resolveReportBranding, type ReportBranding } from '@/lib/reporting/reportBranding'
import { renderPdf } from '@/lib/reporting/weasyprintClient'
import { formatUptime } from '@/utils/format'

import type { IncidentAlert, IncidentView } from './types'

const P = 'incidents.report'

export interface ReportMeta {
  generatedAt: string
  locale: string
  branding: ReportBranding
}

const STATUS_TONE: Record<IncidentView['status'], string> = { open: 'bad', resolved: 'warn', closed: 'ok' }

const text = (value: unknown): string => (typeof value === 'string' ? value : '')

/** "8m", "2h 5m": the length between two instants, "-" when one is missing. */
function between(from: string | undefined, to: string | undefined): string {
  if (!from || !to) return '-'
  const seconds = (Date.parse(to) - Date.parse(from)) / 1000

  return Number.isFinite(seconds) ? (seconds < 60 ? `${Math.max(0, Math.round(seconds))}s` : formatUptime(seconds)) : '-'
}

function row(label: string, value: string): string {
  return `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`
}

function alertRow(a: IncidentAlert, t: Translate): string {
  const started = text(a.first_seen_at)
  const name = text(a.resource_name) || text(a.resource) || t('incidents.alerts.unknown')
  const end = a.resolved_at ? utc(a.resolved_at) : t('incidents.alerts.ongoing')

  return `<tr>
      <td class="nowrap">${escapeHtml(utc(started))}</td>
      <td>${escapeHtml(name)}</td>
      <td>${escapeHtml(text(a.message))}</td>
      <td class="nowrap">${escapeHtml(end)}</td>
      <td class="nowrap">${escapeHtml(a.resolved_at ? between(started, a.resolved_at) : '-')}</td>
    </tr>`
}

/** Paragraphs of a free text, its line breaks kept. */
const prose = (value: string, empty: string) =>
  value.trim() ? `<p class="prose">${escapeHtml(value.trim())}</p>` : `<p class="muted">${escapeHtml(empty)}</p>`

export function incidentReportHtml(view: IncidentView, meta: ReportMeta, t: Translate): string {
  const appName = meta.branding.appName || 'ProxCenter'
  const brand = meta.branding.brandColor
  const severity = ['info', 'warning', 'critical'].includes(view.severity) ? t(`incidents.severity.${view.severity}`) : view.severity
  const alerts = [...view.alerts].sort((a, b) => text(a.first_seen_at).localeCompare(text(b.first_seen_at)))
  const comments = view.comments.filter(c => !c.internal)

  const facts = [
    row(t('incidents.facts.started'), utc(view.started_at)),
    row(t('incidents.facts.ended'), view.ended_at ? utc(view.ended_at) : t('incidents.alerts.ongoing')),
    row(t('incidents.facts.duration'), between(view.started_at, view.ended_at ?? meta.generatedAt)),
    row(t(`${P}.severity`), severity),
    row(t('incidents.facts.alerts'), String(alerts.length)),
  ].join('')

  const journal = comments.length
    ? comments.map(c => `<div class="comment">
        <div class="who">${escapeHtml(c.author_name)} <span class="muted">${escapeHtml(utc(c.created_at))}</span></div>
        <p class="prose">${escapeHtml(c.body)}</p>
      </div>`).join('')
    : `<p class="muted">${escapeHtml(t('incidents.journal.empty'))}</p>`

  const actionItem = (a: (typeof view.actions)[number]) => (a.done
    ? `<li class="done">&#10003; ${escapeHtml(a.text)}</li>`
    : `<li class="">&#9744; ${escapeHtml(a.text)}</li>`)
  const actions = view.actions.length
    ? `<ul class="actions">${view.actions.map(actionItem).join('')}</ul>`
    : `<p class="muted">${escapeHtml(t('incidents.postmortem.noActions'))}</p>`

  const validation = view.status === 'closed' && view.postmortem_by
    ? `<p class="muted">${escapeHtml(t(`${P}.validated`, { by: view.postmortem_by, time: utc(view.postmortem_at) }))}</p>`
    : `<div class="alert warn">${escapeHtml(t(`${P}.draft`))}</div>`

  const logo = meta.branding.logoDataUri ? `<img class="logo" src="${escapeHtml(meta.branding.logoDataUri)}" alt="">` : ''

  return `<!DOCTYPE html>
<html lang="${escapeHtml(meta.locale)}"><head><meta charset="utf-8">
<title>${escapeHtml(t(`${P}.pdfTitle`))}</title>
<style>
  @page { size: A4; margin: 16mm 14mm 18mm; @bottom-center { content: counter(page) " / " counter(pages); font-size: 8pt; color: #64748b; } }
  body { font-family: "DejaVu Sans", "Liberation Sans", sans-serif; font-size: 9pt; color: #0f172a; }
  header { display: flex; align-items: center; gap: 10pt; border-bottom: 2pt solid ${escapeHtml(brand)}; padding-bottom: 8pt; margin-bottom: 12pt; }
  .logo { height: 28pt; }
  h1 { font-size: 15pt; margin: 0; }
  .sub { color: #64748b; font-size: 8.5pt; margin-top: 2pt; }
  h2 { font-size: 11pt; margin: 16pt 0 6pt; color: ${escapeHtml(brand)}; }
  h3 { font-size: 9.5pt; margin: 10pt 0 4pt; }
  table { width: 100%; border-collapse: collapse; }
  table.kv th { text-align: left; width: 32%; color: #475569; font-weight: normal; padding: 3pt 6pt 3pt 0; vertical-align: top; }
  table.kv td { padding: 3pt 0; }
  table.grid th { text-align: left; background: #f1f5f9; color: #334155; padding: 4pt 6pt; font-size: 8.5pt; }
  table.grid td { border-bottom: 0.5pt solid #e2e8f0; padding: 4pt 6pt; vertical-align: top; }
  .nowrap { white-space: nowrap; }
  .badge { display: inline-block; padding: 1pt 6pt; border-radius: 8pt; font-size: 8pt; white-space: nowrap; margin-right: 4pt; }
  .badge.ok { background: #f0fdf4; color: #15803d; border: 0.5pt solid #bbf7d0; }
  .badge.bad { background: #fef2f2; color: #b91c1c; border: 0.5pt solid #fecaca; }
  .badge.warn { background: #fffbeb; color: #b45309; border: 0.5pt solid #fde68a; }
  .badge.muted { background: #f8fafc; color: #475569; border: 0.5pt solid #e2e8f0; }
  .muted { color: #64748b; }
  .prose { white-space: pre-wrap; word-break: break-word; margin: 2pt 0 0; }
  .comment { padding: 5pt 0; border-bottom: 0.5pt solid #e2e8f0; }
  .who { font-weight: bold; }
  .actions { margin: 0; padding-left: 0; list-style: none; }
  .actions li { padding: 2pt 0; }
  .actions li.done { color: #64748b; text-decoration: line-through; }
  .alert { padding: 6pt 8pt; border-radius: 4pt; margin: 8pt 0; }
  .alert.warn { background: #fffbeb; color: #92400e; border: 0.5pt solid #fde68a; }
  footer { margin-top: 18pt; color: #94a3b8; font-size: 7.5pt; }
</style></head><body>
<header>${logo}<div>
  <h1>${escapeHtml(view.title)}</h1>
  <div class="sub">${escapeHtml(t(`${P}.pdfTitle`))} · ${escapeHtml(t(`${P}.generated`, { time: utc(meta.generatedAt) }))}</div>
</div></header>
<p><span class="badge ${STATUS_TONE[view.status]}">${escapeHtml(t(`incidents.status.${view.status}`))}</span><span class="badge muted">${escapeHtml(severity)}</span></p>
<table class="kv">${facts}</table>
<h2>${escapeHtml(t('incidents.alerts.title'))}</h2>
<table class="grid"><thead><tr>
  <th>${escapeHtml(t(`${P}.colStarted`))}</th><th>${escapeHtml(t(`${P}.colObject`))}</th><th>${escapeHtml(t(`${P}.colMessage`))}</th>
  <th>${escapeHtml(t(`${P}.colResolved`))}</th><th>${escapeHtml(t('incidents.facts.duration'))}</th>
</tr></thead><tbody>${alerts.map(a => alertRow(a, t)).join('')}</tbody></table>
<h2>${escapeHtml(t('incidents.postmortem.title'))}</h2>
${validation}
<h3>${escapeHtml(t('incidents.postmortem.rootCause'))}</h3>
${prose(view.root_cause, t(`${P}.notFilled`))}
<h3>${escapeHtml(t('incidents.postmortem.impact'))}</h3>
${prose(view.impact, t(`${P}.notFilled`))}
<h3>${escapeHtml(t('incidents.postmortem.actions'))}</h3>
${actions}
<h2>${escapeHtml(t('incidents.journal.title'))}</h2>
${journal}
<footer>${escapeHtml(t(`${P}.footer`, { app: appName }))}</footer>
</body></html>`
}

/** The PDF of the incident given, labels in the reader's language. */
export async function renderIncidentReport(view: IncidentView, locale: string | undefined): Promise<Response> {
  const lang = locale && (locales as readonly string[]).includes(locale) ? locale : defaultLocale
  const [t, branding] = await Promise.all([evidenceTranslator(lang), resolveReportBranding()])
  const generatedAt = new Date().toISOString()

  const out = await renderPdf(incidentReportHtml(view, { generatedAt, locale: lang, branding }, t))
  if (!out.ok || !out.pdf) return NextResponse.json({ error: out.error || 'PDF generation failed' }, { status: 503 })

  const name = sanitizeFilename(`incident-${view.title.slice(0, 60)}-${generatedAt.slice(0, 10)}`)

  return new NextResponse(new Uint8Array(out.pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="${name}.pdf"`,
    },
  })
}
