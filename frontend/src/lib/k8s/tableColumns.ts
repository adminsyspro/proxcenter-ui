import type { ColumnDef } from './resourceKinds'
import type { ResourceListItem } from './types'

const TOP_LEVEL = new Set(['name', 'namespace', 'createdAt', 'uid', 'kind'])

export function cellValue(item: ResourceListItem, col: ColumnDef): string {
  if (TOP_LEVEL.has(col.key)) return ((item as unknown as Record<string, unknown>)[col.key] as string | undefined) ?? ''
  return item.summary?.[col.key] ?? ''
}

export function compareItems(a: ResourceListItem, b: ResourceListItem, col: ColumnDef): number {
  const va = cellValue(a, col)
  const vb = cellValue(b, col)
  if (col.type === 'number' || col.type === 'ratio' || col.type === 'progress' || col.type === 'bytes') {
    const na = parseFloat(va) || 0
    const nb = parseFloat(vb) || 0
    return na - nb
  }
  if (col.type === 'age') {
    return (new Date(va).getTime() || 0) - (new Date(vb).getTime() || 0)
  }
  return va.localeCompare(vb)
}

export function sortItems(items: ResourceListItem[], col: ColumnDef, dir: 'asc' | 'desc'): ResourceListItem[] {
  const sorted = [...items].sort((a, b) => compareItems(a, b, col))
  return dir === 'desc' ? sorted.reverse() : sorted
}

/** A byte count as GB with one decimal ("3.8 GB"); empty when there is none. */
export function formatGiB(raw: string): string {
  const bytes = Number(raw)
  return raw && bytes > 0 ? `${Math.round(bytes / 1024 ** 3 * 10) / 10} GB` : ''
}
