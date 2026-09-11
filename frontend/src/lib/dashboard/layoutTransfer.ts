/**
 * Moving dashboards between accounts and between ProxCenter installs.
 *
 * One file carries every dashboard the user has, never an archive: a set of
 * monitoring views travels as a set, and splitting it into one file per tab
 * only makes a standard view harder to hand to a colleague.
 *
 * A layout is portable, but a few widget settings are not: `selectedConnections`,
 * `selectedClusters` and `selectedNodes` name things by id, and those ids belong
 * to the install the dashboards were exported from. Carried over verbatim they
 * point at nothing on the target and the widget renders empty with no
 * explanation, which is the failure this module exists to prevent. Every
 * selector is therefore checked against the connections the target actually has:
 * what resolves is kept (re-importing your own backup keeps your filters), what
 * does not is dropped, and a selector left empty means "all", the widgets' own
 * documented fallback.
 */

export const DASHBOARD_FILE_KIND = 'proxcenter.dashboards'
export const DASHBOARD_FILE_VERSION = 1

/** Widest grid the dashboard renders at (GRID_COLS in WidgetGrid). */
const GRID_COLUMNS = 12

export type TransferWidget = {
  id?: string
  type: string
  x?: number
  y?: number
  w?: number
  h?: number
  settings?: Record<string, unknown>
  [key: string]: unknown
}

export type TransferDashboard = {
  name: string
  widgets: TransferWidget[]
}

export type DashboardFile = {
  kind: string
  version: number
  exportedAt: string
  dashboards: TransferDashboard[]
}

export type ParseFailure =
  | 'invalid-json'
  | 'not-a-dashboard'
  | 'unsupported-version'
  | 'no-widgets'

export type ImportedDashboard = {
  name: string
  widgets: TransferWidget[]
  /** Widgets the target does not know, or that RBAC hides from this user. */
  dropped: number
  /** Widgets whose selectors named connections this install does not have. */
  reset: number
}

export type ParseResult =
  | {
      ok: true
      dashboards: ImportedDashboard[]
      /** Dashboards whose every widget was dropped, so nothing was left to create. */
      skipped: number
      dropped: number
      reset: number
    }
  | { ok: false; reason: ParseFailure }

export type ParseOptions = {
  /** Whether this user may hold this widget type here (registry + RBAC + scope). */
  isWidgetAllowed: (type: string) => boolean
  /** Connection ids the target install exposes to this user. */
  knownConnectionIds: Set<string>
  /** Dashboard names already taken for this user. */
  takenNames?: Iterable<string>
  generateId: () => string
  /** Localised word appended when an exported name is taken, e.g. "imported". */
  importedSuffix?: string
}

export function serializeDashboards(
  dashboards: readonly TransferDashboard[],
  now: Date = new Date()
): DashboardFile {
  return {
    kind: DASHBOARD_FILE_KIND,
    version: DASHBOARD_FILE_VERSION,
    exportedAt: now.toISOString(),
    dashboards: dashboards.map(d => ({
      name: d.name,
      widgets: (d.widgets || []).map(widget => ({ ...widget })),
    })),
  }
}

/**
 * Free name for an import: the file's own name when nothing holds it, then
 * `<name> (imported)`, then a counter. Never silently overwrites a dashboard
 * the user already built.
 */
export function resolveImportName(
  base: string,
  takenNames: Iterable<string> = [],
  importedSuffix = 'imported'
): string {
  const taken = new Set(takenNames)
  const trimmed = base.trim() || importedSuffix

  if (!taken.has(trimmed)) return trimmed

  const candidate = `${trimmed} (${importedSuffix})`

  if (!taken.has(candidate)) return candidate

  for (let n = 2; n <= 99; n++) {
    const numbered = `${trimmed} (${importedSuffix} ${n})`

    if (!taken.has(numbered)) return numbered
  }

  return `${trimmed} (${importedSuffix} ${Date.now()})`
}

/** Lists of connection ids. `selectedClusters` holds connection ids too. */
const CONNECTION_ID_SETTINGS = ['selectedConnections', 'selectedClusters'] as const

/** `<connectionId>:<nodeName>`, so the connection half is what can go stale. */
const CONNECTION_SCOPED_SETTINGS = ['selectedNodes'] as const

/** Which tree rows were unfolded. Pure view state, never worth carrying over. */
const VIEW_STATE_SETTINGS = ['expanded'] as const

function keepResolvable(
  values: unknown,
  isKnown: (id: string) => boolean
): { kept: string[]; changed: boolean } {
  if (!Array.isArray(values)) return { kept: [], changed: false }

  const kept = values.filter(v => typeof v === 'string' && isKnown(v))

  return { kept, changed: kept.length !== values.length }
}

/**
 * Strips the environment out of a widget's settings. Returns the settings to
 * keep and whether anything was dropped, so the import can say so out loud.
 */
export function portSettings(
  settings: Record<string, unknown> | undefined,
  knownConnectionIds: Set<string>
): { settings: Record<string, unknown> | undefined; changed: boolean } {
  if (!settings || typeof settings !== 'object') return { settings, changed: false }

  const next: Record<string, unknown> = { ...settings }
  let changed = false

  for (const key of CONNECTION_ID_SETTINGS) {
    if (!(key in next)) continue
    const { kept, changed: lost } = keepResolvable(next[key], id => knownConnectionIds.has(id))

    changed = changed || lost
    if (kept.length > 0) next[key] = kept
    else delete next[key]
  }

  for (const key of CONNECTION_SCOPED_SETTINGS) {
    if (!(key in next)) continue
    const { kept, changed: lost } = keepResolvable(next[key], id =>
      knownConnectionIds.has(id.split(':')[0])
    )

    changed = changed || lost
    if (kept.length > 0) next[key] = kept
    else delete next[key]
  }

  for (const key of VIEW_STATE_SETTINGS) {
    if (key in next) delete next[key]
  }

  return { settings: Object.keys(next).length > 0 ? next : undefined, changed }
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Math.round(Number(value))

  if (!Number.isFinite(n)) return fallback

  return Math.min(max, Math.max(min, n))
}

/** Keeps an imported widget inside the 12-column grid whatever the file claims. */
export function clampToGrid(widget: TransferWidget): TransferWidget {
  const w = clampInt(widget.w, 1, 1, GRID_COLUMNS)
  const h = clampInt(widget.h, 1, 1, 200)
  const x = clampInt(widget.x, 0, 0, GRID_COLUMNS - w)
  const y = clampInt(widget.y, 0, 0, 10_000)

  return { ...widget, x, y, w, h }
}

function portWidgets(
  candidates: unknown,
  opts: ParseOptions
): { widgets: TransferWidget[]; dropped: number; reset: number } {
  const widgets: TransferWidget[] = []
  let dropped = 0
  let reset = 0

  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    if (!candidate || typeof candidate !== 'object' || typeof candidate.type !== 'string') {
      dropped++
      continue
    }

    // An imported file must not be a way around the widget overrides: a type
    // this user may not hold here is dropped, not merely hidden at render.
    if (!opts.isWidgetAllowed(candidate.type)) {
      dropped++
      continue
    }

    const { settings, changed } = portSettings(candidate.settings, opts.knownConnectionIds)

    if (changed) reset++

    const widget = clampToGrid({ ...candidate, id: opts.generateId() })

    if (settings) widget.settings = settings
    else delete widget.settings

    widgets.push(widget)
  }

  return { widgets, dropped, reset }
}

export function parseDashboardFile(raw: string, opts: ParseOptions): ParseResult {
  let parsed: unknown

  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, reason: 'invalid-json' }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, reason: 'not-a-dashboard' }
  }

  const file = parsed as Partial<DashboardFile>

  if (file.kind !== DASHBOARD_FILE_KIND) return { ok: false, reason: 'not-a-dashboard' }
  if (file.version !== DASHBOARD_FILE_VERSION) return { ok: false, reason: 'unsupported-version' }
  if (!Array.isArray(file.dashboards)) return { ok: false, reason: 'not-a-dashboard' }

  // Names are resolved against the live ones AND against the names this same
  // file already claimed, so two dashboards in one file cannot collide.
  const taken = new Set(opts.takenNames || [])
  const dashboards: ImportedDashboard[] = []
  let skipped = 0
  let dropped = 0
  let reset = 0

  for (const entry of file.dashboards) {
    if (!entry || typeof entry !== 'object') {
      skipped++
      continue
    }

    const ported = portWidgets(entry.widgets, opts)

    dropped += ported.dropped
    reset += ported.reset

    // A dashboard with nothing left to show is not worth creating.
    if (ported.widgets.length === 0) {
      skipped++
      continue
    }

    const name = resolveImportName(
      typeof entry.name === 'string' ? entry.name : '',
      taken,
      opts.importedSuffix
    )

    taken.add(name)
    dashboards.push({ name, widgets: ported.widgets, dropped: ported.dropped, reset: ported.reset })
  }

  if (dashboards.length === 0) return { ok: false, reason: 'no-widgets' }

  return { ok: true, dashboards, skipped, dropped, reset }
}
