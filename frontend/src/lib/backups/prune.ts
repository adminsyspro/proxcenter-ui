// src/lib/backups/prune.ts
// Helpers for the legacy `maxfiles` retention parameter on PVE backup jobs.
//
// PVE 8.x removed `maxfiles` from the /cluster/backup schema in favor of
// `prune-backups=keep-last=N`. Both the create and update routes need to
// translate between the two formats, and the list route needs the reverse
// translation so the legacy edit form shows the configured retention.
// Factored out so the create + update handlers share the same logic.

/**
 * Extract the keep-last value from a PVE `prune-backups` field.
 *
 * PVE returns prune-backups as either a comma-separated string
 * ("keep-last=30,keep-daily=7") or as a parsed object depending on the
 * version. Returns the number when keep-last is present, or undefined.
 */
export function extractKeepLastFromPruneBackups(pruneBackups: unknown): number | undefined {
  if (typeof pruneBackups === 'string') {
    const m = pruneBackups.match(/keep-last=(\d+)/)
    if (m) return Number.parseInt(m[1], 10)
    return undefined
  }
  if (pruneBackups && typeof pruneBackups === 'object' && 'keep-last' in pruneBackups) {
    const v = Number((pruneBackups as Record<string, unknown>)['keep-last'])
    if (Number.isFinite(v)) return v
  }
  return undefined
}

/**
 * Translate a legacy `maxfiles` value to a `prune-backups` string suitable
 * for PVE. Returns null when no translation should be sent (maxfiles missing
 * or non-positive, matching old PVE's "keep all" semantics for maxfiles=0).
 *
 * When `existingPruneBackups` is provided (typical for the update path),
 * the existing policy is parsed and only the keep-last segment is replaced.
 * Other rules (keep-daily, keep-weekly, ns=, etc.) are preserved so a
 * legacy edit that only carries `maxfiles` does not silently drop a richer
 * policy configured via the modern UI or the PVE GUI.
 */
export function translateMaxfilesToPruneBackups(
  maxfiles: unknown,
  existingPruneBackups?: unknown,
): string | null {
  if (maxfiles === undefined || maxfiles === null) return null
  const legacy = Number.parseInt(String(maxfiles), 10)
  if (!Number.isFinite(legacy) || legacy <= 0) return null

  const parts: string[] = []
  let foundKeepLast = false

  if (typeof existingPruneBackups === 'string') {
    for (const seg of existingPruneBackups.split(',')) {
      const trimmed = seg.trim()
      if (!trimmed) continue
      if (trimmed.startsWith('keep-last=')) {
        parts.push(`keep-last=${legacy}`)
        foundKeepLast = true
      } else {
        parts.push(trimmed)
      }
    }
  } else if (existingPruneBackups && typeof existingPruneBackups === 'object') {
    for (const [k, v] of Object.entries(existingPruneBackups as Record<string, unknown>)) {
      if (k === 'keep-last') {
        parts.push(`keep-last=${legacy}`)
        foundKeepLast = true
      } else {
        parts.push(`${k}=${v}`)
      }
    }
  }

  if (!foundKeepLast) parts.push(`keep-last=${legacy}`)
  return parts.join(',')
}

/**
 * Mutate `params` to translate legacy `maxfiles` into a `prune-backups`
 * value. Skipped when `prune-backups` is already set (the modern UI keep-*
 * breakdown took precedence) or when maxfiles has no useful value.
 *
 * Folding the `has/set` dance into the helper keeps each call site to a
 * single line, so the create + update routes do not carry near-identical
 * blocks that trip the new-code duplication metric.
 */
export function applyMaxfilesTranslation(
  params: URLSearchParams,
  maxfiles: unknown,
  existingPruneBackups?: unknown,
): void {
  if (params.has('prune-backups')) return
  const translated = translateMaxfilesToPruneBackups(maxfiles, existingPruneBackups)
  if (translated) params.set('prune-backups', translated)
}
