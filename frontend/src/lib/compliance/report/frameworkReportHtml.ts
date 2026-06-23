import type { FrameworkAssessment } from '../frameworkAssessment'
import type { FrameworkDef } from '../frameworks/types'
import type { NodeBreakdown } from '../nodeBreakdown'
import { escapeHtml } from './escapeHtml'

export interface ReportMeta {
  connectionName: string
  generatedAt: string
  locale: string
  brandColor?: string
  logoDataUri?: string
  frameworkLogoDataUri?: string
}

function scoreColor(score: number | null): string {
  if (score === null) return '#64748b'
  if (score >= 80) return '#22c55e'
  if (score >= 50) return '#f59e0b'
  return '#ef4444'
}

function statusBadgeStyle(status: string): string {
  switch (status) {
    case 'satisfied': case 'pass':
      return 'background:#f0fdf4;color:#16a34a;border:0.5pt solid #bbf7d0;'
    case 'partial': case 'warning':
      return 'background:#fffbeb;color:#d97706;border:0.5pt solid #fde68a;'
    case 'failed': case 'fail':
      return 'background:#fef2f2;color:#ef4444;border:0.5pt solid #fecaca;'
    default:
      return 'background:#f1f5f9;color:#64748b;border:0.5pt solid #e2e8f0;'
  }
}

const STATUS_LABEL: Record<string, string> = {
  satisfied: 'Satisfied',
  partial: 'Partial',
  failed: 'Failed',
  not_assessed: 'Not Assessed',
  pass: 'Pass',
  fail: 'Fail',
  warning: 'Warning',
  skip: 'Skip',
}

function buildCss(primary: string): string {
  return `
  :root {
    --primary: ${primary};
    --indigo: #6366f1;
    --green: #22c55e;
    --amber: #f59e0b;
    --red: #ef4444;
    --blue: #3b82f6;
    --slate-900: #0f172a;
    --slate-700: #334155;
    --slate-500: #64748b;
    --slate-200: #e2e8f0;
    --slate-100: #f1f5f9;
    --slate-50:  #f8fafc;
  }
  @page {
    size: A4 portrait;
    margin: 15mm;
    @top-center {
      content: "ProxCenter  |  Compliance Report";
      font-family: Inter, sans-serif;
      font-size: 8pt;
      color: var(--slate-500);
    }
    @bottom-center {
      content: "Page " counter(page) " / " counter(pages);
      font-family: Inter, sans-serif;
      font-size: 8pt;
      color: var(--slate-500);
    }
    @bottom-right {
      content: "Confidential";
      font-family: Inter, sans-serif;
      font-size: 7pt;
      color: var(--slate-500);
      font-style: italic;
    }
  }
  @page :first {
    @top-center   { content: none; }
    @bottom-center { content: none; }
    @bottom-right  { content: none; }
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body {
    font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 10pt;
    color: var(--slate-700);
    line-height: 1.5;
    background: #ffffff;
  }
  h1, h2, h3, h4 { color: var(--slate-900); }

  /* Cover */
  .cover { page-break-after: always; }
  .cover-header {
    background:
      linear-gradient(135deg, rgba(15,23,42,0), rgba(15,23,42,0.18)),
      var(--primary);
    color: #fff;
    padding: 12mm 15mm;
    margin: -15mm -15mm 0 -15mm;
    text-align: center;
  }
  .cover-app-name { font-size: 20pt; font-weight: 700; letter-spacing: 1px; }
  .cover-subtitle  { font-size: 11pt; opacity: 0.9; margin-top: 2mm; }
  .cover-body { text-align: center; padding-top: 30mm; }
  .cover-logo { width: 25mm; height: auto; margin-bottom: 8mm; }
  .cover-framework {
    display: inline-block; background: #ffffff;
    border: 0.5pt solid var(--slate-200); border-radius: 3mm;
    padding: 4mm 6mm; margin-bottom: 8mm;
    box-shadow: 0 2pt 6pt rgba(15,23,42,0.06);
  }
  .cover-framework-logo { height: 16mm; width: auto; max-width: 60mm; display: block; }
  .cover-title {
    font-size: 26pt; font-weight: 700; color: var(--slate-900); margin-bottom: 6mm;
  }
  .cover-type { font-size: 12pt; color: var(--slate-500); margin-bottom: 12mm; }
  .cover-divider {
    width: 80mm; height: 1mm; background: var(--primary);
    margin: 0 auto 15mm auto; border-radius: 1mm;
  }
  .cover-meta {
    background: #ffffff; border: 0.5pt solid var(--slate-200);
    border-radius: 3mm; display: inline-block; padding: 9mm 18mm;
    text-align: center; box-shadow: 0 2pt 6pt rgba(15,23,42,0.06);
  }
  .cover-meta-label {
    font-size: 9pt; font-weight: 600; color: var(--slate-700); margin-bottom: 2mm;
  }
  .cover-meta-value { font-size: 10pt; color: var(--slate-900); }
  .cover-meta-row  { margin-bottom: 5mm; }
  .cover-meta-row:last-child { margin-bottom: 0; }

  /* Sections */
  body { counter-reset: section; }
  .section { margin-bottom: 8mm; }
  .section-header {
    border-left: 3pt solid var(--primary); padding-left: 4mm; margin-bottom: 5mm;
  }
  .section-header h2 {
    font-size: 14pt; font-weight: 700; color: var(--slate-900); letter-spacing: 0.2pt;
  }
  .section-header h2::before {
    counter-increment: section;
    content: counter(section, decimal-leading-zero) "  ";
    color: var(--primary); font-weight: 700; margin-right: 1mm;
  }
  .sub-header {
    font-size: 11pt; font-weight: 600; color: var(--slate-900);
    margin-bottom: 3mm; margin-top: 5mm;
  }
  .section-intro { font-size: 9pt; color: var(--slate-500); margin-bottom: 5mm; line-height: 1.6; }

  /* Stat cards */
  .stat-cards { display: flex; gap: 3mm; margin-bottom: 6mm; }
  .stat-card {
    flex: 1; background: #ffffff;
    border: 0.4pt solid var(--slate-200);
    border-left: 3pt solid var(--primary);
    border-radius: 2mm; padding: 4mm 5mm;
    box-shadow: 0 1pt 2pt rgba(15,23,42,0.04);
  }
  .stat-card.success { border-left-color: var(--green); }
  .stat-card.warning { border-left-color: var(--amber); }
  .stat-card.error   { border-left-color: var(--red); }
  .stat-card.info    { border-left-color: var(--blue); }
  .stat-card.muted   { border-left-color: var(--slate-500); }
  .stat-value {
    font-size: 18pt; font-weight: 700; color: var(--slate-900); line-height: 1.2;
  }
  .stat-label {
    font-size: 8pt; color: var(--slate-500); text-transform: uppercase; letter-spacing: 0.5px;
  }

  /* Progress bar */
  .bar-track {
    width: 100%; height: 4mm; background: var(--slate-100);
    border-radius: 2mm; overflow: hidden; margin-top: 2mm;
  }
  .bar-fill { height: 100%; border-radius: 2mm; }

  /* Tables */
  table { width: 100%; border-collapse: collapse; font-size: 9pt; margin-bottom: 5mm; }
  thead th {
    background: var(--slate-100); color: var(--slate-700);
    font-weight: 600; text-align: left; padding: 2mm 3mm;
    border-bottom: 1pt solid var(--slate-200);
    font-size: 8pt; text-transform: uppercase; letter-spacing: 0.3px;
  }
  tbody td { padding: 2mm 3mm; border-bottom: 0.5pt solid var(--slate-200); vertical-align: top; }
  tbody tr:nth-child(even) { background: var(--slate-50); }

  /* Status badges */
  .badge {
    display: inline-block; font-size: 7pt; font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.3px;
    padding: 0.5mm 2mm; border-radius: 1mm; white-space: nowrap;
  }

  /* Info box (provenance / scope note) */
  .info-box {
    background: var(--slate-50); border-left: 3pt solid var(--primary);
    border-radius: 2mm; padding: 4mm 5mm; margin-bottom: 5mm;
  }
  .info-box-title { font-size: 9pt; font-weight: 600; color: var(--slate-900); margin-bottom: 2mm; }
  .info-box-content { font-size: 9pt; color: var(--slate-700); line-height: 1.6; }

  /* Node sub-section header */
  .node-header {
    font-size: 10pt; font-weight: 600; color: var(--slate-900);
    border-left: 2pt solid var(--slate-500); padding-left: 3mm;
    margin-top: 5mm; margin-bottom: 2mm;
  }

  /* Utilities */
  .page-break { page-break-before: always; }
  .text-sm    { font-size: 8pt; }
  .text-muted { color: var(--slate-500); }
  .mt-4       { margin-top: 4mm; }
  .mb-4       { margin-bottom: 4mm; }
  .no-break   { page-break-inside: avoid; }
`
}

export function frameworkReportHtml(
  a: FrameworkAssessment,
  def: FrameworkDef,
  meta: ReportMeta,
  t: (k: string) => string,
  nodeBreakdown?: NodeBreakdown[],
): string {
  const e = escapeHtml

  // Validate brand color to prevent CSS injection; validated value goes directly into CSS (not escaped).
  const primary = /^#[0-9a-fA-F]{3,8}$/.test(meta.brandColor ?? '') ? meta.brandColor! : '#E57000'

  // Logo: only allow data: URIs. Never escapeHtml a data URI (corrupts base64).
  const safeLogoUri = (meta.logoDataUri && meta.logoDataUri.startsWith('data:')) ? meta.logoDataUri : ''
  const safeFwLogoUri = (meta.frameworkLogoDataUri && meta.frameworkLogoDataUri.startsWith('data:')) ? meta.frameworkLogoDataUri : ''

  // Score display
  const score = a.score
  const scoreText = score === null ? e(t('compliance.frameworks.noAssessed')) : `${score}%`
  const color = scoreColor(score)

  // -- Section 1: Cover --
  const frameworkLabel = def.baselineLabel
    ? `${e(def.name)} ${e(def.version)} - ${e(def.baselineLabel)}`
    : `${e(def.name)} ${e(def.version)}`

  const logoHtml = safeLogoUri ? `<img class="cover-logo" src="${safeLogoUri}" alt="">` : ''
  const frameworkLogoHtml = safeFwLogoUri
    ? `<div class="cover-framework"><img class="cover-framework-logo" src="${safeFwLogoUri}" alt=""></div>`
    : ''

  const cover = `
<div class="cover">
  <div class="cover-header">
    <div class="cover-app-name">ProxCenter</div>
    <div class="cover-subtitle">Compliance Assessment Report</div>
  </div>
  <div class="cover-body">
    ${logoHtml}
    ${frameworkLogoHtml}
    <div class="cover-title">${frameworkLabel}</div>
    <div class="cover-type">Compliance Assessment</div>
    <div class="cover-divider"></div>
    <div class="cover-meta">
      <div class="cover-meta-row">
        <div class="cover-meta-label">Connection</div>
        <div class="cover-meta-value">${e(meta.connectionName)}</div>
      </div>
      <div class="cover-meta-row">
        <div class="cover-meta-label">Generated</div>
        <div class="cover-meta-value">${e(meta.generatedAt)}</div>
      </div>
      <div class="cover-meta-row">
        <div class="cover-meta-label">Score</div>
        <div class="cover-meta-value" style="color:${color};font-weight:700;">${scoreText}</div>
      </div>
    </div>
  </div>
</div>`

  // -- Section 2: Summary --
  const barWidth = score !== null ? `${Math.max(0, Math.min(100, score))}%` : '0%'
  const scoreCardClass = score === null ? 'muted' : score >= 80 ? 'success' : score >= 50 ? 'warning' : 'error'

  // Stat cards: Score, Assessed (count), Satisfied, Partial, Failed. "Not Assessed" card dropped.
  const statCards = `
<div class="stat-cards">
  <div class="stat-card ${scoreCardClass}">
    <div class="stat-value">${scoreText}</div>
    <div class="stat-label">Score</div>
    <div class="bar-track"><div class="bar-fill" style="width:${barWidth};background:${color};"></div></div>
  </div>
  <div class="stat-card info">
    <div class="stat-value">${a.assessedControls}</div>
    <div class="stat-label">${e(t('compliance.frameworks.controlsAssessed'))}</div>
  </div>
  <div class="stat-card success">
    <div class="stat-value">${a.satisfied}</div>
    <div class="stat-label">Satisfied</div>
  </div>
  <div class="stat-card warning">
    <div class="stat-value">${a.partial}</div>
    <div class="stat-label">Partial</div>
  </div>
  <div class="stat-card error">
    <div class="stat-value">${a.failed}</div>
    <div class="stat-label">Failed</div>
  </div>
</div>`

  // Per-family summary table: only families with >= 1 assessed control; no not-assessed column.
  const assessedFamilies = a.families.filter(f => (f.satisfied + f.partial + f.failed) > 0)
  const famRows = assessedFamilies.map(f => {
    const total = f.satisfied + f.partial + f.failed
    const fScore = total > 0 ? Math.round((f.satisfied / total) * 100) : 0
    const fColor = scoreColor(fScore)
    const fWidth = `${fScore}%`
    return `<tr>
      <td>${e(f.family)}</td>
      <td>${f.satisfied}</td>
      <td>${f.partial}</td>
      <td>${f.failed}</td>
      <td>
        <div class="bar-track" style="margin-top:0;"><div class="bar-fill" style="width:${fWidth};background:${fColor};"></div></div>
        <span class="text-sm text-muted">${fScore}%</span>
      </td>
    </tr>`
  }).join('')

  const scopeNote = `
<div class="info-box">
  <div class="info-box-content">Organizational, physical and personnel controls are outside the scope of automated infrastructure assessment and are omitted from this report.</div>
</div>`

  const summarySection = `
<div class="section">
  <div class="section-header"><h2>Summary</h2></div>
  ${scopeNote}
  ${statCards}
  <h3 class="sub-header">By Family</h3>
  <table>
    <thead><tr>
      <th>Family</th><th>Satisfied</th><th>Partial</th><th>Failed</th><th>Score</th>
    </tr></thead>
    <tbody>${famRows}</tbody>
  </table>
</div>`

  // -- Section 3: Per-control table (assessed controls only) --
  const assessedControls = a.controls.filter(c => c.status !== 'not_assessed')
  const controlRows = assessedControls.map(c => {
    const badgeStyle = statusBadgeStyle(c.status)
    const label = STATUS_LABEL[c.status] ?? c.status
    const detailLines = c.checks
      .filter(ch => ch.details)
      .map(ch => `${e(STATUS_LABEL[ch.status] ?? ch.status)}: ${e(ch.details!)}`)
    const detailCell = detailLines.length > 0
      ? `<span style="font-size:9pt;line-height:1.5;">${detailLines.join('<br>')}</span>`
      : '<span style="color:#94a3b8;">-</span>'
    return `<tr>
      <td>${e(c.id)}</td>
      <td>${e(c.title)}</td>
      <td><span class="badge" style="${badgeStyle}">${e(label)}</span></td>
      <td>${c.checks.map(ch => e(ch.name)).join(', ')}</td>
      <td style="font-size:9pt;word-break:break-word;">${detailCell}</td>
    </tr>`
  }).join('')

  const controlsSection = `
<div class="section page-break">
  <div class="section-header"><h2>Controls</h2></div>
  <table>
    <thead><tr>
      <th>ID</th><th>Control</th><th>Status</th><th>Contributing Checks</th><th>${e(t('compliance.frameworks.colDetail'))}</th>
    </tr></thead>
    <tbody>${controlRows}</tbody>
  </table>
</div>`

  // -- Section 4: Per-node results (clusters only, >1 node) --
  let nodeSection = ''
  if (nodeBreakdown && nodeBreakdown.length > 1) {
    const nodeBlocks = nodeBreakdown.map(nb => {
      const sorted = [...nb.checks].sort((x, y) =>
        x.category < y.category ? -1 : x.category > y.category ? 1 : 0,
      )
      const nodeRows = sorted.map(ch => {
        const badgeStyle = statusBadgeStyle(ch.status)
        const label = STATUS_LABEL[ch.status] ?? ch.status
        const detail = ch.details ? e(ch.details) : ''
        return `<tr>
          <td>${e(ch.category)}</td>
          <td>${e(ch.name)}</td>
          <td><span class="badge" style="${badgeStyle}">${e(label)}</span></td>
          <td>${detail}</td>
        </tr>`
      }).join('')
      return `
<div class="no-break">
  <div class="node-header">Node: ${e(nb.node)}</div>
  <table>
    <thead><tr>
      <th>Category</th><th>Check</th><th>Status</th><th>Detail</th>
    </tr></thead>
    <tbody>${nodeRows}</tbody>
  </table>
</div>`
    }).join('')

    nodeSection = `
<div class="section page-break">
  <div class="section-header"><h2>Per-Node Results</h2></div>
  <p class="section-intro">The following tables show individual check results for each node in the cluster.</p>
  ${nodeBlocks}
</div>`
  }

  // -- Section 5: Provenance --
  const safeSourceUrl = (def.sourceUrl && /^https?:\/\//.test(def.sourceUrl)) ? def.sourceUrl : ''
  const sourceUrlHtml = safeSourceUrl
    ? `<div>${e(t('compliance.frameworks.sourceLink'))}: <a href="${e(safeSourceUrl)}">${e(safeSourceUrl)}</a></div>`
    : ''

  let provenanceSection = ''
  if (def.provenanceNote || safeSourceUrl) {
    provenanceSection = `
<div class="section">
  <div class="section-header"><h2>Provenance</h2></div>
  <div class="info-box">
    <div class="info-box-content">${def.provenanceNote ? e(def.provenanceNote) : ''}${def.provenanceNote && safeSourceUrl ? '<br>' : ''}${sourceUrlHtml}</div>
  </div>
</div>`
  }

  return `<!doctype html>
<html lang="${e(meta.locale)}">
<head>
<meta charset="utf-8">
<title>ProxCenter - ${e(def.name)} Compliance Report</title>
<style>${buildCss(primary)}</style>
</head>
<body>
${cover}
${summarySection}
${controlsSection}
${nodeSection}
${provenanceSection}
</body>
</html>`
}
