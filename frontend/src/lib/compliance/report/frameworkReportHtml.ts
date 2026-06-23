import type { FrameworkAssessment } from '../frameworkAssessment'
import type { FrameworkDef } from '../frameworks/types'
import { escapeHtml } from './escapeHtml'

export interface ReportMeta { connectionName: string; generatedAt: string; locale: string }

const STATUS_LABEL: Record<string, string> = {
  satisfied: 'Satisfied', partial: 'Partial', failed: 'Failed', not_assessed: 'Not assessed',
}

export function frameworkReportHtml(a: FrameworkAssessment, def: FrameworkDef, meta: ReportMeta, t: (k: string) => string): string {
  const e = escapeHtml
  const scoreText = a.score === null ? t('compliance.frameworks.noAssessed') : `${a.score}%`
  const rows = a.controls.map(c => `
    <tr>
      <td>${e(c.id)}</td><td>${e(c.title)}</td>
      <td class="s-${c.status}">${e(STATUS_LABEL[c.status] ?? c.status)}</td>
      <td>${c.checks.map(ch => e(ch.name)).join(', ')}</td>
    </tr>`).join('')
  const fams = a.families.map(f => `<li>${e(f.family)}: ${f.satisfied}/${f.satisfied + f.partial + f.failed + f.notAssessed}</li>`).join('')
  const note = def.provenanceNote ? `<p class="note">${e(def.provenanceNote)}</p>` : ''
  return `<!doctype html><html lang="${e(meta.locale)}"><head><meta charset="utf-8">
<style>
  body { font-family: sans-serif; color: #1a1a1a; font-size: 12px; }
  h1 { font-size: 20px; } .meta { color: #555; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; }
  th, td { border: 1px solid #ccc; padding: 4px 6px; text-align: left; vertical-align: top; }
  .s-satisfied { color: #1b7f37; } .s-failed { color: #b3261e; }
  .s-partial { color: #9a6700; } .s-not_assessed { color: #888; }
  .note { font-style: italic; color: #555; }
</style></head><body>
  <h1>${e(def.name)} ${e(def.version)}${def.baselineLabel ? ` - ${e(def.baselineLabel)}` : ''}</h1>
  <p class="meta">${e(meta.connectionName)} - ${e(meta.generatedAt)}</p>
  ${note}
  <p><strong>${scoreText}</strong> - ${a.satisfied}/${a.assessedControls} ${t('compliance.frameworks.assessedOk')};
     ${a.assessedControls}/${a.totalControls} ${t('compliance.frameworks.controlsAssessed')}</p>
  <ul>${fams}</ul>
  <table><thead><tr><th>ID</th><th>Control</th><th>Status</th><th>Checks</th></tr></thead><tbody>${rows}</tbody></table>
</body></html>`
}
