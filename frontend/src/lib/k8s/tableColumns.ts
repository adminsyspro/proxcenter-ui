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
  if (col.type === 'number' || col.type === 'ratio' || col.type === 'progress') {
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

/** "4 vCPU" or "3.8 GB" from the node's summary, for a progress column showing a size. */
export function nodeSize(item: ResourceListItem, size: 'cpu' | 'memory' | undefined): string | undefined {
  if (size === 'cpu') {
    const cores = Number(item.summary?.['cpuSize'])
    return cores > 0 ? `${Math.round(cores * 10) / 10} vCPU` : undefined
  }
  if (size === 'memory') {
    const bytes = Number(item.summary?.['memSize'])
    return bytes > 0 ? `${Math.round(bytes / 1024 ** 3 * 10) / 10} GB` : undefined
  }
  return undefined
}
