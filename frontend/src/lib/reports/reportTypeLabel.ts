// Resolves a human-readable label for a report type.
//
// The Go orchestrator's /reports/types endpoint returns English-only names
// (e.g. "Backup Report", "Site Recovery Report") regardless of the UI locale,
// so we prefer the locale-aware frontend i18n key (reports.types.<type>) when
// one exists, fall back to the API-provided name, and finally to the raw type
// id. The schedule and history grids share this so newer types (backup,
// site_recovery) no longer leak their raw id into the UI.

export interface ReportTypeOption {
  type: string
  name: string
}

// Structural subset of next-intl's translator: callable plus a `has` probe.
export interface TypeLabelTranslator {
  (key: string): string
  has: (key: string) => boolean
}

export function getReportTypeLabel(
  type: string,
  reportTypes: ReportTypeOption[],
  t: TypeLabelTranslator,
): string {
  const key = `reports.types.${type}`

  if (t.has(key)) return t(key)

  return reportTypes.find((rt) => rt.type === type)?.name ?? type
}
