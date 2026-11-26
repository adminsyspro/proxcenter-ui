// The PDF of one framework assessment, from collected data. Shared by the
// synchronous report route and the background report jobs.
import fs from 'node:fs'
import path from 'node:path'

import { runAllChecks, type HardeningData } from '@/lib/compliance/hardening'
import { getCrosswalk, getFramework } from '@/lib/compliance/frameworks'
import type { FrameworkId } from '@/lib/compliance/frameworks/types'
import { FRAMEWORK_LOGO_FILES } from '@/lib/compliance/frameworks/logos'
import { assessFramework } from '@/lib/compliance/frameworkAssessment'
import { computeNodeBreakdown } from '@/lib/compliance/nodeBreakdown'
import { applyRiskAcceptances, type RiskAcceptance } from '@/lib/compliance/riskAcceptance'
import { frameworkReportHtml } from '@/lib/compliance/report/frameworkReportHtml'
import { sanitizeFilename } from '@/lib/compliance/report/escapeHtml'
import { renderPdf } from '@/lib/reporting/weasyprintClient'
import type { ReportBranding } from '@/lib/reporting/reportBranding'

export interface BuildFrameworkReportInput {
  frameworkId: FrameworkId
  connectionId: string
  connectionName?: string | null
  data: HardeningData
  /** Risks accepted on the connection: named as such in the report. */
  acceptances?: RiskAcceptance[]
  branding: ReportBranding
}

export type BuildFrameworkReportResult =
  | { ok: true; pdf: Buffer; filename: string }
  | { ok: false; error: string }

// Literal-English translator: frameworkReportHtml calls t() with full dot-path keys
// (e.g. 'compliance.frameworks.controlsAssessed'). getTranslations from next-intl
// requires a request context that is not reliably available in Route handlers (and
// not at all in a background job), so we use a static map keyed by the suffix after
// 'compliance.frameworks.'.
const EN_LABELS: Record<string, string> = {
  assessedOk: 'assessed OK',
  controlsAssessed: 'controls assessed',
  noAssessed: 'No controls assessed yet',
  sourceLink: 'Framework reference',
  colDetail: 'Detail',
}

function reportT(k: string): string {
  const suffix = k.replace('compliance.frameworks.', '')

  return EN_LABELS[suffix] ?? k
}

// Framework badge, embedded as a base64 data URI (WeasyPrint runs with
// base_url=None, so file/URL paths do not resolve). Non-fatal on failure.
function frameworkLogoDataUri(frameworkId: FrameworkId): string {
  try {
    const logoFile = FRAMEWORK_LOGO_FILES[frameworkId]
    if (!logoFile) return ''
    const logoPath = path.join(process.cwd(), 'public', 'images', 'frameworks', logoFile)
    if (!fs.existsSync(logoPath)) return ''

    return `data:image/png;base64,${fs.readFileSync(logoPath).toString('base64')}`
  } catch {
    // Missing/unreadable badge is non-fatal; report renders without it.
    return ''
  }
}

export async function buildFrameworkReportPdf(input: BuildFrameworkReportInput): Promise<BuildFrameworkReportResult> {
  const { frameworkId, connectionId, connectionName, data, branding, acceptances = [] } = input

  // Run ALL checks (no profile, no weighting) and assess against the requested framework
  const checks = applyRiskAcceptances(runAllChecks(data), acceptances)
  const def = getFramework(frameworkId)
  const assessment = assessFramework(checks, def, getCrosswalk(def.id))

  const date = new Date().toISOString().slice(0, 10)
  const html = frameworkReportHtml(
    assessment,
    def,
    {
      connectionName: connectionName ?? connectionId,
      generatedAt: date,
      locale: 'en',
      brandColor: branding.brandColor,
      logoDataUri: branding.logoDataUri,
      frameworkLogoDataUri: frameworkLogoDataUri(def.id),
      appName: branding.appName,
    },
    reportT,
    computeNodeBreakdown(data),
  )

  const out = await renderPdf(html)
  if (!out.ok || !out.pdf) return { ok: false, error: out.error || 'PDF generation failed' }

  const filename = sanitizeFilename(`${def.id}-${connectionName ?? connectionId}-${date}`) + '.pdf'

  return { ok: true, pdf: out.pdf, filename }
}
