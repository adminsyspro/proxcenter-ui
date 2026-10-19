// src/lib/backups/restoreDrills/evidencePdf.ts
//
// The evidence of a drill as an auditor reads it: an HTML page rendered to
// PDF by the WeasyPrint sidecar. Built from the orchestrator's evidence
// record, which already carries no guest config and a masked log. Every
// value is escaped; timestamps are printed in UTC so the report reads the
// same wherever it is opened.

import { escapeHtml } from '@/lib/compliance/report/escapeHtml'
import type { ReportBranding } from '@/lib/reporting/reportBranding'

import { cleanupBadge, drillOrigin, formatDuration, resultChip, secondsBetween, stageLabelKey, stepLabelKey } from './display'
import type { Drill, DrillEvent, DrillStageStatus } from './types'

const P = 'backups.restoreDrills'

export type Translate = (key: string, values?: Record<string, string | number>) => string

export interface DrillEvidence {
  format?: string
  generated_at?: string
  drill: Drill
  events?: DrillEvent[]
  restore_task?: { upid?: string; exit_status?: string; log_tail?: string[] }
  /** Console of the test VM after the stabilization delay; null when none was captured. */
  screenshot?: { captured_at: string; png_base64: string } | null
}

export interface EvidenceMeta {
  clusterName: string
  generatedAt: string
  locale: string
  branding: ReportBranding
}

/** "2026-10-18 19:01:00 UTC", or "-" for an empty or invalid value. */
export function utc(value: string | null | undefined): string {
  if (!value) return '-'
  const ms = Date.parse(value)
  if (Number.isNaN(ms) || ms <= 0) return '-'
  return `${new Date(ms).toISOString().slice(0, 19).replace('T', ' ')} UTC`
}

const STAGE_TONE: Record<DrillStageStatus, string> = {
  ok: 'ok',
  failed: 'bad',
  skipped: 'muted',
  not_assessed: 'muted',
  running: 'info',
  pending: 'muted',
}

const CHIP_TONE: Record<string, string> = { success: 'ok', error: 'bad', warning: 'warn', info: 'info' }

function verdict(drill: Drill, t: Translate): { label: string; tone: string } {
  const chip = resultChip(drill)
  if (!chip) return { label: t(`${P}.status.${drill.status}`), tone: 'info' }
  const label = chip.stageKey ? t(chip.key, { stage: t(chip.stageKey) }) : t(chip.key)
  return { label, tone: CHIP_TONE[chip.color] ?? 'muted' }
}

function row(label: string, value: string): string {
  return `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`
}

function networkLabel(drill: Drill, t: Translate): string {
  if (drill.network_mode === 'bridge') return `${t(`${P}.networkBridge`)} (${drill.bridge})`
  return t(`${P}.networkLinkDown`)
}

/** Plain base64 only: anything else never reaches the data URI. */
const BASE64_RE = /^[A-Za-z0-9+/]+=*$/

/**
 * The console screenshot, information only. Without a usable image: the
 * reason it is unavailable, or that the guest never started. A drill whose
 * guest started but that has no capture state predates the capture: no section.
 */
function screenshotSection(evidence: DrillEvidence, t: Translate): string {
  const drill = evidence.drill
  const shot = evidence.screenshot
  const title = `<h2>${escapeHtml(t(`${P}.screenshot.title`))}</h2>`
  if (shot && typeof shot.png_base64 === 'string' && BASE64_RE.test(shot.png_base64)) {
    const capturedAt = t(`${P}.screenshot.capturedAt`, { time: utc(shot.captured_at || drill.screenshot_at) })
    return `${title}
<figure class="shot"><img src="data:image/png;base64,${shot.png_base64}" alt="${escapeHtml(t(`${P}.screenshot.title`))}">
<figcaption>${escapeHtml(capturedAt)}. ${escapeHtml(t(`${P}.screenshot.caption`))}</figcaption></figure>`
  }

  let text: string
  if (drill.screenshot_state === 'unavailable' && drill.screenshot_error) {
    text = t(`${P}.screenshot.unavailableReason`, { reason: drill.screenshot_error })
  } else if (drill.screenshot_state === 'unavailable' || drill.screenshot_state === 'captured') {
    text = t(`${P}.screenshot.unavailable`)
  } else if ((drill.stages ?? []).some(s => s.key === 'guest_started' && s.status === 'ok')) {
    return ''
  } else {
    text = t(`${P}.screenshot.none`)
  }
  return `${title}\n<p class="muted">${escapeHtml(text)}</p>`
}

export function drillEvidenceHtml(evidence: DrillEvidence, meta: EvidenceMeta, t: Translate): string {
  const drill = evidence.drill
  const src = drill.source ?? ({} as Drill['source'])
  const { label: verdictLabel, tone: verdictTone } = verdict(drill, t)
  const cleanup = cleanupBadge(drill)
  const appName = meta.branding.appName || 'ProxCenter'
  const brand = meta.branding.brandColor
  const sourceName = src.vm_name ? `${src.vm_name} (#${src.backup_id})` : `VM ${src.backup_id}`
  const verifyState = src.verify_state === 'ok' || src.verify_state === 'failed' ? src.verify_state : 'none'

  const summary = [
    row(t(`${P}.pdf.sourceVm`), sourceName),
    row(t(`${P}.pdf.backupTime`), utc(src.backup_time)),
    row(t(`${P}.pdf.datastore`), `${src.pbs_name || src.pbs_id || '-'} / ${src.datastore || '-'}`),
    row(t(`${P}.pdf.namespace`), src.namespace || '/'),
    row(t(`${P}.detail.archive`), src.archive || '-'),
    row(t(`${P}.target`), [meta.clusterName, drill.node, drill.target_storage].filter(Boolean).join(' / ')),
    row(t(`${P}.detail.tempGuest`), t(`${P}.detail.tempGuestValue`, { vmid: drill.temp_vmid, name: drill.temp_name })),
    row(t(`${P}.network`), networkLabel(drill, t)),
    row(t(`${P}.detail.requestedBy`), drill.requested_by || '-'),
    row(t(`${P}.origin`), drillOrigin(drill) ?? t(`${P}.originManual`)),
    row(t(`${P}.detail.created`), utc(drill.created_at)),
    row(t(`${P}.pdf.started`), utc(drill.started_at)),
    row(t(`${P}.detail.finished`), utc(drill.finished_at)),
    row(t(`${P}.detail.cleaned`), drill.cleaned_at ? utc(drill.cleaned_at) : (cleanup ? t(cleanup.key) : '-')),
  ].join('')

  const stages = (drill.stages ?? []).map(stage => {
    const status = (stage.status in STAGE_TONE ? stage.status : 'pending') as DrillStageStatus
    const duration = stage.started_at && stage.ended_at ? formatDuration(secondsBetween(stage.started_at, stage.ended_at)) : '-'
    return `<tr>
      <td>${escapeHtml(t(stageLabelKey(stage.key)))}</td>
      <td><span class="badge ${STAGE_TONE[status]}">${escapeHtml(t(`${P}.stageStatus.${status}`))}</span></td>
      <td class="num">${escapeHtml(duration)}</td>
      <td>${escapeHtml(stage.detail || '')}</td>
    </tr>`
  }).join('')

  const events = (evidence.events ?? []).map(e => `<tr>
      <td class="nowrap">${escapeHtml(utc(e.ts))}</td>
      <td><span class="level ${escapeHtml(e.level)}">${escapeHtml(e.level)}</span></td>
      <td>${escapeHtml(e.stage ? `[${t(stageLabelKey(e.stage))}] ` : '')}${escapeHtml(e.message)}</td>
    </tr>`).join('')

  const logLines = evidence.restore_task?.log_tail ?? []
  const log = logLines.length
    ? `<pre class="log">${logLines.map(l => escapeHtml(l)).join('\n')}</pre>`
    : `<p class="muted">${escapeHtml(t(`${P}.pdf.noLog`))}</p>`

  const errorTone = drill.status === 'cancelled' ? 'warn' : 'bad'
  const error = drill.error ? `<div class="alert ${errorTone}">${escapeHtml(drill.error)}</div>` : ''
  const unverified = drill.result === 'vm_started' ? `<div class="alert warn">${escapeHtml(t(`${P}.pdf.vmStartedNote`))}</div>` : ''
  const cleanupError = drill.cleanup_error
    ? `<div class="alert bad">${escapeHtml(t(`${P}.detail.cleanupError`, { error: drill.cleanup_error }))}</div>`
    : ''
  const logo = meta.branding.logoDataUri ? `<img class="logo" src="${escapeHtml(meta.branding.logoDataUri)}" alt="">` : ''

  return `<!DOCTYPE html>
<html lang="${escapeHtml(meta.locale)}"><head><meta charset="utf-8">
<title>${escapeHtml(t(`${P}.pdf.title`))}</title>
<style>
  @page { size: A4; margin: 16mm 14mm 18mm; @bottom-center { content: counter(page) " / " counter(pages); font-size: 8pt; color: #64748b; } }
  body { font-family: "DejaVu Sans", "Liberation Sans", sans-serif; font-size: 9pt; color: #0f172a; }
  header { display: flex; align-items: center; gap: 10pt; border-bottom: 2pt solid ${escapeHtml(brand)}; padding-bottom: 8pt; margin-bottom: 12pt; }
  .logo { height: 28pt; }
  h1 { font-size: 15pt; margin: 0; }
  .sub { color: #64748b; font-size: 8.5pt; margin-top: 2pt; }
  h2 { font-size: 11pt; margin: 16pt 0 6pt; color: ${escapeHtml(brand)}; }
  .verdict { margin: 4pt 0 10pt; font-size: 11pt; }
  table { width: 100%; border-collapse: collapse; }
  table.kv th { text-align: left; width: 32%; color: #475569; font-weight: normal; padding: 3pt 6pt 3pt 0; vertical-align: top; }
  table.kv td { padding: 3pt 0; word-break: break-all; }
  table.grid th { text-align: left; background: #f1f5f9; color: #334155; padding: 4pt 6pt; font-size: 8.5pt; }
  table.grid td { border-bottom: 0.5pt solid #e2e8f0; padding: 4pt 6pt; vertical-align: top; }
  .num, .nowrap { white-space: nowrap; }
  .badge { display: inline-block; padding: 1pt 6pt; border-radius: 8pt; font-size: 8pt; white-space: nowrap; }
  .badge.ok { background: #f0fdf4; color: #15803d; border: 0.5pt solid #bbf7d0; }
  .badge.bad { background: #fef2f2; color: #b91c1c; border: 0.5pt solid #fecaca; }
  .badge.warn { background: #fffbeb; color: #b45309; border: 0.5pt solid #fde68a; }
  .badge.info { background: #eff6ff; color: #1d4ed8; border: 0.5pt solid #bfdbfe; }
  .badge.muted { background: #f1f5f9; color: #475569; border: 0.5pt solid #e2e8f0; }
  .alert { margin: 6pt 0; padding: 6pt 8pt; border-radius: 4pt; }
  .alert.bad { background: #fef2f2; color: #b91c1c; }
  .alert.warn { background: #fffbeb; color: #b45309; }
  .level { font-size: 8pt; text-transform: uppercase; }
  .level.warning { color: #b45309; } .level.error { color: #b91c1c; } .level.info { color: #475569; }
  .note, .muted { color: #64748b; font-size: 8pt; }
  figure.shot { margin: 0; page-break-inside: avoid; }
  figure.shot img { display: block; max-width: 100%; border: 0.5pt solid #e2e8f0; }
  figure.shot figcaption { color: #64748b; font-size: 8pt; margin-top: 4pt; }
  pre.log { font-family: "DejaVu Sans Mono", "Liberation Mono", monospace; font-size: 7pt; background: #f8fafc; border: 0.5pt solid #e2e8f0; padding: 6pt; white-space: pre-wrap; word-break: break-all; }
  footer { margin-top: 16pt; color: #64748b; font-size: 8pt; }
</style></head>
<body>
<header>${logo}<div><h1>${escapeHtml(t(`${P}.pdf.title`))}</h1>
<div class="sub">${escapeHtml(sourceName)} · ${escapeHtml(utc(src.backup_time))}</div></div></header>

<div class="verdict">${escapeHtml(t(`${P}.pdf.verdict`))}
  <span class="badge ${verdictTone}">${escapeHtml(verdictLabel)}</span>
  ${cleanup ? `<span class="badge ${CHIP_TONE[cleanup.color] ?? 'muted'}">${escapeHtml(t(cleanup.key))}</span>` : ''}
</div>
${unverified}${error}${cleanupError}

<h2>${escapeHtml(t(`${P}.pdf.summary`))}</h2>
<table class="kv">${summary}</table>

<h2>${escapeHtml(t(`${P}.detail.stages`))}</h2>
<table class="grid"><thead><tr>
  <th>${escapeHtml(t(`${P}.pdf.colStage`))}</th><th>${escapeHtml(t(`${P}.pdf.colStatus`))}</th>
  <th>${escapeHtml(t(`${P}.colDuration`))}</th><th>${escapeHtml(t(`${P}.pdf.colDetail`))}</th>
</tr></thead><tbody>${stages}</tbody></table>
<p class="note">${escapeHtml(t(`${P}.pdf.notAssessedNote`))}</p>

<h2>${escapeHtml(t(`${P}.pbsVerification`))}</h2>
<table class="kv">
  ${row(t(`${P}.pbsVerification`), t(`${P}.verify.${verifyState}`))}
  ${row(t(`${P}.pdf.verifiedAt`), utc(src.verified_at))}
</table>
<p class="note">${escapeHtml(t(`${P}.pdf.verificationNote`))}</p>
${screenshotSection(evidence, t)}

<h2>${escapeHtml(t(`${P}.detail.events`))}</h2>
${events
    ? `<table class="grid"><thead><tr><th>${escapeHtml(t(`${P}.pdf.colTime`))}</th><th>${escapeHtml(t(`${P}.pdf.colLevel`))}</th><th>${escapeHtml(t(`${P}.pdf.colMessage`))}</th></tr></thead><tbody>${events}</tbody></table>`
    : `<p class="muted">${escapeHtml(t(`${P}.detail.noEvents`))}</p>`}

<h2>${escapeHtml(t(`${P}.pdf.logTitle`))}</h2>
<p class="note">${escapeHtml(t(`${P}.pdf.logNote`, { node: drill.node, status: evidence.restore_task?.exit_status || '-' }))}</p>
${log}

<footer>${escapeHtml(t(`${P}.pdf.footer`, { app: appName, date: utc(meta.generatedAt), id: drill.id }))}</footer>
</body></html>`
}
