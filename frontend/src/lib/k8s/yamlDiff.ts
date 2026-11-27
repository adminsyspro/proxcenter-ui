// Side-by-side comparison of two resources' YAML. The fields Kubernetes
// writes for itself (identity, versions, status, change bookkeeping) are
// removed first, so only what a person configured is compared.

import { parse, stringify } from 'yaml'

const METADATA_NOISE = ['uid', 'resourceVersion', 'creationTimestamp', 'generation', 'managedFields', 'selfLink']
const ANNOTATION_NOISE = [
  'kubectl.kubernetes.io/last-applied-configuration',
  'deployment.kubernetes.io/revision',
]
/** Lines compared at most per side; past it the diff is cut and flagged. */
export const MAX_DIFF_LINES = 2000

export function normalizeForCompare(yamlText: string): string {
  let obj: any
  try {
    obj = parse(yamlText)
  } catch {
    return yamlText
  }
  if (!obj || typeof obj !== 'object') return yamlText
  delete obj.status
  const meta = obj.metadata
  if (meta && typeof meta === 'object') {
    for (const k of METADATA_NOISE) delete meta[k]
    if (meta.annotations && typeof meta.annotations === 'object') {
      for (const k of ANNOTATION_NOISE) delete meta.annotations[k]
      if (Object.keys(meta.annotations).length === 0) delete meta.annotations
    }
  }
  return stringify(obj, { lineWidth: 0 })
}

export type DiffRowType = 'same' | 'changed' | 'removed' | 'added'
export interface DiffRow { type: DiffRowType; left?: string; right?: string }

/**
 * Line diff by longest common subsequence, laid out for two columns: a
 * removal followed by an addition at the same place becomes one "changed"
 * row, so the two versions of a line face each other.
 */
export function diffLines(leftText: string, rightText: string): { rows: DiffRow[]; truncated: boolean; changes: number } {
  let a = leftText.replace(/\n$/, '').split('\n')
  let b = rightText.replace(/\n$/, '').split('\n')
  const truncated = a.length > MAX_DIFF_LINES || b.length > MAX_DIFF_LINES
  a = a.slice(0, MAX_DIFF_LINES)
  b = b.slice(0, MAX_DIFF_LINES)

  const n = a.length
  const m = b.length
  // lcs[i][j] = common length of a[i..] and b[j..]
  const lcs: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }

  const raw: DiffRow[] = []
  let i = 0
  let j = 0
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) { raw.push({ type: 'same', left: a[i], right: b[j] }); i++; j++ }
    else if (j < m && (i >= n || lcs[i][j + 1] >= lcs[i + 1][j])) { raw.push({ type: 'added', right: b[j] }); j++ }
    else { raw.push({ type: 'removed', left: a[i] }); i++ }
  }

  // Pair each run of removals with the run of additions next to it.
  const rows: DiffRow[] = []
  let k = 0
  while (k < raw.length) {
    if (raw[k].type === 'same') { rows.push(raw[k]); k++; continue }
    const removed: string[] = []
    const added: string[] = []
    while (k < raw.length && raw[k].type !== 'same') {
      if (raw[k].type === 'removed') removed.push(raw[k].left!)
      else added.push(raw[k].right!)
      k++
    }
    const len = Math.max(removed.length, added.length)
    for (let x = 0; x < len; x++) {
      const left = removed[x]
      const right = added[x]
      rows.push({ type: left !== undefined && right !== undefined ? 'changed' : left !== undefined ? 'removed' : 'added', left, right })
    }
  }
  return { rows, truncated, changes: rows.filter(r => r.type !== 'same').length }
}
