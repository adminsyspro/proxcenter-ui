/**
 * The change tracking timeline as a CSV.
 *
 * One row per change, so the row count matches the number the page announces.
 * The field diffs a row carries are flattened into a single readable column
 * rather than spread over extra rows, which keeps a change and its count on the
 * same line.
 */

import { timestampCell, toCsv } from '@/lib/export/download'

export type ChangeFieldDiff = {
  field?: string
  oldValue?: string | null
  newValue?: string | null
}

export type ChangeRecord = {
  timestamp?: string | number | Date
  resourceType?: string
  resourceId?: string | number
  resourceName?: string
  action?: string
  user?: string
  node?: string
  connectionName?: string
  connectionId?: string
  fields?: ChangeFieldDiff[]
}

export type ChangesCsvLabels = {
  headers: readonly string[]
  resourceType: (type: string | undefined) => string
  action: (action: string | undefined) => string
}

/** `cores: 2 -> 4; memory: 4096 -> 8192`, in the timeline's own order. */
export function formatFieldDiffs(fields: ChangeFieldDiff[] | undefined): string {
  if (!Array.isArray(fields) || fields.length === 0) return ''

  return fields
    .map(f => `${f?.field ?? ''}: ${f?.oldValue ?? ''} -> ${f?.newValue ?? ''}`)
    .join('; ')
}

export function buildChangesCsvRows(
  changes: readonly ChangeRecord[],
  labels: ChangesCsvLabels
): unknown[][] {
  return changes.map(change => [
    timestampCell(change.timestamp ?? ''),
    labels.resourceType(change.resourceType),
    change.resourceId ?? '',
    change.resourceName ?? '',
    labels.action(change.action),
    change.user ?? '',
    change.node ?? '',
    change.connectionName || change.connectionId || '',
    Array.isArray(change.fields) ? change.fields.length : 0,
    formatFieldDiffs(change.fields),
  ])
}

export function buildChangesCsv(
  changes: readonly ChangeRecord[],
  labels: ChangesCsvLabels
): string {
  return toCsv(labels.headers, buildChangesCsvRows(changes, labels))
}
