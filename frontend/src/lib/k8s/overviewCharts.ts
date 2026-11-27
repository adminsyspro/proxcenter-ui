import type { ResourceListItem, EventItem } from './types'

export const TOP_RESTARTS_LIMIT = 8
export const WARNINGS_LIMIT = 10
export const NODE_BARS_LIMIT = 12

export interface PhaseSlice { phase: string; count: number; color: string }
export interface NodeBar { node: string; count: number } // node === '' ⇒ Unscheduled bucket
export interface RestartBar { name: string; namespace: string; restarts: number; tone: 'red' | 'amber' }

const PHASE_ORDER = ['Running', 'Succeeded', 'Pending', 'Failed', 'Unknown']
const PHASE_COLOR: Record<string, string> = {
  Running: '#4caf50', Succeeded: '#26a69a', Pending: '#ff9800', Failed: '#f44336', Unknown: '#9e9e9e',
}

/** Status-dot colour for a pod phase (defaults to grey for unknown/missing). */
export function podPhaseColor(phase: string | undefined): string {
  return PHASE_COLOR[phase || 'Unknown'] || '#9e9e9e'
}

export function podPhaseBreakdown(pods: ResourceListItem[]): PhaseSlice[] {
  const counts = new Map<string, number>()
  for (const p of pods) {
    const phase = p.summary?.phase || 'Unknown'
    counts.set(phase, (counts.get(phase) || 0) + 1)
  }
  const slices: PhaseSlice[] = []
  for (const phase of PHASE_ORDER) {
    const count = counts.get(phase) || 0
    if (count > 0) slices.push({ phase, count, color: PHASE_COLOR[phase] })
    counts.delete(phase)
  }
  for (const [phase, count] of counts) {
    slices.push({ phase, count, color: PHASE_COLOR[phase] || '#9e9e9e' })
  }
  return slices
}

export function parseRestarts(raw: string | undefined): number {
  const n = parseInt(raw ?? '', 10)
  return Number.isNaN(n) || n < 0 ? 0 : n
}

export function podsPerNode(pods: ResourceListItem[], nodeNames: string[]): NodeBar[] {
  const counts = new Map<string, number>()
  for (const name of nodeNames) counts.set(name, 0)
  let unscheduled = 0
  for (const p of pods) {
    const node = p.summary?.node
    // No node, or a node not in the canonical node list (e.g. the node-list
    // fetch failed while the pod list succeeded) → count as unscheduled rather
    // than inventing a phantom bar for a node we were not given.
    if (!node || !counts.has(node)) { unscheduled++; continue }
    counts.set(node, (counts.get(node) || 0) + 1)
  }
  const bars: NodeBar[] = [...counts.entries()].map(([node, count]) => ({ node, count }))
  bars.sort((a, b) => b.count - a.count || a.node.localeCompare(b.node))
  if (unscheduled > 0) bars.push({ node: '', count: unscheduled })
  return bars
}

function readyIncomplete(ready: string | undefined): boolean {
  if (!ready) return false
  const parts = ready.split('/')
  if (parts.length !== 2) return false
  const a = parseInt(parts[0], 10)
  const b = parseInt(parts[1], 10)
  if (Number.isNaN(a) || Number.isNaN(b)) return false
  return a < b
}

export function topRestarts(pods: ResourceListItem[], limit = TOP_RESTARTS_LIMIT): RestartBar[] {
  return pods
    .map(p => {
      const restarts = parseRestarts(p.summary?.restarts)
      const phase = p.summary?.phase
      const notReady = readyIncomplete(p.summary?.ready) || phase === 'Failed' || phase === 'Pending'
      return {
        name: p.name,
        namespace: p.namespace ?? '',
        restarts,
        tone: notReady ? ('red' as const) : ('amber' as const),
      }
    })
    .filter(b => b.restarts > 0)
    .sort((a, b) => b.restarts - a.restarts)
    .slice(0, limit)
}

export function recentWarnings(events: EventItem[], limit = WARNINGS_LIMIT): EventItem[] {
  const ts = (s: string) => Date.parse(s) || 0
  return events
    .filter(e => e.type === 'Warning')
    .sort((a, b) => ts(b.lastSeen) - ts(a.lastSeen))
    .slice(0, limit)
}

export function relativeAge(iso: string, now: number = Date.now()): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const sec = Math.max(0, Math.floor((now - t) / 1000))
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h`
  return `${Math.floor(hr / 24)}d`
}
